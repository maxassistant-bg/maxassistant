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
  { canonical: "созопол", latin: "sozopol", aliases: ["созопол", "sozopol"], aloRegionId: "2", aloLocationId: "490" },
  { canonical: "слънчев бряг", latin: "sunny beach", aliases: ["слънчев бряг", "slanchev bryag", "sunny beach", "sunny-beach"], aloRegionId: "2", aloLocationId: "5549" },
  { canonical: "свети влас", latin: "sveti vlas", aliases: ["свети влас", "sveti vlas", "sveti-vlas", "vlas"], aloRegionId: "2", aloLocationId: "314" },
  { canonical: "бургас", latin: "burgas", aliases: ["бургас", "burgas"], aloRegionId: "2", aloLocationId: "300" },
  { canonical: "черноморец", latin: "chernomorets", aliases: ["черноморец", "chernomorets"], aloRegionId: "2", aloLocationId: "526" },
  { canonical: "поморие", latin: "pomorie", aliases: ["поморие", "pomorie"], aloRegionId: "2", aloLocationId: "445" },
  { canonical: "равда", latin: "ravda", aliases: ["равда", "ravda"], aloRegionId: "2", aloLocationId: "456" },
  { canonical: "несебър", latin: "nesebar", aliases: ["несебър", "nesebar", "nessebar"], aloRegionId: "2", aloLocationId: "430" },
  { canonical: "лозенец", latin: "lozenets", aliases: ["лозенец", "lozenets"], aloRegionId: "2", aloLocationId: "410" },
  { canonical: "царево", latin: "tsarevo", aliases: ["царево", "tsarevo", "carevo"], aloRegionId: "2", aloLocationId: "423" }
];

const PROPERTY_TYPE_RULES = [
  {
    canonical: "студио",
    rooms: 1,
    aliases: ["студио", "studio", "едностаен", "1 стая", "1стаен"],
    searchTerms: ["студио", "studio", "едностаен"],
    aloTypeId: "1573"
  },
  {
    canonical: "една спалня",
    rooms: 2,
    aliases: ["една спалня", "1 спалня", "двустаен", "две стаи", "2 стаи", "one bedroom"],
    searchTerms: ["двустаен", "една спалня", "one bedroom"],
    aloTypeId: "1574"
  },
  {
    canonical: "две спални",
    rooms: 3,
    aliases: ["две спални", "2 спални", "тристаен", "три стаи", "3 стаи", "two bedroom"],
    searchTerms: ["тристаен", "две спални", "two bedroom"],
    aloTypeId: "1575"
  },
  {
    canonical: "три спални",
    rooms: 4,
    aliases: ["три спални", "3 спални", "четиристаен", "4 стаи"],
    searchTerms: ["четиристаен", "три спални"],
    aloTypeId: "1576"
  }
];

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESULTS = 10;
const MAX_SEARCH_PAGES = 3;
const MAX_DETAIL_FETCHES_PER_SOURCE = 10;
const MIN_NEWHOME_SCORE = 42;
const MIN_PORTAL_SCORE = 58;

const EXTERNAL_DISCOVERY_CACHE_TTL_MS = 12 * 60 * 1000;
const EXTERNAL_DISCOVERY_CACHE_MAX_ITEMS = 80;

const externalDiscoveryCache =
  globalThis.__MAX_ASSISTANT_EXTERNAL_DISCOVERY_CACHE__ ||
  new Map();

globalThis.__MAX_ASSISTANT_EXTERNAL_DISCOVERY_CACHE__ = externalDiscoveryCache;


function buildExternalCacheKey(query, queryIntent) {
  const parts = [
    normalize(query),
    queryIntent.location ? queryIntent.location.canonical : "",
    queryIntent.propertyType ? queryIntent.propertyType.canonical : "",
    queryIntent.rooms || "",
    queryIntent.budget || "",
    queryIntent.minArea || ""
  ];

  return parts
    .map(part => String(part || "").trim())
    .filter(Boolean)
    .join("|");
}

