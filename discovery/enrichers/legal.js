// =============================================================================
// discovery/enrichers/legal.js — LegalProfile (T032–T035, US4).
//
// Processos, tribunais, partes e documentos vendor-neutral. Dedup cross-provider
// pelo IDENTIFICADOR do caso (número CNJ) — Jusbrasil e Escavador falando do
// mesmo processo viram UMA entidade com DUAS evidências (proveniência intacta).
// =============================================================================

const { relationshipConfidence } = require('../confidence');

/**
 * Perfila o jurídico a partir de entidades legal_case + evidências.
 * entities: DiscoveryEntity[] (type=legal_case da org); evidence por entidade.
 */
function buildLegalProfile(caseEntities = [], evidenceByEntity = new Map()) {
  const cases = caseEntities.map((entity) => {
    const evidence = evidenceByEntity.get(entity.id) || [];
    const attrs = entity.attributes || {};
    const sources = [...new Set(evidence.map((ev) => ev.sourceProvider))];
    return {
      id: entity.id,
      caseNumber: entity.canonicalKey.replace(/^case:/, ''),
      displayName: entity.displayName || null,
      court: attrs.court || null,
      jurisdiction: attrs.jurisdiction || null,
      status: attrs.status || null,
      subject: attrs.subject || null,
      claimValue: attrs.claimValue != null ? attrs.claimValue : null,
      filedAt: attrs.filedAt || null,
      lastMovementAt: attrs.lastMovementAt || null,
      sources, // proveniência multi-fonte visível (T035)
      confidence: entity.confidence,
      evidenceCount: evidence.length,
      evidenceIds: evidence.map((ev) => ev.id),
    };
  });

  // Ordena por movimentação recente (risco primeiro para o time de vendas).
  cases.sort((a, b) => String(b.lastMovementAt || '').localeCompare(String(a.lastMovementAt || '')));

  const courts = [...new Set(cases.map((c) => c.court).filter(Boolean))];
  const riskScore = cases.length ? Math.min(1, cases.length / 10) : 0;

  return { cases, courts, totalCases: cases.length, riskScore };
}

/**
 * Dedup de casos vindos de múltiplos providers ANTES de persistir: mesmo
 * número de processo → única observação (a mais confiável), fontes somadas.
 * Retorna a lista de observações a gravar (T034).
 */
function dedupeCaseObservations(observations = []) {
  const byCaseNumber = new Map();
  for (const obs of observations) {
    // Mesma normalização do canonicalKey: número sem pontuação/caixa.
    const key = String(obs.value || '').replace(/\W+/g, '').toLowerCase();
    const existing = byCaseNumber.get(key);
    if (!existing) {
      byCaseNumber.set(key, obs);
      continue;
    }
    // Mesmo caso de outra fonte: mantém a mais confiável, anota fontes extras.
    if ((obs.confidence || 0) > (existing.confidence || 0)) {
      obs.metadata = { ...(obs.metadata || {}), alsoSeenAt: existing.sourceProvider };
      byCaseNumber.set(key, obs);
    } else {
      existing.metadata = { ...(existing.metadata || {}), alsoSeenAt: obs.sourceProvider };
    }
  }
  return [...byCaseNumber.values()];
}

/** Confiança do vínculo empresa → processo: mínima das evidências. */
function companyCaseRelationConfidence(evidenceConfidences = []) {
  return relationshipConfidence(evidenceConfidences);
}

module.exports = { buildLegalProfile, dedupeCaseObservations, companyCaseRelationConfidence };
