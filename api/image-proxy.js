const ALLOWED_IMAGE_HOSTS = [
  "alo.bg",
  "www.alo.bg",
  "imot.bg",
  "www.imot.bg",
  "realistimo.com",
  "www.realistimo.com",
  "newhomebulgaria.com",
  "www.newhomebulgaria.com"
];

const IMAGE_TIMEOUT_MS = 8000;

module.exports = async function handler(req, res) {
  const rawUrl = String(req.query.url || "").trim();

  if (!rawUrl) {
    return res.status(400).send("Missing image url");
  }

  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).send("Invalid image url");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).send("Unsupported image protocol");
  }

  if (!ALLOWED_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return res.status(403).send("Image host is not allowed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
        "Referer": `${parsed.protocol}//${parsed.hostname}/`
      }
    });

    if (!response.ok) {
      return res.status(response.status).send("Image fetch failed");
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";

    if (!contentType.toLowerCase().startsWith("image/")) {
      return res.status(415).send("Remote resource is not an image");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.status(200).send(buffer);
  } catch (error) {
    res.status(502).send(error && error.name === "AbortError" ? "Image fetch timed out" : "Image proxy failed");
  } finally {
    clearTimeout(timeout);
  }
};
