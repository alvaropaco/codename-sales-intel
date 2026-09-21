// =============================================================================
// discovery/providers/cnpj-mcp.js — provider CNPJ MCP (T010, US1/US4).
//
// Adapter sobre o cliente existente (mcp-cnpj.js): o MCP permanece a fonte
// AUTORITATIVA de empresas brasileiras (research.md) e agora entra como
// provider de primeira classe no catálogo, emitindo observações normalizadas
// (nada de schema vendor vaza para o domínio — data-model.md, princípio 4).
// =============================================================================

const mcpCnpj = require('../../mcp-cnpj');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');
const { isMcpConfigured } = mcpCnpj;

/**
 * Executa o provider.
 * input: { cnpj } → lookup exato | { criteria: { state, city, cnae, status, legalNameContains }, query, limit }
 * Retorna: { items, requests, estimatedCost } — items são observações de company.
 */
async function execute(input = {}, { client = mcpCnpj } = {}) {
  const items = [];
  let requests = 0;

  if (input.cnpj) {
    requests += 1;
    const company = await client.getCompanyByCnpj(input.cnpj);
    if (company) items.push(companyObservation(company, { official: true }));
    return { items, requests, estimatedCost: 0 };
  }

  const criteria = input.criteria || {};
  const limit = Math.min(Number(input.limit) || 20, 50);
  if (input.query || (!criteria.state && !criteria.city && !criteria.cnae && !criteria.legalNameContains)) {
    requests += 1;
    const found = await client.searchCompanies({
      query: input.query || criteria.legalNameContains,
      state: criteria.state,
      city: criteria.city,
      cnae: criteria.cnae,
      status: criteria.status,
      limit,
    });
    for (const company of found) items.push(companyObservation(company));
  } else {
    requests += 1;
    const found = await client.filterCompanies({
      state: criteria.state,
      city: criteria.city,
      cnae: criteria.cnae,
      status: criteria.status,
      legalNameContains: criteria.legalNameContains,
      limit,
    });
    for (const company of found) items.push(companyObservation(company));
  }
  return { items, requests, estimatedCost: 0 };
}

/** Observação de empresa no formato canônico do motor. */
function companyObservation(company, { official = false } = {}) {
  const cnpj = normalizer.normalizeCnpj(company.cnpj);
  const attributes = {
    legalName: company.legalName || null,
    tradeName: company.tradeName || null,
    industry: company.industry || null,
    status: company.status || null,
    city: company.city || null,
    state: company.state || null,
    openingDate: company.openingDate || null,
    legalNature: company.legalNature || null,
    companySize: company.companySize || null,
    shareCapital: company.shareCapital != null ? company.shareCapital : null,
    email: company.email ? normalizer.normalizeEmail(company.email) : null,
    isActive: Boolean(company.isActive),
    isHeadquarters: Boolean(company.isHeadquarters),
  };
  return {
    entityType: 'company',
    value: cnpj,
    displayName: company.legalName || company.tradeName || (cnpj ? normalizer.formatCnpj(cnpj) : null),
    attributes,
    evidenceType: 'official_registry',
    confidence: confidenceFor('cnpj-mcp'),
    sourceProvider: 'cnpj-mcp',
    sourceUrl: null,
    sourceRef: cnpj ? `cnpj:${cnpj}` : null,
    observedAt: null,
    related: attributes.email
      ? [{ entityType: 'email', value: attributes.email, type: 'HAS_EMAIL' }]
      : [],
  };
}

module.exports = { name: 'cnpj-mcp', capabilities: ['corporate.identity'], isConfigured: isMcpConfigured, execute };
