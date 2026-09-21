// =============================================================================
// discovery/providers/search-common.js — mapeamento comum das buscas web
// (US3: contrato comum de search — SearXNG, Serper, Brave e Exa emitem a
// MESMA observação; o pipeline nunca acopla a uma API específica).
// =============================================================================

const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

/** Resultado cru { title, url, snippet/content/description } → observação. */
function searchObservation(raw, providerName) {
  const url = normalizer.normalizeUrl(raw.url || raw.link || '');
  const domain = url ? normalizer.normalizeDomain(url) : null;
  const snippet = raw.snippet || raw.description || raw.content || '';
  const related = [];
  if (domain) related.push({ entityType: 'domain', value: domain, type: 'MENTIONS_DOMAIN' });
  return {
    entityType: 'url',
    value: url,
    displayName: raw.title || null,
    attributes: { title: raw.title || null, snippet: snippet.slice(0, 500) || null, domain },
    evidenceType: 'search',
    confidence: confidenceFor(providerName),
    sourceProvider: providerName,
    sourceUrl: url,
    sourceRef: url,
    observedAt: null,
    related,
  };
}

function mapResults(list, providerName) {
  return (list || [])
    .filter((r) => r && (r.url || r.link))
    .map((r) => searchObservation(r, providerName));
}

module.exports = { mapResults };
