// =============================================================================
// discovery/providers/jusbrasil.js — adapter legal (T033, US4).
// Compatível com a API v2 do Jusbrasil (SOAP/REST x API key): processos por
// CNPJ/nome → casos normalizados. Opcional e budget-gated: sem token, o run
// termina NOT_CONFIGURED e o job segue (SC-001).
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const MAX_CASES = 50;

function isConfigured() {
  return Boolean(process.env.JUSBRASIL_TOKEN);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.JUSBRASIL_TOKEN, timeoutMs = 20000 } = {}) {
  const { cnpj, companyName } = input;
  if (!cnpj && !companyName) {
    const e = new Error('jusbrasil: cnpj ou companyName obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('jusbrasil: JUSBRASIL_TOKEN ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const params = cnpj ? `cnpj=${encodeURIComponent(cnpj)}` : `name=${encodeURIComponent(companyName)}`;
  const json = await httpJson(`https://api.jusbrasil.com.br/v2/lawsuits?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs,
    fetchImpl,
  });
  const lawsuits = (json.lawsuits || json.results || []).slice(0, MAX_CASES);
  return { items: lawsuits.map((l) => caseObservation(l, 'jusbrasil')), requests: 1, estimatedCost: 0 };
}

/** Processo vendor → observação legal_case vendor-neutral (data-model.md). */
function caseObservation(lawsuit, providerName) {
  const caseNumber = String(lawsuit.number || lawsuit.lawsuitNumber || '').trim();
  const related = [];
  for (const party of lawsuit.parties || []) {
    const isPerson = !normalizer.isValidCnpj(party.document || '');
    related.push({
      entityType: isPerson ? 'person' : 'company',
      value: party.document || party.name,
      displayName: party.name,
      attributes: { role: party.role || null },
      rel: 'INVOLVES',
    });
  }
  return {
    entityType: 'legal_case',
    value: caseNumber,
    displayName: lawsuit.title || caseNumber,
    attributes: {
      court: lawsuit.court || lawsuit.courtName || null,
      jurisdiction: lawsuit.jurisdiction || null,
      kind: lawsuit.kind || lawsuit.caseType || null,
      subject: lawsuit.subject || null,
      status: lawsuit.status || null,
      filedAt: lawsuit.filedAt || lawsuit.distributionDate || null,
      lastMovementAt: lawsuit.lastMovementAt || null,
      claimValue: lawsuit.claimValue != null ? lawsuit.claimValue : null,
    },
    evidenceType: 'legal',
    confidence: confidenceFor(providerName),
    sourceProvider: providerName,
    sourceUrl: lawsuit.url || null,
    sourceRef: caseNumber ? `case:${caseNumber}` : null,
    observedAt: lawsuit.lastMovementAt ? new Date(lawsuit.lastMovementAt) : null,
    related: related.map((r) => ({
      entityType: r.entityType, value: r.value, type: r.rel,
      displayName: r.displayName, attributes: r.attributes,
    })),
  };
}

module.exports = { name: 'jusbrasil', capabilities: ['legal.cases', 'legal.documents'], isConfigured, execute, caseObservation, MAX_CASES };
