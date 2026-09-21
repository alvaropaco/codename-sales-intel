// =============================================================================
// discovery/providers/exa.js — provider de busca semântica pago (T013, US3).
// api.exa.ai/search.
// =============================================================================

const { httpJson } = require('../http');
const { mapResults } = require('./search-common');

const ESTIMATED_COST_CENTS_PER_REQUEST = 0.5; // ~US$5 / 1k buscas

function isConfigured() {
  return Boolean(process.env.EXA_API_KEY);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.EXA_API_KEY } = {}) {
  const query = String(input.query || '').trim();
  if (!query) {
    const e = new Error('exa: query obrigatória');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('exa: EXA_API_KEY ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const json = await httpJson('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: { query, numResults: Math.min(Number(input.limit) || 10, 20) },
    fetchImpl,
  });
  return { items: mapResults(json.results, 'exa'), requests: 1, estimatedCost: ESTIMATED_COST_CENTS_PER_REQUEST };
}

module.exports = { name: 'exa', capabilities: ['web.search'], isConfigured, execute, ESTIMATED_COST_CENTS_PER_REQUEST };
