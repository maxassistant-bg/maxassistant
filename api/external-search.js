const SOURCES = [
  {
    name: "NewHome Bulgaria",
    domain: "newhomebulgaria.com",
    baseUrl: "https://newhomebulgaria.com",
    type: "trusted_core",
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

const SITEMAP_PATHS = ["/wp-sitemap.xml", "/sitemap.xml", "/sitemap_index.xml"];

const KNOWN_LOCATIONS = [
  {
    canonical: "созопол",
    aliases: ["созопол", "sozopol"]
  },
  {
    canonical: "слънчев бряг",
    aliases: ["слънчев бряг", "slanchev bryag", "sunny beach", "sunny-beach"]
  },
  {
    canonical: "свети влас",
    aliases: ["свети влас", "sveti vlas", "sveti-vlas", "vlas"]
  },
  {
    canonical: "бургас",
    aliases: ["бургас", "burgas"]
  },
  {
    canonical: "черноморец",
    aliases: ["черноморец", "chernomorets"]
  },
  {
    canonical: "поморие",
    aliases: ["поморие", "pomorie"]
  },
  {
    canonical: "равда",
    aliases: ["равда", "ravda"]
  },
  {
    canonical: "несебър",
    aliases: ["несебър", "nesebar", "nessebar"]
  },
  {
    canonical: "лозенец",
    aliases: ["лозенец", "lozenets"]
  },
  {
    canonical: "царево",
    aliases: ["царево", "tsarevo"]
  }
];

const BLOCKED_URL_PARTS = [
  ".css", ".js", ".xml", ".json", ".woff", ".woff2", ".ttf", ".eot", ".svg",
  "/wp-content/", "/wp-includes/", "/wp-json/", "/feed/", "/comments/",
  "/trackback/", "/xmlrpc", "translate", "plugins", "themes", "fonts",
  "admin", "login", "author", "tag/", "category/", "cart", "checkout"
];

const GENERIC_PAGE_HINTS = [
  "брокерски услуги",
  "предложи имот",
  "градски имоти",
  "ваканционни имоти",
  "начало",
  "контакти",
  "за нас",
  "услуги",
  "политика",
  "cookie",
  "privacy"
];

const PROPERTY_URL_HINTS = [
  "listing", "apartament", "apartamenti", "imot", "imoti", "nedvizhimi",
  "prodazhba", "kompleks", "complex", "resort", "residence", "green-life",
  "cascadas", "city-residence", "vista-verde", "kasa-blanka", "sozopol",
  "slanchev", "sunny", "burgas", "chernomorets", "sveti-vlas", "vlas",
  "pomorie", "ravda", "nesebar", "lozenets", "tsarevo"
];

const PROPERTY_TEXT_HINTS = [
  "€", "евро", "цена", "кв.м", "кв м", "m2", "апартамент", "студио",
  "спалня", "спални", "етаж", "площ", "акт 16", "такса поддръжка",
  "обзаведен", "необзаведен", "до ключ", "продажба"
];

const MAX_SITEMAPS_PER_SOURCE = 8;
const MAX_URLS_PER_SOURCE = 80;
const MAX_PAGE_FETCHES_PER_SOURCE = 12;
const REQUEST_TIMEOUT_MS = 7000;
const MIN_REAL_PROPERTY_SCORE = 45;

module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query"
    });
  }

  try {
    const detectedLocations = detectQueryLocations(q);
    const enabledSources = SOURCES.filter(source => source.enabled);

    let finalResults = [];

    // Priority order is preserved:
    // 1. NewHome
    // 2. trusted portals
    // 3. trusted developer sites
    // But if NewHome has only 1-2 results, we continue with the next sources
    // until we collect enough high-quality matches.
    for (const source of enabledSources) {
      const sourceResults = await searchSource(source, q, detectedLocations);

      finalResults.push(...sourceResults);

      if (finalResults.length >= 5) {
        break;
      }
    }

    const results = finalResults
      .sort((a, b) => {
        if (b.source_priority !== a.source_priority) {
          return b.source_priority - a.source_priority;
        }

        return b.score - a.score;
      })
      .slice(0, 5);

    return res.status(200).json({
      ok: true,
      query: q,
      mode: "external_search_v5_strict_location_priority",
      detected_locations: detectedLocations.map(location => location.canonical),
      total: results.length,
      results
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "External search failed",
      error: error.message
    });
  }
};

