// =============================================================================
// discovery/providers/escavador.js — adapter legal (T033, US4).
// Compatível com a API do Escavador: movimentações e processos por CNPJ/nome.
// Opcional e budget-gated — mesmo contrato do jusbrasil (caseObservation comum).
// =============================================================================

const { httpJson } = require('../http');
const { caseObservation } = require('./jusbrasil');

const MAX_CASES = 50;

function isConfigured() {
  return Boolean(process.env.ESCAVADOR_TOKEN);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.ESCAVADOR_TOKEN, timeoutMs = 20000 } = {}) {
  const { cnpj, companyName } = input;
  if (!cnpj && !companyName) {
    const e = new Error('escavador: cnpj ou companyName obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('escavador: ESCAVADOR_TOKEN ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const params = cnpj ? `cnpj=${encodeURIComponent(cnpj)}` : `q=${encodeURIComponent(companyName)}`;
  const json = await httpJson(`https://api.escavador.com/api/v2/processos?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    timeoutMs,
    fetchImpl,
  });
  const lawsuits = (json.data || json.results || []).slice(0, MAX_CASES);
  return { items: lawsuits.map((l) => caseObservation(l, 'escavador')), requests: 1, estimatedCost: 0 };
}

module.exports = { name: 'escavador', capabilities: ['legal.cases', 'legal.documents'], isConfigured, execute, MAX_CASES };
