const properties = require("../data/properties.json");
const complexes = require("../data/complexes.json");

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`~|\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectLocalCandidates(query) {
  const normalizedQuery = normalize(query);
  const candidates = [];

  for (const property of properties) {
    let score = 0;
    const reasons = [];

    if (property.location && normalizedQuery.includes(normalize(property.location))) {
      score += 30;
      reasons.push("location_match");
    }

    if (property.complex && normalizedQuery.includes(normalize(property.complex))) {
      score += 40;
      reasons.push("complex_match");
    }

    if (property.property_type && normalizedQuery.includes(normalize(property.property_type))) {
      score += 25;
      reasons.push("property_type_match");
    }

    if (normalizedQuery.includes("целогодишно") && property.year_round === true) {
      score += 25;
      reasons.push("year_round_match");
    }

    if (normalizedQuery.includes("море") && property.view && normalize(property.view).includes("море")) {
      score += 15;
      reasons.push("sea_view_match");
    }

    if (normalizedQuery.includes("обзаведен") && property.furnished === true) {
      score += 15;
      reasons.push("furnished_match");
    }

    if (normalizedQuery.includes("до ключ") && normalize(property.completion_status).includes("до ключ")) {
      score += 15;
      reasons.push("finish_stage_match");
    }

    if (score > 0) {
      const complexData = complexes.find(complex =>
        normalize(complex.name) === normalize(property.complex)
      );

      candidates.push({
        type: "local_property",
        source: "newhome_local_database",
        trust_score: 100,
        relevance_score: score,
        relevance_reasons: reasons,
        property,
        complex_ai_data: complexData || null
      });
    }
  }

  return candidates.sort((a, b) => b.relevance_score - a.relevance_score);
}

module.exports = {
  collectLocalCandidates
};