function getCachedExternalDiscovery(cacheKey) {
  if (!cacheKey || !externalDiscoveryCache.has(cacheKey)) {
    return null;
  }

  const cached = externalDiscoveryCache.get(cacheKey);

  if (!cached || Date.now() - cached.createdAt > EXTERNAL_DISCOVERY_CACHE_TTL_MS) {
    externalDiscoveryCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function setCachedExternalDiscovery(cacheKey, payload) {
  if (!cacheKey || !payload) return;

  if (externalDiscoveryCache.size >= EXTERNAL_DISCOVERY_CACHE_MAX_ITEMS) {
    const firstKey = externalDiscoveryCache.keys().next().value;

    if (firstKey) {
      externalDiscoveryCache.delete(firstKey);
    }
  }

  externalDiscoveryCache.set(cacheKey, {
    createdAt: Date.now(),
    payload
  });
}

function getCacheAgeSeconds(cacheKey) {
  const cached = externalDiscoveryCache.get(cacheKey);

  if (!cached) return null;

  return Math.round((Date.now() - cached.createdAt) / 1000);
}


module.exports = async function handler(req, res) {
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query",
      mode: "external_discovery_v11_cached_beach_intent",
      results: []
    });
  }

  const diagnostics = [];

  try {
    const queryIntent = parseQueryIntent(q);
    const cacheKey = buildExternalCacheKey(q, queryIntent);
    const cachedResponse = getCachedExternalDiscovery(cacheKey);

    if (cachedResponse) {
      return res.status(200).json({
        ...cachedResponse,
        cache: {
          hit: true,
          key: cacheKey,
          age_seconds: getCacheAgeSeconds(cacheKey),
          ttl_seconds: Math.round(EXTERNAL_DISCOVERY_CACHE_TTL_MS / 1000)
        }
      });
    }

    const enabledSources = SOURCES.filter(source => source.enabled);

    let allResults = [];

    for (const source of enabledSources) {
      const diag = {
        source: source.name,
        domain: source.domain,
        type: source.type,
        mode: source.type === "trusted_site_discovery" ? "newhome_site_discovery" : "portal_search_with_detail_fetch",
        generated_search_urls: 0,
        discovered_urls: 0,
        fetched_search_pages: 0,
        extracted_listing_urls: 0,
        fetched_detail_pages: 0,
        accepted_results: 0,
        status: "started",
        error: null
      };

      try {
        const sourceResults = source.type === "trusted_site_discovery"
          ? await searchNewHomeTrustedSite(source, q, queryIntent, diag)
          : await searchPortalWithDetailPages(source, q, queryIntent, diag);

        allResults.push(...sourceResults);
        diag.accepted_results = sourceResults.length;
        diag.status = "completed";
      } catch (error) {
        diag.status = "failed";
        diag.error = error.message;
      }

      diagnostics.push(diag);
    }

    const results = deduplicateResults(allResults)
      .sort((a, b) => {
        if (b.source_priority !== a.source_priority) return b.source_priority - a.source_priority;
        return b.score - a.score;
      })
      .slice(0, MAX_RESULTS);

    const payload = {
      ok: true,
      query: q,
      mode: "external_discovery_v11_cached_beach_intent",
      philosophy: "Local JSON stays primary. NewHome site discovery is trusted secondary. Portals must pass detail-page extraction before rendering.",
      detected_location: queryIntent.location ? queryIntent.location.canonical : null,
      detected_property_type: queryIntent.propertyType ? queryIntent.propertyType.canonical : null,
      budget: queryIntent.budget,
      min_area: queryIntent.minArea,
      checked_sources: diagnostics,
      total: results.length,
      results,
      cache: {
        hit: false,
        key: cacheKey,
        ttl_seconds: Math.round(EXTERNAL_DISCOVERY_CACHE_TTL_MS / 1000)
      }
    };

    setCachedExternalDiscovery(cacheKey, payload);

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "External discovery failed",
      error: error.message,
      mode: "external_discovery_v11_cached_beach_intent",
      checked_sources: diagnostics,
      results: []
    });
  }
};

/* =========================
   NEWHOME TRUSTED SITE DISCOVERY
========================= */

