// =============================================================================
// discovery/providers/brave.js — provider de busca pago (T013, US3).
// api.search.brave.com/res/v1/web/search.
// =============================================================================

const { httpJson } = require('../http');
const { mapResults } = require('./search-common');

const ESTIMATED_COST_CENTS_PER_REQUEST = 0.3; // ~US$3 / 1k buscas

function isConfigured() {
  return Boolean(process.env.BRAVE_API_KEY);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.BRAVE_API_KEY } = {}) {
  const query = String(input.query || '').trim();
  if (!query) {
    const e = new Error('brave: query obrigatória');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('brave: BRAVE_API_KEY ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const json = await httpJson(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Number(input.limit) || 10, 20)}`,
    { headers: { 'X-Subscription-Token': apiKey }, fetchImpl }
  );
  const results = (json.web && json.web.results) || [];
  return { items: mapResults(results, 'brave'), requests: 1, estimatedCost: ESTIMATED_COST_CENTS_PER_REQUEST };
}

module.exports = { name: 'brave', capabilities: ['web.search'], isConfigured, execute, ESTIMATED_COST_CENTS_PER_REQUEST };
