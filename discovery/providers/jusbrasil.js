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
  // Partes viram o formato canônico de `related`; eventos/documentos já saem
  // nele (type + metadata em `rel`).
  const partyRelated = [];
  for (const party of lawsuit.parties || []) {
    const isPerson = !normalizer.isValidCnpj(party.document || '');
    partyRelated.push({
      entityType: isPerson ? 'person' : 'company',
      value: party.document || party.name,
      displayName: party.name,
      type: 'INVOLVES',
      attributes: { role: party.role || null },
    });
  }
  // Movimentações → legal_event (T059, FR-023): cada evento é evidência
  // própria, deduplicável por (caso, data, descrição).
  const movements = lawsuit.movements || lawsuit.movimentacoes || [];
  const eventRelated = [];
  for (const movement of movements.slice(0, 20)) {
    const description = movement.description || movement.descricao || movement.text || null;
    const date = movement.date || movement.data || null;
    if (!description) continue;
    eventRelated.push({
      entityType: 'legal_event',
      value: `${caseNumber}|${date || ''}|${description}`,
      displayName: description,
      type: 'HAS_EVENT',
      rel: { date: date || null },
    });
  }
  // Documentos públicos do processo → legal_document (T059, FR-023).
  const documents = lawsuit.documents || lawsuit.documentos || [];
  const documentRelated = [];
  for (const document of documents.slice(0, 10)) {
    const name = document.name || document.nome || null;
    const url = document.url || null;
    if (!name && !url) continue;
    documentRelated.push({
      entityType: 'legal_document',
      value: `${name || ''}|${url || ''}`,
      displayName: name,
      type: 'HAS_DOCUMENT',
      rel: { url: url || null, date: document.date || document.data || null },
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
    related: [...partyRelated, ...eventRelated, ...documentRelated],
  };
}

module.exports = { name: 'jusbrasil', capabilities: ['legal.cases', 'legal.documents'], isConfigured, execute, caseObservation, MAX_CASES };
