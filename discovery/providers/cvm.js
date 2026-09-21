// =============================================================================
// discovery/providers/cvm.js — dados regulatórios financeiros (T028, US4).
// Adapter sobre base pública espelhada (CVM_BASE_URL, default dados.cvm.gov.br
// via CSV de cadastro — heavy, então o adapter consome um mirror JSON com o
// contrato { cnpj, capitalSocial, situacao, cnaes } documentado no quickstart).
// Sem mirror configurado → NOT_CONFIGURED (opcional no v1).
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

function isConfigured() {
  return Boolean(process.env.CVM_BASE_URL);
}

async function execute(input = {}, { fetchImpl = fetch, baseUrl = process.env.CVM_BASE_URL, timeoutMs = 20000 } = {}) {
  const cnpj = normalizer.normalizeCnpj(input.cnpj);
  if (!cnpj) {
    const e = new Error('cvm: cnpj válido obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!baseUrl) {
    const e = new Error('cvm: CVM_BASE_URL ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const json = await httpJson(`${String(baseUrl).replace(/\/+$/, '')}/cia_aberta/${cnpj}`, { timeoutMs, fetchImpl });
  const items = [{
    entityType: 'company',
    value: cnpj,
    displayName: json.razaoSocial || json.nomeEmpresarial || null,
    attributes: {
      capitalSocial: json.capitalSocial != null ? Number(json.capitalSocial) : null,
      situacaoRegistrada: json.situacao || json.situacaoRegistro || null,
      cnaes: Array.isArray(json.cnaes) ? json.cnaes : [],
      regulated: true,
    },
    evidenceType: 'official_registry',
    confidence: confidenceFor('cvm'),
    sourceProvider: 'cvm',
    sourceUrl: `${String(baseUrl).replace(/\/+$/, '')}/cia_aberta/${cnpj}`,
    sourceRef: `cvm:${cnpj}`,
    observedAt: json.dataRegistro ? new Date(json.dataRegistro) : null,
    related: [],
  }];
  return { items, requests: 1, estimatedCost: 0 };
}

module.exports = { name: 'cvm', capabilities: ['financial.profile'], isConfigured, execute };
