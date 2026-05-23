const SOURCES = [
  {
    name: "NewHome Bulgaria",
    domain: "newhomebulgaria.com",
    baseUrl: "https://newhomebulgaria.com",
    type: "trusted_site_discovery",
    enabled: true,
    priority: 300
  },
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
    rooms: 1,
    aliases: ["студио", "studio", "едностаен", "1 стая", "1стаен"],
    searchTerms: ["студио", "studio", "едностаен"]
  },
  {
    canonical: "една спалня",
    rooms: 2,
    aliases: ["една спалня", "1 спалня", "двустаен", "две стаи", "2 стаи", "one bedroom"],
    searchTerms: ["двустаен", "една спалня", "one bedroom"]
  },
  {
    canonical: "две спални",
    rooms: 3,
    aliases: ["две спални", "2 спални", "тристаен", "три стаи", "3 стаи", "two bedroom"],
    searchTerms: ["тристаен", "две спални", "two bedroom"]
  },
  {
    canonical: "три спални",
    rooms: 4,
    aliases: ["три спални", "3 спални", "четиристаен", "4 стаи"],
    searchTerms: ["четиристаен", "три спални"]
  }
];

const NEW_HOME_SITEMAPS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml"
];

const REQUEST_TIMEOUT_MS = 9000;
const MAX_RESULTS = 9;
const MAX_PORTAL_SEARCH_PAGES = 3;
const MAX_NEWHOME_FETCHES = 16;
const MIN_NEWHOME_SCORE = 42;
const MIN_PORTAL_SCORE = 55;

module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query",
      mode: "external_discovery_v5",
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
        type: source.type,
        mode: source.type === "trusted_site_discovery" ? "newhome_site_discovery" : "portal_search",
        generated_search_urls: 0,
        discovered_urls: 0,
        fetched_pages: 0,
        extracted_candidates: 0,
        accepted_results: 0,
        status: "started",
        error: null
      };

      try {
        const sourceResults = source.type === "trusted_site_discovery"
          ? await searchNewHomeTrustedSite(source, q, queryIntent, sourceDiagnostics)
          : await searchPortalSource(source, q, queryIntent, sourceDiagnostics);

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
        if (b.source_priority !== a.source_priority) {
          return b.source_priority - a.source_priority;
        }

        return b.score - a.score;
      })
      .slice(0, MAX_RESULTS);

    return res.status(200).json({
      ok: true,
      query: q,
      mode: "external_discovery_v5_newhome_plus_strict_portal_listings",
      philosophy: "NewHome site discovery is trusted. Portals are strict external opportunities and must look like real listing candidates.",
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
      message: "External discovery failed",
      error: error.message,
      mode: "external_discovery_v5",
      checked_sources: diagnostics,
      results: []
    });
  }
};

/* =========================
   NEWHOME TRUSTED SITE DISCOVERY
========================= */

