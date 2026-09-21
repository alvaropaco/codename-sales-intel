// =============================================================================
// discovery/confidence.js — confiança DETERMINÍSTICA (T006/T047).
//
// Nada de heurística opaca: cada fonte tem um default (research.md), a
// combinação é média aritmética arredondada e a derivação usa mínimo. Mesma
// entrada → mesma saída, sempre (testes T047 validam isso).
// =============================================================================

// Defaults por fonte (research.md — Decision: confidence defaults).
const SOURCE_CONFIDENCE = {
  'cnpj-mcp': 0.98, // registro oficial (CNPJ)
  crtsh: 0.92, // certificate transparency
  'dns-rdap': 0.9, // DNS/RDAP
  'http-metadata': 0.88, // site direto
  projectdiscovery: 0.85, // enumeração passiva de subdomínios
  spiderfoot: 0.7,
  searxng: 0.72, // busca web self-hosted
  serper: 0.72,
  brave: 0.72,
  exa: 0.72,
  cvm: 0.9, // regulador oficial
  jusbrasil: 0.8, // agregador jurídico
  escavador: 0.8,
  funding: 0.75,
  inferred: 0.55, // relação inferida (padrão)
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Confiança default da fonte; override explícito vence (2 casas). */
function confidenceFor(source, override = null) {
  if (override != null && Number.isFinite(Number(override))) {
    return Math.round(clamp01(Number(override)) * 100) / 100;
  }
  const base = SOURCE_CONFIDENCE[source] != null ? SOURCE_CONFIDENCE[source] : 0.5;
  return base;
}

/** Média aritmética arredondada (4 casas) — determinística por construção. */
function combineConfidence(values = []) {
  const nums = (values || []).map(Number).filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  if (!nums.length) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(mean * 10000) / 10000;
}

/** Relação derivada: nunca mais confiável que sua evidência mais fraca. */
function relationshipConfidence(evidenceConfidences = []) {
  const nums = (evidenceConfidences || []).map(Number).filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  if (!nums.length) return 0;
  return Math.round(Math.min(...nums) * 100) / 100;
}

/**
 * Confiança do candidato (projeção de venda): média das evidências com bônus
 * de concordância (+0.02 por fonte extra além da primeira, teto 0.99). CNPJ
 * válido na base oficial ancora o teto em 0.98.
 */
function candidateConfidence(evidenceConfidences = [], { sources = 1, hasOfficialCnpj = false } = {}) {
  let base = combineConfidence(evidenceConfidences);
  if (base > 0) base = Math.min(0.99, base + 0.02 * Math.max(0, sources - 1));
  if (hasOfficialCnpj) base = Math.min(base, 0.98);
  return Math.round(base * 10000) / 10000;
}

module.exports = { SOURCE_CONFIDENCE, confidenceFor, combineConfidence, relationshipConfidence, candidateConfidence };