async function searchSource(source, query, detectedLocations) {
  const tokens = tokenize(query, detectedLocations);

  let urls = await discoverUrls(source);
  if (!urls.length) urls = await fallbackHomepageLinks(source);

  urls = unique(urls)
    .filter(url => isAllowedUrl(url, source.domain))
    .filter(url => !isBlockedUrl(url))
    .filter(url => isPropertyLikeUrl(url, source))
    .slice(0, MAX_URLS_PER_SOURCE);

  const urlMatches = urls
    .map(url => ({ url, urlScore: scoreUrl(url, tokens, source, detectedLocations) }))
    .filter(item => item.urlScore > 0 || source.type === "trusted_core")
    .sort((a, b) => b.urlScore - a.urlScore)
    .slice(0, MAX_PAGE_FETCHES_PER_SOURCE);

  const pages = await Promise.all(
    urlMatches.map(candidate =>
      fetchPageResult(source, candidate.url, query, tokens, detectedLocations, candidate.urlScore)
    )
  );

  return pages
    .filter(Boolean)
    .filter(page => page.real_property_match === true)
    .sort((a, b) => b.score - a.score);
}

async function discoverUrls(source) {
  const foundUrls = [];
  const visitedSitemaps = new Set();

  for (const path of SITEMAP_PATHS) {
    const sitemapUrl = source.baseUrl.replace(/\/$/, "") + path;
    const urls = await readSitemapRecursive(sitemapUrl, source, visitedSitemaps, 0);
    foundUrls.push(...urls);
    if (foundUrls.length >= MAX_URLS_PER_SOURCE) break;
  }

  return unique(foundUrls).slice(0, MAX_URLS_PER_SOURCE);
}

async function readSitemapRecursive(sitemapUrl, source, visited, depth) {
  if (visited.has(sitemapUrl)) return [];
  if (visited.size >= MAX_SITEMAPS_PER_SOURCE) return [];
  if (depth > 2) return [];

  visited.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl);
  if (!xml) return [];

  const locs = extractLocs(xml);
  if (!locs.length) return [];

  const nestedSitemaps = locs
    .filter(url => /sitemap/i.test(url))
    .filter(url => isAllowedUrl(url, source.domain))
    .slice(0, 5);

  const pageUrls = locs.filter(url => !/sitemap/i.test(url));
  const all = [...pageUrls];

  for (const nested of nestedSitemaps) {
    const nestedUrls = await readSitemapRecursive(nested, source, visited, depth + 1);
    all.push(...nestedUrls);
  }

  return unique(all);
}

async function fallbackHomepageLinks(source) {
  const html = await fetchText(source.baseUrl);
  if (!html) return [];

  const links = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const absolute = toAbsoluteUrl(match[1], source.baseUrl);
    if (absolute && isAllowedUrl(absolute, source.domain)) links.push(absolute);
  }

  return unique(links).slice(0, MAX_URLS_PER_SOURCE);
}

async function fetchPageResult(source, url, query, tokens, detectedLocations, urlScore) {
  const html = await fetchText(url);
  if (!html) return null;

  const title = extractTitle(html) || cleanTitleFromUrl(url);
  const description = extractMeta(html, "description");
  const image = extractImage(html, url);
  const clean = stripHtml(html).slice(0, 9000);
  const tableText = extractTableText(html);

  const locationTextForMatch = [
    title,
    description,
    url,
    tableText
  ].join(" ");

  if (detectedLocations.length && !matchesDetectedLocation(locationTextForMatch, detectedLocations)) {
    return null;
  }

  const titleScore = scoreText(title, tokens) * 5;
  const descScore = scoreText(description, tokens) * 3;
  const bodyScore = scoreText(clean, tokens);
  const tableScore = scoreText(tableText, tokens) * 5;

  const propertySignalScore = scorePropertySignals(title + " " + description + " " + clean + " " + tableText);
  const genericPenalty = isGenericPage(title, description, url) ? -100 : 0;
  const newHomeBoost = source.type === "trusted_core" ? 35 : 0;
  const tableBoost = tableText ? 25 : 0;
  const sourceBoost = source.priority / 10;
  const exactLocationBoost = detectedLocations.length ? 35 : 0;

  const score =
    urlScore + titleScore + descScore + bodyScore + tableScore +
    propertySignalScore + genericPenalty + newHomeBoost + tableBoost +
    sourceBoost + exactLocationBoost;

  const realProperty = isRealPropertyResult({
    title,
    description,
    url,
    clean,
    tableText,
    score,
    tokens,
    detectedLocations
  });

  if (!realProperty) return null;
  if (score < MIN_REAL_PROPERTY_SCORE) return null;

  const tableSummary = tableText ? summarizeTableText(tableText, tokens) : "";

  return {
    title,
    url,
    image,
    excerpt: tableSummary || description || makeExcerpt(clean, tokens),
    source: source.name,
    source_domain: source.domain,
    source_type: source.type,
    source_priority: source.priority,
    type: tableText ? "external_page_with_table" : "external_page",
    has_table: Boolean(tableText),
    real_property_match: true,
    match_reason: buildMatchReason({
      source,
      detectedLocations,
      hasTable: Boolean(tableText),
      image,
      title,
      description,
      clean,
      tokens
    }),
    score: Math.round(score * 10) / 10
  };
}