async function searchNewHomeTrustedSite(source, originalQuery, queryIntent, diag) {
  const urls = await discoverNewHomeUrls(source);
  diag.discovered_urls = urls.length;

  const ranked = urls
    .filter(url => isAllowedUrl(url, source.domain))
    .filter(url => !isBlockedUrl(url))
    .filter(url => isNewHomeRelevantUrl(url, queryIntent))
    .map(url => ({ url, score: scoreNewHomeUrl(url, queryIntent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);

  diag.fetched_detail_pages = ranked.length;

  const pages = await Promise.all(
    ranked.map(item => fetchTrustedSiteDetail(source, item.url, queryIntent, item.score))
  );

  return pages
    .filter(Boolean)
    .filter(item => item.score >= MIN_NEWHOME_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

async function discoverNewHomeUrls(source) {
  const sitemapPaths = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];
  const found = [];
  const visited = new Set();

  for (const path of sitemapPaths) {
    const urls = await readSitemapRecursive(source.baseUrl.replace(/\/$/, "") + path, source, visited, 0);
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
  const nested = locs
    .filter(url => /sitemap/i.test(url))
    .filter(url => isAllowedUrl(url, source.domain))
    .slice(0, 8);

  const pages = locs.filter(url => !/sitemap/i.test(url));
  const all = [...pages];

  for (const n of nested) {
    all.push(...await readSitemapRecursive(n, source, visited, depth + 1));
  }

  return unique(all);
}

async function fetchTrustedSiteDetail(source, url, queryIntent, baseScore) {
  const html = await fetchText(url);
  if (!html) return null;

  const detail = extractDetailFromHtml(html, url);
  const scored = scoreDetailResult(detail, queryIntent, source, baseScore + 35, "trusted_site");

  if (scored.score < MIN_NEWHOME_SCORE) return null;

  return {
    title: detail.title,
    url,
    image: detail.image,
    excerpt: detail.excerpt,
    source: source.name,
    source_domain: source.domain,
    source_type: source.type,
    source_priority: source.priority,
    type: "newhome_trusted_site_result",
    real_property_match: true,
    has_table: detail.hasTable,
    match_reason: scored.reasons.slice(0, 6).join("; "),
    features: scored.features || [],
    feature_labels: formatFeatureLabels(scored.features || []),
    beach_evidence: scored.beach_evidence || null,
    score: Math.round(scored.score * 10) / 10
  };
}

/* =========================
   PORTAL SEARCH + DETAIL PAGE EXTRACTION
========================= */

async function searchPortalWithDetailPages(source, originalQuery, queryIntent, diag) {
  const searchUrls = buildPortalSearchUrls(source, originalQuery, queryIntent);
  diag.generated_search_urls = searchUrls.length;

  const listingUrls = [];

  for (const searchUrl of searchUrls.slice(0, MAX_SEARCH_PAGES)) {
    const html = await fetchText(searchUrl);
    if (!html) continue;

    diag.fetched_search_pages += 1;

    const extracted = extractListingUrlsFromSearchPage(source, html, searchUrl);
    listingUrls.push(...extracted);
  }

  const uniqueListingUrls = unique(listingUrls)
    .filter(url => isAllowedUrl(url, source.domain))
    .filter(url => !isBlockedUrl(url))
    .filter(url => isConcreteListingUrl(url, source))
    .slice(0, MAX_DETAIL_FETCHES_PER_SOURCE);

  diag.extracted_listing_urls = uniqueListingUrls.length;

  const detailPages = await Promise.all(
    uniqueListingUrls.map(url => fetchPortalListingDetail(source, url, queryIntent))
  );

  diag.fetched_detail_pages = uniqueListingUrls.length;

  return detailPages
    .filter(Boolean)
    .filter(item => item.score >= MIN_PORTAL_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function buildPortalSearchUrls(source, originalQuery, queryIntent) {
  const location = queryIntent.location;
  const propertyType = queryIntent.propertyType;

  const bgQuery = normalizeSpaces([
    location ? location.canonical : "",
    propertyType ? propertyType.searchTerms[0] : "",
    queryIntent.budget ? "до " + queryIntent.budget + " евро" : ""
  ].filter(Boolean).join(" ") || originalQuery);

  const latinQuery = normalizeSpaces([
    location ? location.latin : "",
    propertyType ? propertyType.searchTerms[propertyType.searchTerms.length - 1] : "",
    queryIntent.budget ? "up to " + queryIntent.budget + " eur" : ""
  ].filter(Boolean).join(" ") || originalQuery);

  const encodedBg = encodeURIComponent(bgQuery);
  const encodedLatin = encodeURIComponent(latinQuery);

  if (source.domain === "alo.bg") {
    const urls = [];

    if (location && location.aloLocationId && location.aloRegionId) {
      let structured = `https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/?region_id=${location.aloRegionId}&location_ids=${location.aloLocationId}`;

      if (propertyType && propertyType.aloTypeId) {
        structured += `&p[413]=${propertyType.aloTypeId}`;
      }

      if (queryIntent.budget) {
        structured += `&price=_${queryIntent.budget}_EUR`;
      }

      urls.push(structured);
      urls.push(structured + "&order_by=price-asc");
    }

    urls.push(`https://www.alo.bg/searchq/?q=${encodedBg}`);
    urls.push(`https://www.alo.bg/searchq/?q=${encodedLatin}`);
    urls.push(`https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/?q=${encodedBg}`);

    return unique(urls);
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

function extractListingUrlsFromSearchPage(source, html, pageUrl) {
  const anchors = extractAnchors(html, pageUrl);

  return anchors
    .filter(a => !isBadAnchorTitle(a.text))
    .filter(a => isAllowedUrl(a.url, source.domain))
    .filter(a => isConcreteListingUrl(a.url, source))
    .map(a => a.url);
}

async function fetchPortalListingDetail(source, url, queryIntent) {
  const html = await fetchText(url);
  if (!html) return null;

  const detail = extractDetailFromHtml(html, url);

  if (!isConcreteDetailPage(detail, url, source, queryIntent)) {
    return null;
  }

  const scored = scoreDetailResult(detail, queryIntent, source, source.priority / 20, "portal");

  if (scored.score < MIN_PORTAL_SCORE) return null;

  return {
    title: detail.title,
    url,
    image: detail.image,
    excerpt: detail.excerpt,
    source: source.name,
    source_domain: source.domain,
    source_type: source.type,
    source_priority: source.priority,
    type: "external_portal_listing_detail",
    real_property_match: true,
    has_table: detail.hasTable,
    match_reason: scored.reasons.slice(0, 6).join("; "),
    features: scored.features || [],
    feature_labels: formatFeatureLabels(scored.features || []),
    beach_evidence: scored.beach_evidence || null,
    score: Math.round(scored.score * 10) / 10
  };
}

/* =========================
   DETAIL EXTRACTION + SCORING
========================= */

function extractDetailFromHtml(html, url) {
  const title = cleanText(extractTitle(html) || cleanTitleFromUrl(url));
  const description = cleanText(extractMeta(html, "description"));
  const image = extractImage(html, url);
  const tableText = extractTableText(html);
  const clean = cleanText(stripHtml(html)).slice(0, 9000);

  const price = extractPrice([title, description, clean, tableText].join(" "));
  const area = extractArea([title, description, clean, tableText].join(" "));

  const excerpt = makeDetailExcerpt({
    title,
    description,
    clean,
    tableText,
    price,
    area
  });

  return {
    title,
    description,
    image,
    tableText,
    clean,
    excerpt,
    price,
    area,
    hasTable: Boolean(tableText)
  };
}

function scoreDetailResult(detail, queryIntent, source, baseScore, mode) {
  const all = normalize([
    detail.title,
    detail.description,
    detail.excerpt,
    detail.clean,
    detail.tableText
  ].join(" "));

  let score = baseScore;
  const reasons = [];
  const features = extractListingFeatures(all);
  const featureMatch = scoreFeatureMatches(features, queryIntent);
  const beachScore = scoreBeachIntent(all, queryIntent);

  score += featureMatch.score;
  score += beachScore.score;

  if (mode === "trusted_site") {
    reasons.push("резултатът е от NewHome Bulgaria като доверен site discovery layer");
    score += 25;
  } else {
    reasons.push(`резултатът е от ${source.name} като одобрен външен discovery източник`);
  }

  if (queryIntent.location) {
    const ok = queryIntent.location.aliases.some(alias => all.includes(normalize(alias)));

    if (ok) {
      score += 40;
      reasons.push("съвпада със зададената локация: " + queryIntent.location.canonical);
    } else {
      score -= mode === "trusted_site" ? 25 : 70;
      reasons.push("локацията не е ясно потвърдена");
    }
  }

  if (queryIntent.propertyType) {
    const exactType = queryIntent.propertyType.aliases.some(alias => all.includes(normalize(alias)));
    const conflictType = detectConflictingPropertyType(all, queryIntent.propertyType);

    if (conflictType) {
      score -= mode === "trusted_site" ? 35 : 120;
      reasons.push("открит е различен тип имот: " + conflictType);
    } else if (exactType) {
      score += 32;
      reasons.push("съвпада с търсения тип имот: " + queryIntent.propertyType.canonical);
    } else if (hasGeneralApartmentSignal(all)) {
      score += mode === "trusted_site" ? 12 : 4;
      reasons.push("има общ сигнал за апартамент, но типът трябва да се провери");
    } else {
      score -= 25;
    }
  }

  if (queryIntent.budget) {
    if (detail.price) {
      if (detail.price <= queryIntent.budget) {
        score += 30;
        reasons.push("откритата цена е в бюджета");
      } else {
        score -= mode === "trusted_site" ? 18 : 45;
        reasons.push("откритата цена е над бюджета");
      }
    }
  }

  if (queryIntent.minArea) {
    if (detail.area) {
      if (detail.area >= queryIntent.minArea) {
        score += 14;
        reasons.push("откритата площ е над минимума");
      } else {
        score -= 12;
        reasons.push("откритата площ е под минимума");
      }
    }
  }

  if (detail.price) {
    score += 16;
    reasons.push("извлечена е конкретна цена");
  }

  if (detail.area) {
    score += 14;
    reasons.push("извлечена е конкретна площ");
  }

  if (detail.image) {
    score += 5;
    reasons.push("има открита снимка");
  }

  if (!hasGeneralApartmentSignal(all)) {
    score -= 35;
  }

  if (featureMatch.reasons.length) {
    reasons.push(...featureMatch.reasons);
  }

  if (beachScore.reasons.length) {
    reasons.push(...beachScore.reasons);
  }

  return {
    score,
    reasons,
    features,
    beach_evidence: beachScore.evidence
  };
}

/* =========================
   INTENT
========================= */

function parseQueryIntent(query) {
  const normalized = normalize(query);

  const location = KNOWN_LOCATIONS.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  let propertyType = PROPERTY_TYPE_RULES.find(item =>
    item.aliases.some(alias => normalized.includes(normalize(alias)))
  ) || null;

  const rooms = extractRooms(normalized);

  if (!propertyType && rooms) {
    propertyType = PROPERTY_TYPE_RULES.find(item => item.rooms === rooms) || null;
  }

  return {
    original: query,
    normalized,
    location,
    propertyType,
    rooms,
    budget: extractBudget(normalized),
    minArea: extractMinArea(normalized)
  };
}

function extractRooms(text) {
  const match = String(text || "").match(/\b([1-4])\s*(стая|стаи|rooms?)\b/i);
  return match ? Number(match[1]) : null;
}

function extractBudget(text) {
  const patterns = [
    /до\s*([0-9\s]{4,8})\s*(евро|eur|€)/i,
    /([0-9\s]{4,8})\s*(евро|eur|€)/i,
    /\b([0-9]{5,7})\b/i
  ];

  for (const p of patterns) {
    const m = String(text || "").match(p);
    if (!m) continue;

    const value = Number(String(m[1]).replace(/\s+/g, ""));

    if (value > 10000 && value < 2000000) return value;
  }

  return null;
}

function extractMinArea(text) {
  const match = String(text || "").match(/(?:от|минимална площ)\s*([0-9]{2,4})\s*(кв|кв\.м|m2|m²)?/i);

  if (!match) return null;

  const value = Number(match[1]);

  return value > 10 && value < 1000 ? value : null;
}

function extractPrice(text) {
  const patterns = [
    /([0-9]{2,3}(?:\s?[0-9]{3})+|[0-9]{5,7})\s*(€|eur|евро)/i,
    /(€|eur|евро)\s*([0-9]{2,3}(?:\s?[0-9]{3})+|[0-9]{5,7})/i
  ];

  for (const p of patterns) {
    const m = String(text || "").match(p);
    if (!m) continue;

    const raw = m[1].match(/[0-9]/) ? m[1] : m[2];
    const value = Number(String(raw).replace(/\s+/g, ""));

    if (value > 10000 && value < 3000000) return value;
  }

  return null;
}

function extractArea(text) {
  const match = String(text || "").match(/([0-9]{2,4}(?:[.,][0-9]{1,2})?)\s*(кв м|кв\.м|m2|m²)/i);

  if (!match) return null;

  const value = Number(String(match[1]).replace(",", "."));

  return value > 10 && value < 1000 ? value : null;
}

function hasGeneralApartmentSignal(text) {
  return /апартамент|студио|спалн|едностаен|двустаен|тристаен|жилищ|имот|етаж|продажба|продава/i.test(text);
}

/* =========================
   URL RULES
========================= */

function isNewHomeRelevantUrl(url, queryIntent) {
  const lower = normalize(url);

  if (isGenericUrl(url)) return false;

  const propertyLike = /listing|apartament|apartamenti|imot|nedvizhimi|prodazhba|kompleks|resort|residence|green-life|cascadas|city-residence|vista-verde|kasa-blanka|santa-marina/i.test(url);

  if (!propertyLike) return false;

  if (queryIntent.location) {
    const hasLocation = queryIntent.location.aliases.some(alias => lower.includes(normalize(alias)));
    if (hasLocation) return true;
  }

  if (queryIntent.propertyType) {
    const hasType = queryIntent.propertyType.aliases.some(alias => lower.includes(normalize(alias)));
    if (hasType) return true;
  }

  return propertyLike;
}

function scoreNewHomeUrl(url, queryIntent) {
  const lower = normalize(url);
  let score = 0;

  if (/listing|apartament|apartamenti|imot|prodazhba|nedvizhimi/i.test(lower)) score += 30;
  if (/kompleks|resort|residence|green-life|cascadas|city-residence|vista-verde|kasa-blanka|santa-marina/i.test(lower)) score += 16;

  if (queryIntent.location && queryIntent.location.aliases.some(alias => lower.includes(normalize(alias)))) {
    score += 35;
  }

  if (queryIntent.propertyType && queryIntent.propertyType.aliases.some(alias => lower.includes(normalize(alias)))) {
    score += 18;
  }

  return score;
}


function isConcreteListingUrl(url, source) {
  const lower = String(url || "").toLowerCase();

  if (isSearchOrCategoryUrl(url, source)) {
    return false;
  }

  if (source.domain === "alo.bg") {
    return /\/[a-z0-9а-я-]+-[0-9]{6,}\/?$/i.test(lower);
  }

  if (source.domain === "imot.bg") {
    return lower.includes("imot.cgi") && lower.includes("act=5");
  }

  if (source.domain === "realistimo.com") {
    return /\/bg\/(buy|property)\/[^/?#]+/i.test(lower) && !lower.includes("/bg/buy?");
  }

  return false;
}

function isSearchOrCategoryUrl(url, source) {
  const lower = String(url || "").toLowerCase();

  if (source.domain === "alo.bg") {
    return (
      lower.includes("/searchq/") ||
      lower.includes("/obiavi/imoti-prodajbi/apartamenti-stai/") ||
      lower.includes("location_ids=") ||
      lower.includes("order_by=")
    );
  }

  if (source.domain === "imot.bg") {
    return lower.includes("act=3") || lower.includes("rub=");
  }

  if (source.domain === "realistimo.com") {
    return lower.includes("/bg/buy?") || lower.includes("/bg/properties?");
  }

  return false;
}

function isConcreteDetailPage(detail, url, source, queryIntent) {
  if (!detail || !detail.title) return false;

  if (!isConcreteListingUrl(url, source)) {
    return false;
  }

  const all = normalize([
    detail.title,
    detail.description,
    detail.excerpt,
    detail.clean,
    detail.tableText,
    url
  ].join(" "));

  if (!hasGeneralApartmentSignal(all)) {
    return false;
  }

  if (queryIntent.location) {
    const hasLocation = queryIntent.location.aliases.some(alias =>
      all.includes(normalize(alias))
    );

    if (!hasLocation) {
      return false;
    }
  }

  if (queryIntent.propertyType) {
    const conflictType = detectConflictingPropertyType(all, queryIntent.propertyType);

    if (conflictType) {
      return false;
    }

    const exactType = queryIntent.propertyType.aliases.some(alias =>
      all.includes(normalize(alias))
    );

    if (!exactType && source.type === "trusted_portal") {
      return false;
    }
  }

  return Boolean(detail.price || detail.area || /€|eur|евро|кв м|кв\.м|m2|m²/.test(all));
}

function detectConflictingPropertyType(text, requestedType) {
  const normalized = normalize(text);

  if (!requestedType) return "";

  const hasStudio = /студио|едностаен|1 стая|1стаен|studio/.test(normalized);
  const hasOneBedroom = /една спалня|1 спалня|двустаен|две стаи|2 стаи|one bedroom/.test(normalized);
  const hasTwoBedroom = /две спални|2 спални|тристаен|три стаи|3 стаи|two bedroom/.test(normalized);

  if (requestedType.canonical === "студио") {
    if (hasOneBedroom) return "една спалня";
    if (hasTwoBedroom) return "две спални";
  }

  if (requestedType.canonical === "една спалня") {
    if (hasStudio) return "студио";
    if (hasTwoBedroom) return "две спални";
  }

  if (requestedType.canonical === "две спални") {
    if (hasStudio) return "студио";
    if (hasOneBedroom) return "една спалня";
  }

  return "";
}


function isLikelyListingUrl(url, source) {
  const lower = url.toLowerCase();

  if (source.domain === "alo.bg") {
    return /\/[a-z0-9а-я-]+-[0-9]{6,}\/?$/i.test(lower);
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

/* =========================
   HTML HELPERS
========================= */

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[2] || "";
    const inner = match[4] || "";
    const url = toAbsoluteUrl(href, baseUrl);

    if (!url) continue;

    anchors.push({
      rawHref: href,
      url,
      text: cleanText(stripHtml(inner))
    });
  }

  return anchors;
}

function extractTableText(html) {
  const tables = [];
  const regex = /<table[\s\S]*?<\/table>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const text = stripHtml(match[0]);

    if (/€|eur|евро|цена|price|площ|area|кв|m2|m²|апартамент|студио|спалн|етаж|floor/i.test(text)) {
      tables.push(text);
    }
  }

  return tables.join(" ").slice(0, 5000);
}

function makeDetailExcerpt(detail) {
  const parts = [];

  if (detail.price) parts.push(`Цена: ${Number(detail.price).toLocaleString()} €`);
  if (detail.area) parts.push(`Площ: ${detail.area} кв.м`);
  if (detail.description) parts.push(detail.description);
  if (!parts.length && detail.tableText) parts.push(detail.tableText);
  if (!parts.length) parts.push(detail.clean);

  return cleanText(parts.join(" | ")).slice(0, 420);
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
    if (match) return decodeHtml(match[1].trim());
  }

  return "";
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


/* =========================
   FEATURE EXTRACTION LAYER
========================= */

function extractListingFeatures(text) {
  const normalized = normalize(text);
  const features = [];

  const rules = [
    {
      key: "first_line",
      label: "първа линия",
      patterns: [
        /първа линия/i,
        /1-ва линия/i,
        /на първа линия/i,
        /front line/i,
        /beachfront/i
      ]
    },
    {
      key: "sea_view",
      label: "гледка море",
      patterns: [
        /гледка море/i,
        /морска гледка/i,
        /панорама море/i,
        /sea view/i,
        /view.*sea/i
      ]
    },
    {
      key: "near_beach",
      label: "близо до плаж",
      patterns: [
        /до плажа/i,
        /близо до плажа/i,
        /на метри от плажа/i,
        /[0-9]{1,4}\s*м\.?\s*от плажа/i,
        /near beach/i
      ]
    },
    {
      key: "furnished",
      label: "обзаведен",
      patterns: [
        /обзаведен/i,
        /напълно обзаведен/i,
        /с мебели/i,
        /furnished/i
      ]
    },
    {
      key: "no_maintenance_fee",
      label: "без такса поддръжка",
      patterns: [
        /без такса поддръжка/i,
        /без такса/i,
        /no maintenance fee/i
      ]
    },
    {
      key: "act16",
      label: "Акт 16",
      patterns: [
        /акт 16/i,
        /act 16/i,
        /разрешение за ползване/i
      ]
    },
    {
      key: "pool",
      label: "басейн",
      patterns: [
        /басейн/i,
        /pool/i
      ]
    },
    {
      key: "parking",
      label: "паркинг",
      patterns: [
        /паркинг/i,
        /паркомясто/i,
        /parking/i
      ]
    },
    {
      key: "luxury",
      label: "лукс",
      patterns: [
        /лукс/i,
        /луксозен/i,
        /luxury/i
      ]
    }
  ];

  for (const rule of rules) {
    if (rule.patterns.some(pattern => pattern.test(normalized))) {
      features.push({
        key: rule.key,
        label: rule.label
      });
    }
  }

  return deduplicateFeatures(features);
}

function deduplicateFeatures(features) {
  const seen = new Set();

  return features.filter(feature => {
    if (!feature || !feature.key || seen.has(feature.key)) {
      return false;
    }

    seen.add(feature.key);
    return true;
  });
}

function scoreFeatureMatches(features, queryIntent) {
  const queryText = normalize(queryIntent.original || "");
  let score = 0;
  const reasons = [];

  const wantedFeatures = [
    {
      key: "first_line",
      label: "първа линия",
      triggers: ["първа линия", "1-ва линия", "до морето", "front line", "beachfront"]
    },
    {
      key: "sea_view",
      label: "гледка море",
      triggers: ["гледка море", "морска гледка", "панорама море", "sea view"]
    },
    {
      key: "near_beach",
      label: "близо до плаж",
      triggers: ["плаж", "близо до плажа", "до плажа", "на метри от плажа"]
    },
    {
      key: "furnished",
      label: "обзаведен",
      triggers: ["обзаведен", "мебели", "готов за ползване"]
    },
    {
      key: "no_maintenance_fee",
      label: "без такса поддръжка",
      triggers: ["без такса", "без такса поддръжка", "ниска такса"]
    },
    {
      key: "act16",
      label: "Акт 16",
      triggers: ["акт 16", "разрешение за ползване", "готов имот"]
    },
    {
      key: "pool",
      label: "басейн",
      triggers: ["басейн", "комплекс с басейн"]
    },
    {
      key: "parking",
      label: "паркинг",
      triggers: ["паркинг", "паркомясто"]
    }
  ];

  const featureKeys = new Set(features.map(feature => feature.key));

  for (const wanted of wantedFeatures) {
    const isRequested = wanted.triggers.some(trigger =>
      queryText.includes(normalize(trigger))
    );

    if (isRequested && featureKeys.has(wanted.key)) {
      score += 18;
      reasons.push("съвпада с търсен признак: " + wanted.label);
    }
  }

  if (features.length) {
    score += Math.min(features.length * 3, 12);
    reasons.push("извлечени признаци: " + features.map(feature => feature.label).join(", "));
  }

  return {
    score,
    reasons
  };
}

function formatFeatureLabels(features) {
  if (!features || !features.length) return "";
  return features.map(feature => feature.label).join(", ");
}


/* =========================
   BEACH INTENT SCORING LAYER
========================= */

function analyzeBeachIntent(queryIntent) {
  const queryText = normalize(queryIntent.original || "");

  const wantsFirstLine = [
    "първа линия",
    "1-ва линия",
    "1 линия",
    "на първа линия",
    "front line",
    "beachfront"
  ].some(term => queryText.includes(normalize(term)));

  const wantsSeaView = [
    "гледка море",
    "морска гледка",
    "панорама море",
    "sea view"
  ].some(term => queryText.includes(normalize(term)));

  const wantsNearBeach = [
    "до плажа",
    "близо до плажа",
    "до морето",
    "близо до морето",
    "на метри от плажа",
    "плаж",
    "море"
  ].some(term => queryText.includes(normalize(term)));

  return {
    wantsFirstLine,
    wantsSeaView,
    wantsNearBeach,
    hasBeachIntent: wantsFirstLine || wantsSeaView || wantsNearBeach
  };
}

function extractBeachEvidence(text) {
  const normalized = normalize(text);

  const evidence = {
    firstLine: false,
    seaView: false,
    nearBeach: false,
    distanceMeters: null,
    labels: []
  };

  if (/първа линия|1-ва линия|1 линия|на първа линия|front line|beachfront/i.test(normalized)) {
    evidence.firstLine = true;
    evidence.nearBeach = true;
    evidence.distanceMeters = 50;
    evidence.labels.push("първа линия");
  }

  if (/гледка море|морска гледка|панорама море|sea view|view.*sea/i.test(normalized)) {
    evidence.seaView = true;
    evidence.labels.push("гледка море");
  }

  if (/до плажа|близо до плажа|до морето|близо до морето|на метри от плажа|near beach/i.test(normalized)) {
    evidence.nearBeach = true;
    evidence.labels.push("близо до плаж");
  }

  const distancePatterns = [
    /([0-9]{1,4})\s*м\.?\s*от\s*(плажа|морето|брега)/i,
    /([0-9]{1,4})\s*метра\s*от\s*(плажа|морето|брега)/i,
    /на\s*([0-9]{1,4})\s*м\.?\s*от\s*(плажа|морето|брега)/i,
    /([0-9]{1,4})\s*m\s*from\s*(beach|sea)/i
  ];

  for (const pattern of distancePatterns) {
    const match = normalized.match(pattern);

    if (match) {
      const meters = Number(match[1]);

      if (meters > 0 && meters < 5000) {
        evidence.distanceMeters = evidence.distanceMeters
          ? Math.min(evidence.distanceMeters, meters)
          : meters;

        if (meters <= 150) {
          evidence.nearBeach = true;
          evidence.labels.push(`${meters} м от плажа`);
        } else {
          evidence.labels.push(`${meters} м от плажа`);
        }

        break;
      }
    }
  }

  evidence.labels = [...new Set(evidence.labels)];

  return evidence;
}

function scoreBeachIntent(text, queryIntent) {
  const intent = analyzeBeachIntent(queryIntent);

  if (!intent.hasBeachIntent) {
    return {
      score: 0,
      reasons: [],
      evidence: extractBeachEvidence(text)
    };
  }

  const evidence = extractBeachEvidence(text);
  let score = 0;
  const reasons = [];

  if (intent.wantsFirstLine) {
    if (evidence.firstLine) {
      score += 38;
      reasons.push("потвърдено е търсенето за първа линия");
    } else if (evidence.distanceMeters !== null) {
      if (evidence.distanceMeters <= 120) {
        score += 20;
        reasons.push(`имотът е много близо до плажа: ${evidence.distanceMeters} м`);
      } else if (evidence.distanceMeters >= 400) {
        score -= 38;
        reasons.push(`не е първа линия — открито разстояние около ${evidence.distanceMeters} м`);
      } else {
        score -= 12;
        reasons.push(`не е потвърдена първа линия — открито разстояние около ${evidence.distanceMeters} м`);
      }
    } else {
      score -= 10;
      reasons.push("първа линия не е потвърдена в текста");
    }
  }

  if (intent.wantsSeaView) {
    if (evidence.seaView) {
      score += 24;
      reasons.push("потвърдена е морска гледка");
    } else {
      score -= 8;
      reasons.push("морска гледка не е потвърдена");
    }
  }

  if (intent.wantsNearBeach && !intent.wantsFirstLine) {
    if (evidence.nearBeach || (evidence.distanceMeters !== null && evidence.distanceMeters <= 300)) {
      score += 20;
      reasons.push("има потвърждение за близост до плаж/море");
    } else if (evidence.distanceMeters !== null && evidence.distanceMeters >= 600) {
      score -= 20;
      reasons.push(`по-слабо съвпадение за близост до море — около ${evidence.distanceMeters} м`);
    }
  }

  if (evidence.labels.length) {
    reasons.push("морски признаци: " + evidence.labels.join(", "));
  }

  return {
    score,
    reasons,
    evidence
  };
}

/* =========================
   BASIC UTILS
========================= */

function isAllowedUrl(url, domain) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === domain || parsed.hostname.endsWith("." + domain);
  } catch {
    return false;
  }
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
    "виж на карта", "виж карта", "карта", "следваща", "предишна",
    "подреди", "сортиране", "показване", "филтри", "вход",
    "регистрация", "любими", "запази", "отвори", "още",
    "детайли", "меню"
  ].some(bad => clean === bad || clean.includes(bad));
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    if (!href) return "";
    if (href.startsWith("#")) return "";
    if (href.startsWith("mailto:")) return "";
    if (href.startsWith("tel:")) return "";
    if (href.startsWith("javascript:")) return "";

    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
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

function unique(array) {
  return [...new Set(array)];
}

function cleanTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;

    return decodeURIComponent(slug)
      .replace(/[-_]+/g, " ")
      .trim();
  } catch {
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
  return String(text || "").replace(/\s+/g, " ").trim();
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
