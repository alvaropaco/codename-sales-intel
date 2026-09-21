// =============================================================================
// discovery/enrichers/financial.js — FinancialProfile (T028–T031, US4).
//
// Fatos financeiros são observações TIPADAS com fonte: capital social, funding
// (rodadas/investidores), eventos materiais. Dados ESTIMADOS carregam
// evidenceType explícito (estimated/reported/inferred) — nunca aparecem como
// auditados (FR de edge case do spec).
// =============================================================================

const { combineConfidence } = require('../confidence');

/**
 * Perfila finanças da empresa a partir das evidências.
 * Deduplica rodadas por (nome+data) e preserva TODAS as observações de
 * capital social (a maior vence como "vigente", as demais permanecem audíveis).
 */
function buildFinancialProfile(entity, evidence = []) {
  const attrs = entity.attributes || {};

  const capitalObservations = evidence
    .filter((ev) => ev.observedValue && ev.observedValue.capitalSocial != null)
    .map((ev) => ({
      value: Number(ev.observedValue.capitalSocial),
      evidenceType: ev.evidenceType,
      sourceProvider: ev.sourceProvider,
      evidenceId: ev.id,
      confidence: ev.confidence,
      observedAt: ev.observedAt,
    }));
  const capitalSocial = capitalObservations.length
    ? capitalObservations.reduce((max, o) => (o.value > max.value ? o : max), capitalObservations[0])
    : attrs.shareCapital != null
      ? { value: Number(attrs.shareCapital), evidenceType: 'official_registry', sourceProvider: 'cnpj-mcp', evidenceId: null, confidence: entity.confidence, observedAt: null }
      : null;

  const rounds = dedupeRounds(evidence.filter((ev) => ev.observedValue && ev.observedValue.round != null || ev.observedValue && ev.observedValue.stage != null));
  const events = evidence
    .filter((ev) => ev.observedValue && ev.observedValue.eventType != null)
    .map((ev) => ({
      type: ev.observedValue.eventType,
      description: ev.observedValue.description || null,
      amount: ev.observedValue.amount != null ? Number(ev.observedValue.amount) : null,
      evidenceId: ev.id,
      evidenceType: ev.evidenceType,
      observedAt: ev.observedAt,
    }));

  return {
    capitalSocial: capitalSocial ? { ...capitalSocial, formatted: formatBRL(capitalSocial.value) } : null,
    capitalObservations, // conflitos coexistem (FR-025)
    funding: rounds,
    events,
    hasEstimatedData: [capitalSocial, ...rounds].some((o) => o && o.evidenceType === 'estimated'),
    confidence: combineConfidence(evidence.map((ev) => ev.confidence)),
  };
}

function dedupeRounds(evidence) {
  const seen = new Map();
  for (const ev of evidence) {
    const v = ev.observedValue || {};
    const key = `${v.name || v.stage || ''}|${v.announcedAt || ev.observedAt || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, {
      name: v.name || v.stage || null,
      stage: v.stage || null,
      amount: v.amount != null ? Number(v.amount) : null,
      currency: v.currency || 'BRL',
      announcedAt: v.announcedAt || null,
      investors: Array.isArray(v.investors) ? v.investors : [],
      evidenceId: ev.id,
      evidenceType: ev.evidenceType,
      confidence: ev.confidence,
    });
  }
  return [...seen.values()];
}

function formatBRL(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

module.exports = { buildFinancialProfile, dedupeRounds, formatBRL };
