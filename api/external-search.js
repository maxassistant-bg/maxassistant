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
  },
  {
    name: "Vista Verde",
    domain: "lavistaverde.eu",
    baseUrl: "https://www.lavistaverde.eu",
    type: "trusted_developer",
    enabled: true,
    priority: 130
  },
  {
    name: "Green Life",
    domain: "greenlife.bg",
    baseUrl: "https://greenlife.bg",
    type: "trusted_developer",
    enabled: true,
    priority: 120
  }
];

const SITEMAP_PATHS = [
  "/wp-sitemap.xml",
  "/sitemap.xml",
  "/sitemap_index.xml"
];

const BLOCKED_URL_PARTS = [
  ".css",
  ".js",
  ".xml",
  ".json",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".svg",
  "/wp-content/",
  "/wp-includes/",
  "/wp-json/",
  "/feed/",
  "/comments/",
  "/trackback/",
  "/xmlrpc",
  "translate",
  "plugins",
  "themes",
  "fonts",
  "admin",
  "login"
];

const PROPERTY_URL_HINTS = [
  "listing",
  "apartament",
  "apartamenti",
  "imot",
  "imoti",
  "nedvizhimi",
  "prodazhba",
  "kompleks",
  "complex",
  "resort",
  "residence",
  "sozopol",
  "slanchev",
  "sunny",
  "burgas",
  "chernomorets",
  "sveti-vlas",
  "vlas",
  "pomorie",
  "ravda",
  "nesebar",
  "lozenets",
  "tsarevo",
  "kasa",
  "vista",
  "green-life",
  "cascadas",
  "city-residence"
];

const MAX_SITEMAPS_PER_SOURCE = 8;
const MAX_URLS_PER_SOURCE = 80;
const MAX_PAGE_FETCHES_PER_SOURCE = 10;
const REQUEST_TIMEOUT_MS = 7000;

module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query"
    });
  }

  try {
    const enabledSources = SOURCES.filter(source => source.enabled);

    const sourceResults = await Promise.all(
      enabledSources.map(source => searchSource(source, q))
    );

    const results = sourceResults
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    return res.status(200).json({
      ok: true,
      query: q,
      mode: "external_search_v3_curated_sources_table_parser",
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

async function searchSource(source, query) {
  const tokens = tokenize(query);

  let urls = await discoverUrls(source);

  if (!urls.length) {
    urls = await fallbackHomepageLinks(source);
  }

  urls = unique(urls)
    .filter(url => isAllowedUrl(url, source.domain))
    .filter(url => !isBlockedUrl(url))
    .filter(url => isPropertyLikeUrl(url, source))
    .slice(0, MAX_URLS_PER_SOURCE);

  const urlMatches = urls
    .map(url => ({
      url,
      urlScore: scoreUrl(url, tokens, source)
    }))
    .filter(item => item.urlScore > 0 || source.type === "trusted_core")
    .sort((a, b) => b.urlScore - a.urlScore);

  const candidates = urlMatches
    .slice(0, MAX_PAGE_FETCHES_PER_SOURCE);

  const pages = await Promise.all(
    candidates.map(candidate => fetchPageResult(source, candidate.url, query, tokens, candidate.urlScore))
  );

  return pages
    .filter(Boolean)
    .filter(page => page.score > 0)
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
    if (absolute && isAllowedUrl(absolute, source.domain)) {
      links.push(absolute);
    }
  }

  return unique(links).slice(0, MAX_URLS_PER_SOURCE);
}

async function fetchPageResult(source, url, query, tokens, urlScore) {
  const html = await fetchText(url);

  if (!html) {
    return null;
  }

  const title = extractTitle(html) || cleanTitleFromUrl(url);
  const description = extractMeta(html, "description");
  const image = extractImage(html);
  const clean = stripHtml(html).slice(0, 7000);
  const tableText = extractTableText(html);

  const titleScore = scoreText(title, tokens) * 4;
  const descScore = scoreText(description, tokens) * 3;
  const bodyScore = scoreText(clean, tokens);
  const tableScore = scoreText(tableText, tokens) * 4;

  const newHomeBoost = source.type === "trusted_core" ? 35 : 0;
  const tableBoost = tableText ? 18 : 0;
  const sourceBoost = source.priority / 10;

  const score =
    urlScore +
    titleScore +
    descScore +
    bodyScore +
    tableScore +
    tableBoost +
    newHomeBoost +
    sourceBoost;

  if (score <= 0) return null;

  const tableSummary = tableText ? summarizeTableText(tableText, tokens) : "";

  return {
    title,
    url,
    image,
    excerpt: tableSummary || description || makeExcerpt(clean, tokens),
    source: source.name,
    source_domain: source.domain,
    source_type: source.type,
    type: tableText ? "external_page_with_table" : "external_page",
    has_table: Boolean(tableText),
    score: Math.round(score * 10) / 10
  };
}

function extractTableText(html) {
  const tables = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(html)) !== null) {
    const text = stripHtml(match[0]);
    if (
      /€|eur|евро|цена|price|площ|area|кв|m2|апартамент|студио|спалн|етаж|floor/i.test(text)
    ) {
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

  if (source.type === "trusted_core") {
    return PROPERTY_URL_HINTS.some(hint => lower.includes(hint));
  }

  if (
    source.domain === "alo.bg" ||
    source.domain === "imot.bg" ||
    source.domain === "realistimo.com"
  ) {
    return (
      PROPERTY_URL_HINTS.some(hint => lower.includes(hint)) ||
      /\/obiavi\/|\/properties\/|\/imoti\/|\/prodava\//i.test(lower)
    );
  }

  return PROPERTY_URL_HINTS.some(hint => lower.includes(hint));
}

function scoreUrl(url, tokens, source) {
  const lower = normalize(url);
  let score = 0;

  for (const token of tokens) {
    if (lower.includes(token)) score += 10;
  }

  if (source.type === "trusted_core") score += 20;

  if (/listing|apartament|prodazhba|imot|kompleks|resort|residence/i.test(url)) {
    score += 12;
  }

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

function extractImage(html) {
  return (
    extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image") ||
    ""
  );
}

function scoreText(text, tokens) {
  const normalized = normalize(text);
  let score = 0;

  for (const token of tokens) {
    if (normalized.includes(token)) score += 5;
  }

  return score;
}

function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .filter(token => ![
      "апартамент",
      "апартаменти",
      "имот",
      "имоти",
      "евро",
      "кв",
      "квм",
      "m2",
      "стаи",
      "стая",
      "до",
      "от",
      "за",
      "във",
      "в",
      "на",
      "и"
    ].includes(token));
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
    const slug = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop() || parsed.hostname;

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