function buildMatchReason({ source, detectedLocations, hasTable, image, title, description, clean, tokens }) {
  const reasons = [];

  if (source.type === "trusted_core") {
    reasons.push("резултатът е от NewHome Bulgaria, който е основният доверен източник");
  } else if (source.type === "trusted_portal") {
    reasons.push("резултатът е от доверен външен портал");

  if (detectedLocations.length) {
    reasons.push("съвпада със зададената локация: " + detectedLocations.map(item => item.canonical).join(", "));
  }

  if (hasTable) {
    reasons.push("страницата съдържа таблица или структурирана информация за имоти");
  }

  const combined = normalize(title + " " + description + " " + clean);

  if (/€|евро/i.test(combined)) {
    reasons.push("има данни за цена");
  }

  if (/кв\.?м|кв м|m2|площ/i.test(combined)) {
    reasons.push("има данни за площ");
  }

  if (/апартамент|студио|спалн/i.test(combined)) {
    reasons.push("съдържа имотни ключови думи");
  }

  if (image) {
    reasons.push("има открита снимка");
  }

  return reasons.slice(0, 4).join("; ");
}

function isRealPropertyResult({ title, description, url, clean, tableText, score, tokens, detectedLocations }) {
  const allForProperty = normalize(title + " " + description + " " + url + " " + clean + " " + tableText);
  const allForLocation = normalize(title + " " + description + " " + url + " " + tableText);

  if (isGenericPage(title, description, url)) return false;

  if (detectedLocations.length && !matchesDetectedLocation(allForLocation, detectedLocations)) {
    return false;
  }

  const hasQueryMatch = tokens.some(token => allForProperty.includes(token));
  const hasPrice = /€|евро|\b[0-9]{2,3}\s?000\b|\b[0-9]{4,}\s?eur\b/i.test(allForProperty);
  const hasArea = /кв\.?м|кв м|m2|площ/i.test(allForProperty);
  const hasPropertyWord = /апартамент|студио|спалн|имот|жилищ|етаж|комплекс|сграда|продажба/i.test(allForProperty);
  const hasTable = Boolean(tableText);

  return hasQueryMatch && hasPropertyWord && (hasPrice || hasArea || hasTable) && score >= MIN_REAL_PROPERTY_SCORE;
}

function detectQueryLocations(query) {
  const normalizedQuery = normalize(query);

  return KNOWN_LOCATIONS.filter(location =>
    location.aliases.some(alias => normalizedQuery.includes(normalize(alias)))
  );
}

function matchesDetectedLocation(text, detectedLocations) {
  const normalizedText = normalize(text);

  return detectedLocations.some(location =>
    location.aliases.some(alias => normalizedText.includes(normalize(alias)))
  );
}

function isGenericPage(title, description, url) {
  const all = normalize(title + " " + description + " " + url);
  return GENERIC_PAGE_HINTS.some(hint => all.includes(normalize(hint)));
}

function scorePropertySignals(text) {
  const normalized = normalize(text);
  let score = 0;

  for (const hint of PROPERTY_TEXT_HINTS) {
    if (normalized.includes(normalize(hint))) score += 6;
  }

  if (/€|евро/i.test(text)) score += 14;
  if (/кв\.?м|кв м|m2|площ/i.test(text)) score += 12;
  if (/спалн|студио|апартамент/i.test(text)) score += 12;

  return score;
}

function extractTableText(html) {
  const tables = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(html)) !== null) {
    const text = stripHtml(match[0]);
    if (/€|eur|евро|цена|price|площ|area|кв|m2|апартамент|студио|спалн|етаж|floor/i.test(text)) {
      tables.push(text);
    }
  }

  return tables.join(" ").slice(0, 5000);
}