async function searchNewHomeTrustedSite(source, originalQuery, queryIntent, diagnostics) {
  const urls = await discoverNewHomeUrls(source);
  diagnostics.discovered_urls = urls.length;

  const rankedUrls = urls
    .filter(url => isAllowedUrl(url, source.domain))
    .filter(url => !isBlockedUrl(url))
    .filter(url => isNewHomeRelevantUrl(url, queryIntent))
    .map(url => ({
      url,
      score: scoreNewHomeUrl(url, queryIntent)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEWHOME_FETCHES);

  diagnostics.fetched_pages = rankedUrls.length;

  const pages = await Promise.all(
    rankedUrls.map(item =>
      fetchNewHomePageResult(source, item.url, queryIntent, item.score)
    )
  );

  const results = pages
    .filter(Boolean)
    .filter(item => item.score >= MIN_NEWHOME_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  diagnostics.extracted_candidates = pages.filter(Boolean).length;

  return results;
}

async function discoverNewHomeUrls(source) {
  const found = [];
  const visited = new Set();

  for (const path of NEW_HOME_SITEMAPS) {
    const sitemapUrl = source.baseUrl.replace(/\/$/, "") + path;
    const urls = await readSitemapRecursive(sitemapUrl, source, visited, 0);

    found.push(...urls);

    if (found.length >= 180) break;
  }

  return unique(found).slice(0, 180);
}

async function readSitemapRecursive(sitemapUrl, source, visited, depth) {
  if (visited.has(sitemapUrl)) return [];
  if (visited.size > 12) return [];
  if (depth > 2) return [];

  visited.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl);
  if (!xml) return [];

  const locs = extractLocs(xml);
  if (!locs.length) return [];

  const nested = locs
    .filter(url => /sitemap/i.test(url))
    .filter(url => isAllowedUrl(url, source.domain))
    .slice(0, 8);

  const pageUrls = locs.filter(url => !/sitemap/i.test(url));
  const all = [...pageUrls];

  for (const nestedUrl of nested) {
    const nestedUrls = await readSitemapRecursive(nestedUrl, source, visited, depth + 1);
    all.push(...nestedUrls);
  }

  return unique(all);
}

async function fetchNewHomePageResult(source, url, queryIntent, urlScore) {
  const html = await fetchText(url);
  if (!html) return null;

  const title = extractTitle(html) || cleanTitleFromUrl(url);
  const description = extractMeta(html, "description");
  const image = extractImage(html, url);
  const clean = stripHtml(html).slice(0, 9000);
  const tableText = extractTableText(html);

  const scored = scoreTrustedSiteText({
    title,
    description,
    url,
    clean,
    tableText,
    queryIntent,
    baseScore: urlScore
  });

  if (scored.score < MIN_NEWHOME_SCORE) return null;

  return {
    title,
    url,
    image,
    excerpt: tableText ? summarizeTableText(tableText, queryIntent) : makeExcerpt(clean || description, queryIntent),
    source: source.name,
    source_domain: source.domain,
    source_type: source.type,
    source_priority: source.priority,
    type: "newhome_trusted_site_result",
    real_property_match: true,
    has_table: Boolean(tableText),
    match_reason: scored.reasons.slice(0, 5).join("; "),
    score: Math.round(scored.score * 10) / 10
  };
}

function scoreTrustedSiteText({ title, description, url, clean, tableText, queryIntent, baseScore }) {
  const allText = normalize([title, description, url, clean, tableText].join(" "));
  let score = baseScore + 35;
  const reasons = ["резултатът е от NewHome Bulgaria като доверен site discovery layer"];

  if (queryIntent.location) {
    const hasLocation = queryIntent.location.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasLocation) {
      score += 35;
      reasons.push("съвпада със зададената локация: " + queryIntent.location.canonical);
    } else {
      score -= 30;
      reasons.push("локацията не е ясно потвърдена");
    }
  }

  if (queryIntent.propertyType) {
    const hasType = queryIntent.propertyType.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasType) {
      score += 24;
      reasons.push("има съвпадение с типа имот: " + queryIntent.propertyType.canonical);
    } else if (hasGeneralApartmentSignal(allText)) {
      score += 8;
      reasons.push("има общ имотен сигнал, но типът не е напълно потвърден");
    }
  }

  if (queryIntent.budget) {
    const price = extractPrice(allText);

    if (price) {
      if (price <= queryIntent.budget) {
        score += 20;
        reasons.push("откритата цена изглежда в рамките на бюджета");
      } else {
        score -= 18;
        reasons.push("откритата цена може да е над бюджета");
      }
    }
  }

  if (tableText) {
    score += 20;
    reasons.push("има ценова таблица или структурирана информация");
  }

  if (/€|eur|евро/.test(allText)) {
    score += 10;
    reasons.push("има данни за цена");
  }

  if (/кв м|кв\.м|m2|m²|площ/.test(allText)) {
    score += 10;
    reasons.push("има данни за площ");
  }

  if (!hasGeneralApartmentSignal(allText)) {
    score -= 35;
  }

  return { score, reasons };
}

function isNewHomeRelevantUrl(url, queryIntent) {
  const lower = normalize(url);

  if (isGenericUrl(url)) return false;

  const propertyLike = /listing|apartament|apartamenti|imot|nedvizhimi|prodazhba|kompleks|resort|residence|green-life|cascadas|city-residence|vista-verde|kasa-blanka|santa-marina/i.test(url);

  if (!propertyLike) return false;

  if (queryIntent.location) {
    const locationInUrl = queryIntent.location.aliases.some(alias =>
      lower.includes(normalize(alias))
    );

    if (locationInUrl) return true;
  }

  if (queryIntent.propertyType) {
    const typeInUrl = queryIntent.propertyType.aliases.some(alias =>
      lower.includes(normalize(alias))
    );

    if (typeInUrl) return true;
  }

  return propertyLike;
}

