const SOURCES = [
  {
    name: "Alo.bg",
    domain: "alo.bg",
    baseUrl: "https://www.alo.bg",
    type: "trusted_portal",
    enabled: true,
    priority: 180
  },
  {
    name: "Imot.bg",
    domain: "imot.bg",
    baseUrl: "https://www.imot.bg",
    type: "trusted_portal",
    enabled: true,
    priority: 170
  },
  {
    name: "Realistimo",
    domain: "realistimo.com",
    baseUrl: "https://realistimo.com/bg",
    type: "trusted_portal",
    enabled: true,
    priority: 160
  }
];

const KNOWN_LOCATIONS = [
  { canonical: "созопол", latin: "sozopol", aliases: ["созопол", "sozopol"] },
  { canonical: "слънчев бряг", latin: "sunny beach", aliases: ["слънчев бряг", "slanchev bryag", "sunny beach", "sunny-beach"] },
  { canonical: "свети влас", latin: "sveti vlas", aliases: ["свети влас", "sveti vlas", "sveti-vlas", "vlas"] },
  { canonical: "бургас", latin: "burgas", aliases: ["бургас", "burgas"] },
  { canonical: "черноморец", latin: "chernomorets", aliases: ["черноморец", "chernomorets"] },
  { canonical: "поморие", latin: "pomorie", aliases: ["поморие", "pomorie"] },
  { canonical: "равда", latin: "ravda", aliases: ["равда", "ravda"] },
  { canonical: "несебър", latin: "nesebar", aliases: ["несебър", "nesebar", "nessebar"] },
  { canonical: "лозенец", latin: "lozenets", aliases: ["лозенец", "lozenets"] },
  { canonical: "царево", latin: "tsarevo", aliases: ["царево", "tsarevo"] }
];

const PROPERTY_TYPE_RULES = [
  {
    canonical: "студио",
    aliases: ["студио", "studio", "едностаен", "1 стая"],
    searchTerms: ["студио", "studio"]
  },
  {
    canonical: "една спалня",
    aliases: ["една спалня", "1 спалня", "двустаен", "две стаи", "2 стаи", "one bedroom"],
    searchTerms: ["една спалня", "двустаен", "one bedroom"]
  },
  {
    canonical: "две спални",
    aliases: ["две спални", "2 спални", "тристаен", "три стаи", "3 стаи", "two bedroom"],
    searchTerms: ["две спални", "тристаен", "two bedroom"]
  },
  {
    canonical: "три спални",
    aliases: ["три спални", "3 спални", "четиристаен", "4 стаи"],
    searchTerms: ["три спални", "четиристаен"]
  }
];

const REQUEST_TIMEOUT_MS = 9000;
const MAX_RESULTS = 8;
const MAX_SEARCH_PAGES_PER_SOURCE = 3;
const MIN_SCORE = 28;

module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query",
      mode: "portal_search_v1",
      results: []
    });
  }

  const diagnostics = [];

  try {
    const queryIntent = parseQueryIntent(q);
    const enabledSources = SOURCES.filter(source => source.enabled);

    let allResults = [];

    for (const source of enabledSources) {
      const sourceDiagnostics = {
        source: source.name,
        domain: source.domain,
        mode: "portal_search",
        generated_search_urls: 0,
        fetched_search_pages: 0,
        extracted_candidates: 0,
        accepted_results: 0,
        status: "started",
        error: null
      };

      try {
        const sourceResults = await searchPortalSource(source, q, queryIntent, sourceDiagnostics);
        allResults.push(...sourceResults);

        sourceDiagnostics.accepted_results = sourceResults.length;
        sourceDiagnostics.status = "completed";
      } catch (error) {
        sourceDiagnostics.status = "failed";
        sourceDiagnostics.error = error.message;
      }

      diagnostics.push(sourceDiagnostics);
    }

    const results = deduplicateResults(allResults)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.source_priority - a.source_priority;
      })
      .slice(0, MAX_RESULTS);

    return res.status(200).json({
      ok: true,
      query: q,
      mode: "portal_search_v1_real_market_discovery",
      philosophy: "External portals are searched as market discovery only. NewHome local database remains primary trusted source.",
      detected_location: queryIntent.location ? queryIntent.location.canonical : null,
      detected_property_type: queryIntent.propertyType ? queryIntent.propertyType.canonical : null,
      budget: queryIntent.budget,
      min_area: queryIntent.minArea,
      checked_sources: diagnostics,
      total: results.length,
      results
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Portal search failed",
      error: error.message,
      mode: "portal_search_v1",
      checked_sources: diagnostics,
      results: []
    });
  }
};

