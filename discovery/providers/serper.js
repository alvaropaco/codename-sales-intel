// =============================================================================
// discovery/providers/serper.js — provider de busca pago (T012, US3).
// google.serper.dev/search; custo estimado por request para orçamento.
// =============================================================================

const { httpJson } = require('../http');
const { mapResults } = require('./search-common');

const ESTIMATED_COST_CENTS_PER_REQUEST = 0.03; // ~US$0,30 / 1k buscas

function isConfigured() {
  return Boolean(process.env.SERPER_API_KEY);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.SERPER_API_KEY } = {}) {
  const query = String(input.query || '').trim();
  if (!query) {
    const e = new Error('serper: query obrigatória');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('serper: SERPER_API_KEY ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const json = await httpJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: { q: query, num: Math.min(Number(input.limit) || 10, 20) },
    fetchImpl,
  });
  return { items: mapResults(json.organic, 'serper'), requests: 1, estimatedCost: ESTIMATED_COST_CENTS_PER_REQUEST };
}

module.exports = { name: 'serper', capabilities: ['web.search'], isConfigured, execute, ESTIMATED_COST_CENTS_PER_REQUEST };
