export default async function handler(req, res) {
  const { q = "" } = req.query;

  const allowedSources = [
    {
      name: "NewHome Bulgaria",
      domain: "newhomebulgaria.com",
      searchUrl: `https://newhomebulgaria.com/?s=${encodeURIComponent(q)}`
    }
  ];

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      ok: false,
      message: "Missing search query"
    });
  }

  return res.status(200).json({
    ok: true,
    query: q,
    sources: allowedSources,
    results: [
      {
        title: `Търсене в NewHomeBulgaria за: ${q}`,
        url: allowedSources[0].searchUrl,
        source: "NewHome Bulgaria",
        type: "external_search_link"
      }
    ]
  });
}