function scoreNewHomeUrl(url, queryIntent) {
  const lower = normalize(url);
  let score = 0;

  if (/listing|apartament|apartamenti|imot|prodazhba|nedvizhimi/i.test(lower)) score += 28;
  if (/kompleks|resort|residence|green-life|cascadas|city-residence|vista-verde|kasa-blanka/i.test(lower)) score += 18;

  if (queryIntent.location) {
    if (queryIntent.location.aliases.some(alias => lower.includes(normalize(alias)))) {
      score += 34;
    }
  }

  if (queryIntent.propertyType) {
    if (queryIntent.propertyType.aliases.some(alias => lower.includes(normalize(alias)))) {
      score += 16;
    }
  }

  return score;
}

/* =========================
   STRICT PORTAL SEARCH
========================= */

async function searchPortalSource(source, originalQuery, queryIntent, diagnostics) {
  const searchUrls = buildPortalSearchUrls(source, originalQuery, queryIntent);
  diagnostics.generated_search_urls = searchUrls.length;

  const pages = [];

  for (const url of searchUrls.slice(0, MAX_PORTAL_SEARCH_PAGES)) {
    const html = await fetchText(url);

    if (!html) continue;

    diagnostics.fetched_pages += 1;

    pages.push({ url, html });
  }

  const candidates = [];

  for (const page of pages) {
    candidates.push(...extractCandidatesFromSearchPage(source, page.html, page.url, queryIntent));
  }

  diagnostics.extracted_candidates = candidates.length;

  return candidates
    .map(candidate => scoreExternalCandidate(candidate, queryIntent))
    .filter(candidate => candidate.score >= MIN_PORTAL_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function buildPortalSearchUrls(source, originalQuery, queryIntent) {
  const location = queryIntent.location;
  const propertyType = queryIntent.propertyType;

  const baseTerms = [
    location ? location.canonical : "",
    propertyType ? propertyType.searchTerms[0] : "",
    queryIntent.budget ? "до " + queryIntent.budget + " евро" : ""
  ].filter(Boolean);

  const latinTerms = [
    location ? location.latin : "",
    propertyType ? propertyType.searchTerms[propertyType.searchTerms.length - 1] : "",
    queryIntent.budget ? "up to " + queryIntent.budget + " eur" : ""
  ].filter(Boolean);

  const bgQuery = normalizeSpaces(baseTerms.join(" ") || originalQuery);
  const latinQuery = normalizeSpaces(latinTerms.join(" ") || originalQuery);

  const encodedBg = encodeURIComponent(bgQuery);
  const encodedLatin = encodeURIComponent(latinQuery);

  if (source.domain === "alo.bg") {
    return unique([
      `https://www.alo.bg/searchq/?q=${encodedBg}`,
      `https://www.alo.bg/searchq/?q=${encodedLatin}`,
      `https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/?q=${encodedBg}`
    ]);
  }

  if (source.domain === "imot.bg") {
    return unique([
      `https://www.imot.bg/pcgi/imot.cgi?act=3&rub=1&keywords=${encodedBg}`,
      `https://www.imot.bg/pcgi/imot.cgi?act=3&rub=1&keywords=${encodedLatin}`
    ]);
  }

  if (source.domain === "realistimo.com") {
    return unique([
      `https://realistimo.com/bg/buy?query=${encodedBg}`,
      `https://realistimo.com/bg/buy?query=${encodedLatin}`
    ]);
  }

  return [];
}

function extractCandidatesFromSearchPage(source, html, pageUrl, queryIntent) {
  const anchors = extractAnchors(html, pageUrl)
    .filter(anchor => isAllowedUrl(anchor.url, source.domain))
    .filter(anchor => !isBlockedUrl(anchor.url))
    .filter(anchor => isLikelyListingUrl(anchor.url, source))
    .filter(anchor => !isBadAnchorTitle(anchor.text));

  const candidates = [];

  for (const anchor of deduplicateAnchors(anchors).slice(0, 40)) {
    const chunk = extractListingChunk(html, anchor.rawHref, anchor.text);
    const text = cleanText(stripHtml(chunk || anchor.text));
    const title = deriveListingTitle(anchor, text);
    const image = extractNearbyImage(chunk || html, anchor.rawHref, pageUrl);

    if (!title || isBadAnchorTitle(title)) continue;
    if (!isStrictListingCandidate(title, text, anchor.url, queryIntent)) continue;

    candidates.push({
      title,
      url: anchor.url,
      image,
      excerpt: text.slice(0, 420),
      source: source.name,
      source_domain: source.domain,
      source_type: source.type,
      source_priority: source.priority,
      type: "external_portal_listing_candidate",
      real_property_match: true,
      match_reason: "",
      score: 0
    });
  }

  return candidates;
}

function isStrictListingCandidate(title, text, url, queryIntent) {
  const all = normalize([title, text, url].join(" "));

  if (isBadAnchorTitle(title)) return false;
  if (!hasGeneralApartmentSignal(all)) return false;

  const hasLocation = queryIntent.location
    ? queryIntent.location.aliases.some(alias => all.includes(normalize(alias)))
    : true;

  const hasPrice = Boolean(extractPrice(all)) || /€|eur|евро|лв|bgn/.test(all);
  const hasArea = Boolean(extractArea(all)) || /кв м|кв\.м|m2|m²|площ/.test(all);

  const hasType = queryIntent.propertyType
    ? queryIntent.propertyType.aliases.some(alias => all.includes(normalize(alias))) || hasGeneralApartmentSignal(all)
    : true;

  return hasLocation && hasType && (hasPrice || hasArea);
}

function scoreExternalCandidate(candidate, queryIntent) {
  const allText = normalize([candidate.title, candidate.excerpt, candidate.url].join(" "));
  let score = candidate.source_priority / 20;
  const reasons = [];

  if (queryIntent.location) {
    const hasLocation = queryIntent.location.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasLocation) {
      score += 38;
      reasons.push("съвпада със зададената локация: " + queryIntent.location.canonical);
    } else {
      score -= 60;
      reasons.push("локацията не е потвърдена");
    }
  }

  if (queryIntent.propertyType) {
    const hasType = queryIntent.propertyType.aliases.some(alias =>
      allText.includes(normalize(alias))
    );

    if (hasType) {
      score += 30;
      reasons.push("съвпада с търсения тип имот: " + queryIntent.propertyType.canonical);
    } else if (hasGeneralApartmentSignal(allText)) {
      score += 12;
      reasons.push("има общ сигнал за апартамент, но типът трябва да се провери");
    }
  }

  if (queryIntent.budget) {
    const price = extractPrice(allText);

    if (price) {
      if (price <= queryIntent.budget) {
        score += 24;
        reasons.push("откритата цена изглежда в бюджета");
      } else {
        score -= 35;
        reasons.push("откритата цена може да е над бюджета");
      }
    }
  }

  if (queryIntent.minArea) {
    const area = extractArea(allText);

    if (area) {
      if (area >= queryIntent.minArea) {
        score += 14;
        reasons.push("откритата площ изглежда над минимума");
      } else {
        score -= 15;
        reasons.push("откритата площ може да е под минимума");
      }
    }
  }

  if (/€|eur|евро|лв|bgn/.test(allText)) {
    score += 14;
    reasons.push("има сигнал за цена");
  }

  if (/кв м|кв\.м|m2|m²|площ/.test(allText)) {
    score += 14;
    reasons.push("има сигнал за площ");
  }

  if (candidate.image) {
    score += 5;
    reasons.push("има открита снимка");
  }

  candidate.score = Math.round(score * 10) / 10;
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

/* =========================
   INTENT / PARSING
========================= */

function parseQueryIntent(query) {
  const normalized = normalize(query);

  const location = KNOWN_LOCATIONS.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  let propertyType = PROPERTY_TYPE_RULES.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  const explicitRooms = extractRooms(normalized);

  if (!propertyType && explicitRooms) {
    propertyType = PROPERTY_TYPE_RULES.find(item => item.rooms === explicitRooms) || null;
  }

  return {
    original: query,
    normalized,
    location,
    propertyType,
    rooms: explicitRooms,
    budget: extractBudget(normalized),
    minArea: extractMinArea(normalized)
  };
}

function extractRooms(text) {
  const match = String(text || "").match(/\b([1-4])\s*(стая|стаи|rooms?)\b/i);

  if (!match) return null;

  return Number(match[1]);
}

function extractBudget(text) {
  const patterns = [
    /до\s*([0-9\s]{4,8})\s*(евро|eur|€)/i,
    /([0-9\s]{4,8})\s*(евро|eur|€)/i,
    /\b([0-9]{5,7})\b/i
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

/* =========================
   HTML EXTRACTION HELPERS
========================= */

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

function extractListingChunk(html, rawHref, fallbackText) {
  if (!rawHref) return fallbackText || "";

  const index = html.indexOf(rawHref);
  if (index < 0) return fallbackText || "";

  const start = Math.max(0, index - 1800);
  const end = Math.min(html.length, index + 2600);

  return html.slice(start, end);
}

function deriveListingTitle(anchor, text) {
  const anchorText = cleanText(anchor.text);

  if (anchorText && !isBadAnchorTitle(anchorText) && anchorText.length >= 12) {
    return anchorText.slice(0, 140);
  }

  const clean = cleanText(text);

  const titlePatterns = [
    /(Продава[^.]{10,130})/i,
    /((Едностаен|Двустаен|Тристаен|Четиристаен|Студио|Апартамент)[^.]{10,130})/i,
    /((Апартамент|Студио)[^.]{10,130})/i
  ];

  for (const pattern of titlePatterns) {
    const match = clean.match(pattern);

    if (match) {
      return cleanText(match[1]).slice(0, 140);
    }
  }

  return cleanTitleFromUrl(anchor.url);
}

function extractNearbyImage(html, rawHref, pageUrl) {
  const source = rawHref && html.includes(rawHref)
    ? html.slice(Math.max(0, html.indexOf(rawHref) - 1800), Math.min(html.length, html.indexOf(rawHref) + 2200))
    : html;

  return extractImage(source, pageUrl);
}

function extractTableText(html) {
  const tables = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(html)) !== null) {
    const text = stripHtml(match[0]);

    if (/€|eur|евро|цена|price|площ|area|кв|m2|m²|апартамент|студио|спалн|етаж|floor/i.test(text)) {
      tables.push(text);
    }
  }

  return tables.join(" ").slice(0, 5000);
}

function summarizeTableText(tableText, queryIntent) {
  const text = tableText.replace(/\s+/g, " ").trim();

  const searchTerms = [
    queryIntent.location ? queryIntent.location.canonical : "",
    queryIntent.propertyType ? queryIntent.propertyType.canonical : ""
  ].filter(Boolean);

  for (const term of searchTerms) {
    const index = text.toLowerCase().indexOf(term.toLowerCase());

    if (index >= 0) {
      const start = Math.max(0, index - 120);
      const end = Math.min(text.length, index + 260);

      return "Намерена е информация в ценова таблица: " + text.slice(start, end).trim();
    }
  }

  return "Намерена е ценова таблица или структурирана информация за имоти в тази страница.";
}

function makeExcerpt(text, queryIntent) {
  const clean = cleanText(text);

  const searchTerms = [
    queryIntent.location ? queryIntent.location.canonical : "",
    queryIntent.propertyType ? queryIntent.propertyType.canonical : ""
  ].filter(Boolean);

  for (const term of searchTerms) {
    const index = clean.toLowerCase().indexOf(term.toLowerCase());

    if (index >= 0) {
      const start = Math.max(0, index - 90);
      const end = Math.min(clean.length, index + 220);

      return clean.slice(start, end).trim();
    }
  }

  return clean.slice(0, 260);
}

/* =========================
   URL / FETCH / UTILS
========================= */

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
    ".css", ".js", ".json", ".woff", ".woff2", ".svg",
    "/login", "/register", "/privacy", "/terms", "/contacts",
    "/contact", "/help", "facebook.com", "instagram.com", "youtube.com"
  ].some(part => lower.includes(part));
}

