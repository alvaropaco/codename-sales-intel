// =============================================================================
// discovery/enrichers/signals.js — DiscoverySignals derivados (T037, Phase 8).
//
// Sinal é PROJEÇÃO derivada de evidências — nunca substitui a origem
// (data-model.md). Regras DETERMINÍSTICAS e baratas; evidências de suporte
// ficam referenciadas (evidenceIds) para auditoria.
// =============================================================================

const MONTH_MS = 30 * 24 * 3600e3;

/**
 * Deriva sinais a partir dos perfis prontos (corporate/financial/legal/digital).
 * now é injetável para testes. Retorna [{ type, value, confidence, evidenceIds, observedAt, expiresAt }].
 */
function deriveSignals({ financial = null, legal = null, digital = null, now = () => new Date() } = {}) {
  const signals = [];
  const t = now().getTime();

  if (financial && Array.isArray(financial.funding)) {
    for (const round of financial.funding) {
      const announced = round.announcedAt ? new Date(round.announcedAt).getTime() : null;
      if (!announced || Number.isNaN(announced)) continue;
      if (t - announced <= 12 * MONTH_MS) {
        signals.push({
          type: 'recent_funding',
          value: { round: round.name || round.stage, amount: round.amount, currency: round.currency, announcedAt: round.announcedAt },
          confidence: round.confidence,
          evidenceIds: [round.evidenceId].filter(Boolean),
          observedAt: new Date(announced),
          expiresAt: new Date(announced + 18 * MONTH_MS),
        });
      }
    }
  }

  if (legal && legal.totalCases > 0) {
    signals.push({
      type: 'legal_risk_signal',
      value: { totalCases: legal.totalCases, riskScore: legal.riskScore, courts: legal.courts },
      confidence: legal.cases.length ? Math.max(...legal.cases.map((c) => c.confidence)) : 0.5,
      evidenceIds: legal.cases.flatMap((c) => c.evidenceIds || []).slice(0, 20),
      observedAt: new Date(t),
      expiresAt: new Date(t + 90 * 24 * 3600e3),
    });
  }

  if (digital && Array.isArray(digital.technologies)) {
    const modern = digital.technologies.filter((tech) => ['next.js', 'react', 'cloudflare', 'shopify'].includes(String(tech).toLowerCase()));
    if (modern.length) {
      signals.push({
        type: 'technology_adoption',
        value: { technologies: modern },
        confidence: digital.confidence || 0.72,
        evidenceIds: digital.evidenceIds || [],
        observedAt: new Date(t),
        expiresAt: new Date(t + 60 * 24 * 3600e3),
      });
    }
  }

  if (digital && Array.isArray(digital.subdomains) && digital.subdomains.length >= 5) {
    signals.push({
      type: 'expansion_signal',
      value: { subdomainCount: digital.subdomains.length, sample: digital.subdomains.slice(0, 10) },
      confidence: digital.confidence || 0.85,
      evidenceIds: digital.evidenceIds || [],
      observedAt: new Date(t),
      expiresAt: new Date(t + 90 * 24 * 3600e3),
    });
  }

  return signals;
}

module.exports = { deriveSignals };