async function searchPortalSource(source, originalQuery, queryIntent, diagnostics) {
  const searchUrls = buildPortalSearchUrls(source, originalQuery, queryIntent);

  diagnostics.generated_search_urls = searchUrls.length;

  const pages = [];

  for (const url of searchUrls.slice(0, MAX_SEARCH_PAGES_PER_SOURCE)) {
    const html = await fetchText(url);

    diagnostics.fetched_search_pages += html ? 1 : 0;

    if (!html) continue;

    pages.push({
      url,
      html
    });
  }

  const candidates = [];

  for (const page of pages) {
    const extracted = extractCandidatesFromSearchPage(source, page.html, page.url);

    candidates.push(...extracted);
  }

  diagnostics.extracted_candidates = candidates.length;

  return candidates
    .map(candidate => scoreExternalCandidate(candidate, queryIntent, originalQuery))
    .filter(candidate => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function buildPortalSearchUrls(source, originalQuery, queryIntent) {
  const location = queryIntent.location;
  const propertyType = queryIntent.propertyType;

  const terms = [];

  if (location) {
    terms.push(location.canonical);
  }

  if (propertyType) {
    terms.push(propertyType.searchTerms[0]);
  }

  if (queryIntent.budget) {
    terms.push("до " + queryIntent.budget + " евро");
  }

  if (!terms.length) {
    terms.push(originalQuery);
  }

  const bgQuery = normalizeSpaces(terms.join(" "));
  const latinQuery = normalizeSpaces([
    location ? location.latin : "",
    propertyType ? propertyType.searchTerms[propertyType.searchTerms.length - 1] : "",
    queryIntent.budget ? "up to " + queryIntent.budget + " eur" : ""
  ].filter(Boolean).join(" "));

  const encodedBg = encodeURIComponent(bgQuery);
  const encodedLatin = encodeURIComponent(latinQuery || bgQuery);

  if (source.domain === "alo.bg") {
    return unique([
      `https://www.alo.bg/searchq/?q=${encodedBg}`,
      `https://www.alo.bg/searchq/?q=${encodedLatin}`,
      `https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/?q=${encodedBg}`
    ]);
  }

  if (source.domain === "imot.bg") {
    return unique([
      `https://www.imot.bg/pcgi/imot.cgi?act=3&slink=&f1=1&fe7=1&keywords=${encodedBg}`,
      `https://www.imot.bg/pcgi/imot.cgi?act=3&slink=&f1=1&fe7=1&keywords=${encodedLatin}`,
      `https://www.imot.bg/pcgi/imot.cgi?act=3&rub=1&keywords=${encodedBg}`
    ]);
  }

  if (source.domain === "realistimo.com") {
    return unique([
      `https://realistimo.com/bg/buy?query=${encodedBg}`,
      `https://realistimo.com/bg/buy?query=${encodedLatin}`,
      `https://realistimo.com/bg/properties?query=${encodedBg}`
    ]);
  }

  return [];
}

function extractCandidatesFromSearchPage(source, html, pageUrl) {
  const candidates = [];
  const anchors = extractAnchors(html, pageUrl)
    .filter(anchor => isAllowedUrl(anchor.url, source.domain))
    .filter(anchor => isLikelyListingUrl(anchor.url, source))
    .filter(anchor => !isBlockedUrl(anchor.url));

  const uniqueAnchors = deduplicateAnchors(anchors).slice(0, 24);

  for (const anchor of uniqueAnchors) {
    const surroundingText = extractSurroundingText(html, anchor.rawHref || anchor.href || "", anchor.text);
    const image = extractNearbyImage(html, anchor.rawHref || anchor.href || "", pageUrl);

    const title = cleanText(anchor.text) || cleanTitleFromUrl(anchor.url);
    const excerpt = cleanText(surroundingText).slice(0, 360);

    if (!title || title.length < 6) continue;

    candidates.push({
      title,
      url: anchor.url,
      image,
      excerpt,
      source: source.name,
      source_domain: source.domain,
      source_type: source.type,
      source_priority: source.priority,
      type: "external_portal_listing_candidate",
      match_reason: "",
      score: 0
    });
  }

  return candidates;
}

function scoreExternalCandidate(candidate, queryIntent, originalQuery) {
  const allText = normalize([
    candidate.title,
    candidate.excerpt,
    candidate.url
  ].join(" "));

  let score = 0;
  const reasons = [];

  score += candidate.source_priority / 20;

  if (queryIntent.location) {
    const hasLocation = queryIntent.location.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasLocation) {
      score += 35;
      reasons.push("съвпада със зададената локация: " + queryIntent.location.canonical);
    } else {
      score -= 35;
      reasons.push("локацията не е ясно потвърдена");
    }
  }

  if (queryIntent.propertyType) {
    const hasPropertyType = queryIntent.propertyType.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasPropertyType) {
      score += 28;
      reasons.push("съвпада с търсения тип имот: " + queryIntent.propertyType.canonical);
    } else if (hasGeneralApartmentSignal(allText)) {
      score += 12;
      reasons.push("има общи сигнали за апартамент");
    }
  }

  if (queryIntent.budget) {
    const foundPrice = extractPrice(allText);

    if (foundPrice) {
      if (foundPrice <= queryIntent.budget) {
        score += 25;
        reasons.push("откритата цена изглежда в рамките на бюджета");
      } else {
        score -= 20;
        reasons.push("откритата цена може да е над бюджета");
      }
    }
  }

  if (queryIntent.minArea) {
    const foundArea = extractArea(allText);

    if (foundArea) {
      if (foundArea >= queryIntent.minArea) {
        score += 15;
        reasons.push("откритата площ изглежда над минималната");
      } else {
        score -= 10;
        reasons.push("откритата площ може да е под минималната");
      }
    }
  }

  if (/€|eur|евро|лв|bgn/.test(allText)) {
    score += 12;
    reasons.push("има сигнал за цена");
  }

  if (/кв м|кв\.м|m2|m²|площ/.test(allText)) {
    score += 12;
    reasons.push("има сигнал за площ");
  }

  if (hasGeneralApartmentSignal(allText)) {
    score += 18;
    reasons.push("съдържа имотни ключови думи");
  }

  if (candidate.image) {
    score += 5;
    reasons.push("има открита снимка");
  }

  if (candidate.source_domain === "alo.bg") {
    score += 8;
  }

  candidate.score = Math.round(score * 10) / 10;
  candidate.real_property_match = candidate.score >= MIN_SCORE;
  candidate.match_reason = buildCandidateReason(candidate, reasons);

  return candidate;
}

