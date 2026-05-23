module.exports = async function handler(req, res) {
  const q = req.query.q || "";

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query"
    });
  }

  const searchUrl = `https://newhomebulgaria.com/?s=${encodeURIComponent(q)}`;

  return res.status(200).json({
    ok: true,
    query: q,
    results: [
      {
        title: `Търсене в NewHomeBulgaria за: ${q}`,
        url: searchUrl,
        source: "NewHome Bulgaria",
        type: "external_search_link"
      }
    ]
  });
};
