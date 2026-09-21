// =============================================================================
// discovery/providers/funding.js — rodadas de investimento (T030, US4).
// Adapter opcional sobre agregador compatível (FUNDING_BASE_URL + key) que
// responde { rounds: [{ companyCnpj, name, date, amount, currency, stage,
// investors: [{ name }] }] } — vendor-neutral após o adapter.
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const MAX_ROUNDS = 25;

function isConfigured() {
  return Boolean(process.env.FUNDING_BASE_URL);
}

async function execute(input = {}, { fetchImpl = fetch, baseUrl = process.env.FUNDING_BASE_URL, apiKey = process.env.FUNDING_API_KEY, timeoutMs = 20000 } = {}) {
  const cnpj = normalizer.normalizeCnpj(input.cnpj);
  if (!cnpj) {
    const e = new Error('funding: cnpj válido obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!baseUrl) {
    const e = new Error('funding: FUNDING_BASE_URL ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const url = `${String(baseUrl).replace(/\/+$/, '')}/rounds?cnpj=${cnpj}`;
  const json = await httpJson(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeoutMs,
    fetchImpl,
  });
  const rounds = (json.rounds || []).slice(0, MAX_ROUNDS);

  const items = [];
  for (const round of rounds) {
    items.push({
      entityType: 'funding_round',
      value: `${cnpj}:${round.name || round.stage || round.date || ''}`,
      displayName: round.name || `Rodada ${round.stage || ''} ${round.date || ''}`.trim(),
      attributes: {
        companyCnpj: cnpj,
        stage: round.stage || null,
        amount: round.amount != null ? Number(round.amount) : null,
        currency: round.currency || 'BRL',
        announcedAt: round.date || null,
        // Dados de funding são públicos/marcados como reported (nunca audited).
        reported: true,
      },
      evidenceType: 'reported',
      confidence: confidenceFor('funding'),
      sourceProvider: 'funding',
      sourceUrl: round.sourceUrl || url,
      sourceRef: `funding:${cnpj}:${round.name || round.date || ''}`,
      observedAt: round.date ? new Date(round.date) : null,
      related: (round.investors || []).map((inv) => ({
        entityType: 'company',
        value: inv.cnpj || inv.name,
        displayName: inv.name,
        type: 'INVESTED_BY',
      })),
    });
  }
  return { items, requests: 1, estimatedCost: 0 };
}

module.exports = { name: 'funding', capabilities: ['financial.funding'], isConfigured, execute, MAX_ROUNDS };