function buildCandidateReason(candidate, reasons) {
  const intro = candidate.source_domain === "alo.bg"
    ? "Резултатът е от Alo.bg като одобрен външен discovery източник"
    : candidate.source_domain === "imot.bg"
      ? "Резултатът е от Imot.bg като одобрен външен discovery източник"
      : "Резултатът е от Realistimo като одобрен външен discovery източник";

  return [intro, ...reasons].slice(0, 5).join("; ");
}

function parseQueryIntent(query) {
  const normalized = normalize(query);

  const location = KNOWN_LOCATIONS.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  const propertyType = PROPERTY_TYPE_RULES.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  const budget = extractBudget(normalized);
  const minArea = extractMinArea(normalized);

  return {
    original: query,
    normalized,
    location,
    propertyType,
    budget,
    minArea
  };
}

function extractBudget(text) {
  const patterns = [
    /до\s*([0-9\s]{4,8})\s*(евро|eur|€)/i,
    /budget\s*([0-9\s]{4,8})/i,
    /([0-9\s]{4,8})\s*(евро|eur|€)/i
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);

    if (match) {
      const value = Number(String(match[1]).replace(/\s+/g, ""));

      if (value > 10000 && value < 2000000) {
        return value;
      }
    }
  }

  return null;
}

function extractMinArea(text) {
  const patterns = [
    /от\s*([0-9]{2,4})\s*(кв|кв\.м|m2|m²)/i,
    /минимална\s*площ\s*([0-9]{2,4})/i
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);

    if (match) {
      const value = Number(match[1]);

      if (value > 10 && value < 1000) {
        return value;
      }
    }
  }

  return null;
}

function extractPrice(text) {
  const match = String(text || "").match(/([0-9]{2,3}(?:\s?[0-9]{3})+|[0-9]{5,7})\s*(€|eur|евро)/i);

  if (!match) return null;

  const value = Number(String(match[1]).replace(/\s+/g, ""));

  if (value > 10000 && value < 3000000) {
    return value;
  }

  return null;
}