function isGenericUrl(url) {
  const lower = String(url || "").toLowerCase();

  return [
    "kontakti", "contact", "za-nas", "about", "uslugi", "services",
    "privacy", "cookie", "obshti-usloviya", "terms", "category", "tag"
  ].some(part => lower.includes(part));
}

function isBadAnchorTitle(text) {
  const clean = normalize(text);

  if (!clean) return true;
  if (clean.length < 6) return true;

  return [
    "виж на карта",
    "виж карта",
    "карта",
    "следваща",
    "предишна",
    "подреди",
    "сортиране",
    "показване",
    "филтри",
    "вход",
    "регистрация",
    "любими",
    "запази",
    "отвори",
    "още",
    "детайли",
    "меню"
  ].some(bad => clean === bad || clean.includes(bad));
}

function extractImage(html, pageUrl = "") {
  let image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";

  if (!image) {
    const imgRegex = /<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const candidate = toAbsoluteUrl(match[1], pageUrl);
      if (!candidate) continue;

      const lower = candidate.toLowerCase();

      if (lower.includes("logo")) continue;
      if (lower.includes("icon")) continue;
      if (lower.includes("sprite")) continue;
      if (lower.includes("placeholder")) continue;
      if (lower.includes("blank")) continue;

      image = candidate;
      break;
    }
  }

  return image;
}

function extractTitle(html) {
  const og = extractMeta(html, "og:title");
  if (og) return og;

  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return match ? decodeHtml(stripHtml(match[1]).trim()) : "";
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

function extractLocs(xml) {
  const locs = [];
  const regex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    locs.push(decodeHtml(match[1].trim()));
  }

  return locs;
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
