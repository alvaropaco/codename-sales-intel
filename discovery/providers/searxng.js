// =============================================================================
// discovery/providers/searxng.js — provider de busca self-hosted (T011, US1).
// Preferencial por ser self-hosted (research.md): sem custo, sem API key.
// Reaproveita o cliente compartilhado searxng.js.
// =============================================================================

const { searxSearch } = require('../../searxng');
const { mapResults } = require('./search-common');

async function execute(input = {}, { client = searxSearch } = {}) {
  const query = String(input.query || '').trim();
  if (!query) {
    const e = new Error('searxng: query obrigatória');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  const limit = Math.min(Number(input.limit) || 10, 20);
  const results = await client(query, { limit });
  return { items: mapResults(results, 'searxng'), requests: 1, estimatedCost: 0 };
}

module.exports = { name: 'searxng', capabilities: ['web.search'], isConfigured: () => true, execute };