function summarizeTableText(tableText, tokens) {
  const text = tableText.replace(/\s+/g, " ").trim();

  for (const token of tokens) {
    const index = text.toLowerCase().indexOf(token);
    if (index >= 0) {
      const start = Math.max(0, index - 120);
      const end = Math.min(text.length, index + 260);
      return "Намерена е информация в ценова таблица: " + text.slice(start, end).trim();
    }
  }

  return "Намерена е ценова таблица или информация за имоти в тази страница.";
}

function isBlockedUrl(url) {
  const lower = url.toLowerCase();
  return BLOCKED_URL_PARTS.some(part => lower.includes(part));
}

function isPropertyLikeUrl(url, source) {
  const lower = url.toLowerCase();

  if (PROPERTY_URL_HINTS.some(hint => lower.includes(hint))) return true;

  if (source.domain === "alo.bg" || source.domain === "imot.bg" || source.domain === "realistimo.com") {
    return /\/obiavi\/|\/properties\/|\/imoti\/|\/prodava\//i.test(lower);
  }

  return false;
}

function scoreUrl(url, tokens, source, detectedLocations) {
  const lower = normalize(url);
  let score = 0;

  for (const token of tokens) {
    if (lower.includes(token)) score += 12;
  }

  if (detectedLocations.length && matchesDetectedLocation(url, detectedLocations)) {
    score += 35;
  }

  if (source.type === "trusted_core") score += 18;
  if (/listing|apartament|prodazhba|imot|kompleks|resort|residence/i.test(url)) score += 14;

  return score;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MaxAssistantBot/1.0 (+https://newhomebulgaria.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) return "";
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

function extractTitle(html) {
  const og = extractMeta(html, "og:title");
  if (og) return og;

  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
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
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1].trim());
  }

  return "";
}

function extractImage(html, pageUrl = "") {
  let image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";

  if (!image) {
    image = extractFirstContentImage(html, pageUrl);
  }

  if (!image) return "";
  if (/placeholder|blank|default|logo|sprite|icon/i.test(image)) return "";
  return image;
}

function extractFirstContentImage(html, pageUrl = "") {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    const absolute = toAbsoluteUrl(src, pageUrl);

    if (!absolute) continue;

    const lower = absolute.toLowerCase();

    if (
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("sprite") ||
      lower.includes("placeholder") ||
      lower.includes("blank") ||
      lower.includes("avatar")
    ) {
      continue;
    }

    if (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp")
    ) {
      return absolute;
    }
  }

  return "";
}

function scoreText(text, tokens) {
  const normalized = normalize(text);
  let score = 0;

  for (const token of tokens) {
    if (normalized.includes(token)) score += 5;
  }

  return score;
}

function tokenize(text, detectedLocations = []) {
  const locationAliases = detectedLocations.flatMap(location =>
    location.aliases.map(alias => normalize(alias))
  );

  return normalize(text)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .filter(token => ![
      "апартамент", "апартаменти", "имот", "имоти", "евро", "кв", "квм", "m2",
      "стаи", "стая", "до", "от", "за", "във", "в", "на", "и"
    ].includes(token))
    .filter(token => !locationAliases.includes(token));
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`~|\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeExcerpt(text, tokens) {
  const normalizedText = String(text || "");
  const lower = normalizedText.toLowerCase();

  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      const start = Math.max(0, index - 90);
      const end = Math.min(normalizedText.length, index + 180);
      return normalizedText.slice(start, end).trim();
    }
  }

  return normalizedText.slice(0, 220).trim();
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

function toAbsoluteUrl(href, baseUrl) {
  try {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return "";
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return "";
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

function unique(array) {
  return [...new Set(array)];
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
