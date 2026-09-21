// =============================================================================
// discovery/enrichers/corporate.js — CorporateProfile (T023–T026, US4).
//
// Projeção PURE sobre entidades/evidências persistidas: identidade corporativa
// (CNPJ âncora), classificação (natureza/porte/CNAEs), endereços e filiais.
// Identificadores são source-independent: o CNPJ canônico manda; nomes são
// apenas sinais de apoio (plan.md, Data Integrity Rules).
// =============================================================================

const normalizer = require('../normalizer');
const { relationshipConfidence, combineConfidence } = require('../confidence');

/**
 * Perfila a entidade company a partir dos atributos consolidados.
 * entity: DiscoveryEntity (type=company); evidence: DiscoveryEvidence[].
 */
function buildCorporateProfile(entity, evidence = []) {
  const attrs = entity.attributes || {};
  const identifiers = entity.identifiers || {};
  const cnpj = normalizer.normalizeCnpj(identifiers.cnpj || entity.canonicalKey);

  const identity = {
    cnpj: cnpj ? normalizer.formatCnpj(cnpj) : null,
    cnpjDigits: cnpj,
    legalName: attrs.legalName || entity.displayName || null,
    tradeName: attrs.tradeName || null,
    status: attrs.status || attrs.situacaoRegistrada || null,
    isActive: attrs.isActive != null ? Boolean(attrs.isActive) : /ativa/i.test(String(attrs.status || '')),
    openingDate: attrs.openingDate || null,
  };
  const classification = {
    legalNature: attrs.legalNature || null,
    companySize: attrs.companySize || null,
    industry: attrs.industry || null,
    cnaes: normalizeCnaes(attrs.cnaes || (attrs.industry ? [attrs.industry] : [])),
    regulated: Boolean(attrs.regulated),
  };
  const address = attrs.city || attrs.state
    ? { city: attrs.city || null, state: attrs.state || null }
    : null;

  const capitalEvidence = evidence.filter((ev) => ev.observedValue && ev.observedValue.capitalSocial != null);
  const shareCapital = capitalEvidence.length
    ? capitalEvidence.map((ev) => Number(ev.observedValue.capitalSocial)).sort((a, b) => b - a)[0]
    : attrs.shareCapital != null
      ? Number(attrs.shareCapital)
      : null;

  return {
    identity,
    classification,
    address,
    shareCapital,
    confidence: combineConfidence(evidence.map((ev) => ev.confidence).concat([entity.confidence])),
    evidenceCount: evidence.length,
  };
}

/** CNAEs como strings normalizadas (código ou descrição). */
function normalizeCnaes(list) {
  return [...new Set((list || []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 20);
}

/**
 * Sinais de apoio para identidade: nomes equivalentes valem menos que o CNPJ.
 * Retorna relações de identidade suportadas por evidência (T024).
 */
function identityRelationships(companyEntityId, evidence = []) {
  return evidence
    .filter((ev) => ev.sourceProvider === 'cnpj-mcp')
    .map((ev) => ({
      type: 'HAS_CNPJ_OFFICIAL',
      confidence: relationshipConfidence([ev.confidence]),
    }))
    .slice(0, 1);
}

module.exports = { buildCorporateProfile, normalizeCnaes, identityRelationships };
