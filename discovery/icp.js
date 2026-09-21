// =============================================================================
// discovery/icp.js — pontuação de candidatos contra o ICP da org (T060, US1).
//
// ICP = criteria capturados no onboarding (CNAE/segmento/localização) e
// carregados no job. Score DETERMINÍSTICO em [0,1]: UF 0.4 + cidade 0.3 +
// CNAE/segmento 0.3. Sem criteria (ou sem campos comparáveis) → null —
// ausência de ICP NUNCA filtra nem penaliza candidato.
// =============================================================================

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * attributes: { state, city, industry, cnaes } (atributos da empresa observada).
 * criteria:   { state, city, cnae, industry, segment } (ICP do job).
 */
function scoreIcp(attributes = {}, criteria = null) {
  if (!criteria || typeof criteria !== 'object') return null;
  let score = 0;
  let checks = 0;

  if (criteria.state) {
    checks += 1;
    if (norm(attributes.state) === norm(criteria.state)) score += 0.4;
  }
  if (criteria.city) {
    checks += 1;
    if (norm(attributes.city) === norm(criteria.city)) score += 0.3;
  }
  const needles = [criteria.cnae, criteria.industry, criteria.segment].map(norm).filter(Boolean);
  if (needles.length) {
    checks += 1;
    const haystack = norm([attributes.industry, ...(Array.isArray(attributes.cnaes) ? attributes.cnaes : [])].join(' '));
    if (haystack && needles.some((needle) => haystack.includes(needle))) score += 0.3;
  }

  return checks ? Math.round(score * 100) / 100 : null;
}

module.exports = { scoreIcp };