function extractArea(text) {
  const match = String(text || "").match(/([0-9]{2,4})\s*(кв м|кв\.м|m2|m²)/i);

  if (!match) return null;

  const value = Number(match[1]);

  if (value > 10 && value < 1000) {
    return value;
  }

  return null;
}

function hasGeneralApartmentSignal(text) {
  return /апартамент|студио|спалн|двустаен|тристаен|едностаен|жилищ|имот|етаж|продажба|продава/i.test(text);
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const before = match[1] || "";
    const href = match[2] || "";
    const after = match[3] || "";
    const inner = match[4] || "";
    const url = toAbsoluteUrl(href, baseUrl);

    if (!url) continue;

    anchors.push({
      href,
      rawHref: href,
      url,
      attributes: before + " " + after,
      text: cleanText(stripHtml(inner))
    });
  }

  return anchors;
}

function extractSurroundingText(html, rawHref, anchorText) {
  if (!rawHref) return anchorText || "";

  const index = html.indexOf(rawHref);

  if (index < 0) {
    return anchorText || "";
  }

  const start = Math.max(0, index - 1400);
  const end = Math.min(html.length, index + 1800);
  const chunk = html.slice(start, end);

  return stripHtml(chunk);
}

function extractNearbyImage(html, rawHref, pageUrl) {
  if (!rawHref) return "";

  const index = html.indexOf(rawHref);

  if (index < 0) return "";

  const start = Math.max(0, index - 1600);
  const end = Math.min(html.length, index + 1600);
  const chunk = html.slice(start, end);

  return extractImage(chunk, pageUrl);
}

function isLikelyListingUrl(url, source) {
  const lower = url.toLowerCase();

  if (source.domain === "alo.bg") {
    return (
      lower.includes("/obiavi/") ||
      lower.includes("/imoti/") ||
      /\/[0-9]{6,}/.test(lower)
    );
  }

  if (source.domain === "imot.bg") {
    return (
      lower.includes("imot.cgi") ||
      lower.includes("act=5") ||
      lower.includes("prodava") ||
      lower.includes("obiava")
    );
  }

  if (source.domain === "realistimo.com") {
    return (
      lower.includes("/bg/buy/") ||
      lower.includes("/bg/property/") ||
      lower.includes("/bg/properties/")
    );
  }

  return false;
}

function isBlockedUrl(url) {
  const lower = String(url || "").toLowerCase();

  return [
    ".css",
    ".js",
    ".json",
    ".woff",
    ".woff2",
    ".svg",
    "/login",
    "/register",
    "/privacy",
    "/terms",
    "/contacts",
    "/contact",
    "/help",
    "facebook.com",
    "instagram.com",
    "youtube.com"
  ].some(part => lower.includes(part));
}

function extractImage(html, pageUrl = "") {
  let image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";

  if (!image) {
    const imgRegex = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const candidate = toAbsoluteUrl(match[1], pageUrl);
      const lower = candidate.toLowerCase();

      if (!candidate) continue;
      if (lower.includes("logo")) continue;
      if (lower.includes("icon")) continue;
      if (lower.includes("sprite")) continue;
      if (lower.includes("placeholder")) continue;

      image = candidate;
      break;
    }
  }

  return image;
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapeRegex(name)}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegex(name)}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);

    if (match) {
      return decodeHtml(match[1].trim());
    }
  }

  return "";
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MaxAssistantBot/1.0; +https://newhomebulgaria.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
      return "";
    }

    return await response.text();
  } catch (error) {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedUrl(url, domain) {
  try {
    const parsed = new URL(url);

    return parsed.hostname === domain || parsed.hostname.endsWith("." + domain);
  } catch (error) {
    return false;
  }
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    if (!href) return "";
    if (href.startsWith("#")) return "";
    if (href.startsWith("mailto:")) return "";
    if (href.startsWith("tel:")) return "";
    if (href.startsWith("javascript:")) return "";

    return new URL(href, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function deduplicateAnchors(anchors) {
  const seen = new Set();

  return anchors.filter(anchor => {
    const key = anchor.url.split("#")[0];

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function deduplicateResults(results) {
  const seen = new Set();

  return results.filter(result => {
    const key = normalize(result.url || result.title || "");

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function cleanTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;

    return decodeURIComponent(slug)
      .replace(/[-_]+/g, " ")
      .trim();
  } catch (error) {
    return url;
  }
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`~|\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpaces(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(text) {
  return decodeHtml(String(text || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(array) {
  return [...new Set(array)];
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
