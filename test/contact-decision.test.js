'use strict';

/**
 * Testes do painel de decisão de contato (feature 003) — módulo puro
 * contact-decision.js. Padrão de test/opportunity-score.test.js:
 * node:test + node:assert + fixtures puras, sem banco nem rede.
 *
 * Cada bloco referencia os FRs da spec 003 e as garantias contratuais de
 * specs/003-contact-decision-metrics/contracts/api.md.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  REACH_WEIGHTS,
  TIMING_WEIGHTS,
  TIMING_DIGITAL_SUBTOTAL,
  FACTOR_WEIGHTS,
  VERDICT_THRESHOLDS,
  LEVEL_THRESHOLDS,
  STALE_AFTER_DAYS,
  MAX_FACTOR_RAW_FIT,
  computeReachability,
  computeTiming,
  computeContactDecision,
  computeRecommendation,
} = require('../contact-decision');

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-17T12:00:00.000Z');
const RECENT = new Date('2026-09-10T08:00:00.000Z'); // 7 dias atrás
const STALE_DATE = new Date(NOW.getTime() - (STALE_AFTER_DAYS + 30) * 24 * 60 * 60 * 1000);

function prospectFixture(overrides = {}) {
  return {
    id: 'lead-001',
    cnpj: '12345678000199',
    cnpjEmail: 'contato@empresaexemplo.com.br',
    cnpjPhones: ['11999998888'],
    cnpjOpenedAt: '2010-06-15',
    cnpjRawData: { situacao_cadastral: 2, descricao_situacao_cadastral: 'ATIVA' },
    domain: 'empresaexemplo.com.br',
    status: 'lead',
    contactedChannels: [],
    lastContact: null,
    enrichmentStatus: 'enriched',
    creditRiskScore: 20,
    creditRiskLevel: 'low',
    enrichmentSummary: {
      website_active: true,
      corporate_email: true,
      tech_count: 4,
      score_breakdown: { setor: 8, porte: 8, momentum: 4 },
    },
    ...overrides,
  };
}

function graphProfileFixture(overrides = {}) {
  return {
    profile: {
      contact_points: [],
      social: { linkedin: { url: 'https://linkedin.com/company/x' } },
      technologies: [
        { name: 'Google Analytics', category: 'analytics' },
        { name: 'RD Station', category: 'marketing' },
      ],
    },
    enrichedAt: RECENT.toISOString(),
    ...overrides,
  };
}

// ── Fumaça: constantes (T003) ──────────────────────────────────────────────

test('constantes de scoring somam conforme data-model.md', () => {
  assert.strictEqual(Object.values(REACH_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.strictEqual(Object.values(TIMING_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.strictEqual(
    TIMING_WEIGHTS.active_status + TIMING_WEIGHTS.recent + TIMING_DIGITAL_SUBTOTAL,
    100
  );
  assert.strictEqual(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.strictEqual(STALE_AFTER_DAYS, 90);
  assert.strictEqual(MAX_FACTOR_RAW_FIT, 16);
  assert.ok(VERDICT_THRESHOLDS.contact_now > VERDICT_THRESHOLDS.contact_lower_priority);
  assert.ok(LEVEL_THRESHOLDS.high > LEVEL_THRESHOLDS.medium);
});

// ── US1 — Atingibilidade (FR-002) ──────────────────────────────────────────

test('atingibilidade: e-mail corporativo próprio + telefone → alta, canal recomendado email', () => {
  const r = computeReachability({ prospect: prospectFixture(), graphProfile: graphProfileFixture() }, NOW);
  assert.strictEqual(r.score, REACH_WEIGHTS.corporate_email + REACH_WEIGHTS.phone); // 40 + 25 = 65
  assert.strictEqual(r.level, 'medium'); // 65 ≥ 45, < 70
  assert.strictEqual(r.usableChannel, true);
  assert.strictEqual(r.recommendedChannel, 'email');
  const classes = r.channels.map((c) => c.classification);
  assert.ok(classes.includes('corporate'));
  assert.strictEqual(r.basis.prospect, true);
  assert.strictEqual(r.basis.graph_available, true);
});

test('atingibilidade: único e-mail de provedor gratuito → classificação generic', () => {
  const p = prospectFixture({ cnpjEmail: 'lead@gmail.com', cnpjPhones: [] });
  const r = computeReachability({ prospect: p, graphProfile: null }, NOW);
  assert.strictEqual(r.channels[0].classification, 'generic');
  assert.strictEqual(r.score, REACH_WEIGHTS.generic_email);
  assert.strictEqual(r.level, 'low');
  assert.strictEqual(r.usableChannel, true);
});

test('atingibilidade: e-mail de contabilidade terceirizada → classification third_party', () => {
  const p = prospectFixture({ cnpjEmail: 'financeiro@contabilizei.com.br', cnpjPhones: [] });
  const r = computeReachability({ prospect: p, graphProfile: null }, NOW);
  assert.strictEqual(r.channels[0].classification, 'third_party');
  assert.strictEqual(r.score, REACH_WEIGHTS.generic_email);
});

test('atingibilidade: whatsapp e e-mail adicional do enriquecimento pontuam, com dedup', () => {
  const gp = graphProfileFixture({
    profile: {
      contact_points: [
        { type: 'email', value: 'contato@empresaexemplo.com.br', confidence: 0.9 }, // duplicado do cadastro
        { type: 'email', value: 'sócio@empresaexemplo.com.br', confidence: 0.7 },   // adicional (PDL)
        { type: 'whatsapp', value: '11999998888', confidence: 0.8 },                // mesmo número, agora whatsapp
      ],
      social: {},
      technologies: [],
    },
  });
  const r = computeReachability({ prospect: prospectFixture(), graphProfile: gp }, NOW);
  // corporativo 40 + telefone 25 + whatsapp 10 + adicional 15 (o duplicado não pontua de novo)
  assert.strictEqual(
    r.score,
    REACH_WEIGHTS.corporate_email + REACH_WEIGHTS.phone + REACH_WEIGHTS.whatsapp + REACH_WEIGHTS.enriched_email
  );
  assert.strictEqual(r.level, 'high'); // 90
  assert.strictEqual(r.recommendedChannel, 'email'); // corporativo vence whatsapp
});

test('atingibilidade: enriquecido sem canal nenhum → nível baixo, sem canal utilizável', () => {
  const p = prospectFixture({ cnpjEmail: null, cnpjPhones: [] });
  const r = computeReachability({ prospect: p, graphProfile: graphProfileFixture() }, NOW);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.level, 'low');
  assert.strictEqual(r.usableChannel, false);
  assert.strictEqual(r.recommendedChannel, null);
  assert.ok(r.evidence.some((e) => e.key === 'no_channel'));
});

test('atingibilidade: whatsapp vira recomendado quando não há e-mail corporativo', () => {
  const p = prospectFixture({ cnpjEmail: 'lead@gmail.com', cnpjPhones: ['11999998888'] });
  const gp = graphProfileFixture({
    profile: { contact_points: [{ type: 'whatsapp', value: '11999998888' }], social: {}, technologies: [] },
  });
  const r = computeReachability({ prospect: p, graphProfile: gp }, NOW);
  assert.strictEqual(r.recommendedChannel, 'whatsapp');
});

// ── US1 — Momento (FR-003, FR-018) ─────────────────────────────────────────

test('momento: lead típico ativo com stack → nível médio/alto e inactive false', () => {
  const t = computeTiming({ prospect: prospectFixture(), graphProfile: graphProfileFixture() }, NOW);
  // ativa 25 + site 20 + email 10 + social 10 + stack 15 + tech 5 + momentum 5 = 90 (recente não: 2010)
  assert.strictEqual(t.score, 90);
  assert.strictEqual(t.level, 'high');
  assert.strictEqual(t.inactive, false);
  assert.deepStrictEqual(t.missingOfficialSignals, []);
});

test('momento: CNPJ suspenso → inactive true, sem pontos de situação, evidência presente', () => {
  const p = prospectFixture({
    cnpjRawData: { situacao_cadastral: 3, descricao_situacao_cadastral: 'SUSPENSA' },
  });
  const t = computeTiming({ prospect: p, graphProfile: null }, NOW);
  assert.strictEqual(t.inactive, true);
  // site 20 + email 10 + tech 5 + momentum 5 (sem social/stack: grafo null; 2010: sem recent)
  assert.strictEqual(t.score, 40);
  assert.ok(t.evidence.some((e) => e.key === 'inactive_status'));
});

test('momento: lead sem CNPJ → renormalização sobre pesos digitais + sinais oficiais ausentes', () => {
  const p = prospectFixture({ cnpj: null, cnpjOpenedAt: null, cnpjRawData: null });
  const t = computeTiming({ prospect: p, graphProfile: graphProfileFixture() }, NOW);
  // digitais: site 20 + email 10 + social 10 + stack 15 + tech 5 + momentum 5 = 65
  assert.strictEqual(t.missingOfficialSignals.includes('situacao_cadastral'), true);
  assert.strictEqual(t.missingOfficialSignals.includes('cnpj_age'), true);
  assert.strictEqual(t.score, 100); // 65 digital * 100/65 renormalizado = 100
  assert.strictEqual(t.inactive, null);
});

test('momento: empresa recente (<2 anos) ganha sinal de recentidade', () => {
  const p = prospectFixture({ cnpjOpenedAt: '2025-06-01' });
  const t = computeTiming({ prospect: p, graphProfile: null }, NOW);
  // ativa 25 + site 20 + email 10 + tech 5 + momentum 5 + recent 10 = 75
  assert.strictEqual(t.score, 75);
  assert.strictEqual(t.level, 'high');
});

test('momento: summary vazio e grafo nulo → só o cadastral pontua', () => {
  const p = prospectFixture({
    enrichmentSummary: {},
    creditRiskScore: null,
    creditRiskLevel: null,
  });
  const t = computeTiming({ prospect: p, graphProfile: null }, NOW);
  assert.strictEqual(t.score, TIMING_WEIGHTS.active_status);
  assert.strictEqual(t.level, 'low');
});

// ── US2 — Recomendação (FR-004..FR-007, FR-014, FR-015) ────────────────────

function reachFixture(overrides = {}) {
  return {
    level: 'high',
    score: 90,
    usableChannel: true,
    recommendedChannel: 'email',
    channels: [{ type: 'email', classification: 'corporate', confidence: 0.9 }],
    evidence: [],
    basis: { prospect: true, graph: true, graph_available: true },
    stale: false,
    ...overrides,
  };
}

function timingFixture(overrides = {}) {
  return {
    level: 'high',
    score: 90,
    inactive: false,
    missingOfficialSignals: [],
    evidence: [],
    basis: { prospect: true, graph: true, graph_available: true },
    stale: false,
    ...overrides,
  };
}

test('recomendação: perfil forte → contact_now com fatores usados', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ score: 90 }),
    timing: timingFixture({ score: 90, inactive: false }),
  });
  // (40*90 + 35*90 + 15*100 + 10*80) / 100 = 90.5 → contact_now
  assert.strictEqual(rec.verdict, 'contact_now');
  assert.strictEqual(rec.factors.reachability.status, 'used');
  assert.strictEqual(rec.factors.timing.status, 'used');
  assert.strictEqual(rec.factors.fit.status, 'used');
  assert.strictEqual(rec.factors.fit.value, 100); // setor 8 + porte 8 = 16/16
  assert.strictEqual(rec.factors.risk.value, 80); // 100 − 20
  assert.ok(rec.reasons.some((r) => r.code === 'corporate_email'));
  assert.strictEqual(rec.suggestedAction, 'start_email');
  assert.strictEqual(rec.contactedContext, null);
});

test('recomendação: fatores neutros quando perfil/risco ausentes — não penalizam como zero', () => {
  const p = prospectFixture({
    enrichmentSummary: { website_active: true },
    creditRiskScore: null,
    creditRiskLevel: null,
  });
  const rec = computeRecommendation({
    prospect: p,
    reachability: reachFixture({ score: 70 }),
    timing: timingFixture({ score: 70 }),
  });
  assert.strictEqual(rec.factors.fit.status, 'neutral');
  assert.strictEqual(rec.factors.fit.value, 50);
  assert.strictEqual(rec.factors.risk.status, 'neutral');
  assert.strictEqual(rec.factors.risk.value, 50);
  // (40*70 + 35*70 + 15*50 + 10*50) / 100 = 65 → contact_now (limiar exato)
  assert.strictEqual(rec.verdict, 'contact_now');
});

test('recomendação: fator unknown não penaliza (renormalização)', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ level: 'unknown', score: null }),
    timing: timingFixture({ score: 90 }),
  });
  assert.strictEqual(rec.factors.reachability.status, 'unknown');
  // denominador = 35 + 15 + 10 = 60 → (35*90 + 15*100 + 10*80)/60 = 90.8
  assert.ok(rec.factors.timing.status === 'used');
});

test('recomendação: atingibilidade unknown impede contact_now (insufficient_data)', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ level: 'unknown', score: null, usableChannel: false }),
    timing: timingFixture({ score: 90 }),
  });
  assert.notStrictEqual(rec.verdict, 'contact_now');
  assert.ok(rec.reasons.some((r) => r.code === 'insufficient_data'));
});

test('gate FR-014: empresa inativa limita a contact_lower_priority com motivo', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ score: 90 }),
    timing: timingFixture({ score: 90, inactive: true }),
  });
  // média daria contact_now, mas o gate derruba
  assert.strictEqual(rec.verdict, 'contact_lower_priority');
  assert.ok(rec.reasons.some((r) => r.code === 'inactive_company'));
});

test('gate FR-014: risco de crédito alto limita a contact_lower_priority com motivo', () => {
  const p = prospectFixture({ creditRiskScore: 90, creditRiskLevel: 'high' });
  const rec = computeRecommendation({
    prospect: p,
    reachability: reachFixture({ score: 90 }),
    timing: timingFixture({ score: 90 }),
  });
  assert.strictEqual(rec.verdict, 'contact_lower_priority');
  assert.ok(rec.reasons.some((r) => r.code === 'high_credit_risk'));
});

test('gate FR-014: inativa E risco alto → do_not_prioritize', () => {
  const p = prospectFixture({ creditRiskScore: 90, creditRiskLevel: 'high' });
  const rec = computeRecommendation({
    prospect: p,
    reachability: reachFixture({ score: 90 }),
    timing: timingFixture({ score: 90, inactive: true }),
  });
  assert.strictEqual(rec.verdict, 'do_not_prioritize');
});

test('gate: sem canal utilizável → do_not_prioritize com ação enrich_lead', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ score: 0, level: 'low', usableChannel: false, recommendedChannel: null }),
    timing: timingFixture({ score: 90 }),
  });
  assert.strictEqual(rec.verdict, 'do_not_prioritize');
  assert.ok(rec.reasons.some((r) => r.code === 'no_channel'));
  assert.strictEqual(rec.suggestedAction, 'enrich_lead');
});

test('invariante: contact_now exige canal, empresa ativa e risco não-alto', () => {
  const p = prospectFixture({ creditRiskScore: 90, creditRiskLevel: 'high' });
  const rec = computeRecommendation({
    prospect: p,
    reachability: reachFixture({ score: 95 }),
    timing: timingFixture({ score: 95 }),
  });
  if (rec.verdict === 'contact_now') {
    assert.strictEqual(rec.factors.reachability.status === 'unknown' || rec.factors.reachability.value > 0, true);
  }
  // com risco alto este caso NUNCA pode ser contact_now:
  assert.notStrictEqual(rec.verdict, 'contact_now');
});

test('suggestedAction: whatsapp recomendado quando é o único canal bom', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture(),
    reachability: reachFixture({ score: 35, level: 'low', recommendedChannel: 'whatsapp' }),
    timing: timingFixture({ score: 90 }),
  });
  // (40*35 + 35*90 + 15*100 + 10*80)/100 = 65.5 → contact_now → ação whatsapp
  assert.strictEqual(rec.verdict, 'contact_now');
  assert.strictEqual(rec.suggestedAction, 'start_whatsapp');
});

test('contato prévio (FR-015): contexto preenchido e veredito inalterado', () => {
  const base = { prospect: prospectFixture(), reachability: reachFixture(), timing: timingFixture() };
  const withoutContact = computeRecommendation(base);
  const withContact = computeRecommendation({
    ...base,
    prospect: prospectFixture({
      contactedChannels: ['email'],
      lastContact: '2026-09-01T14:00:00.000Z',
    }),
  });
  assert.deepStrictEqual(withContact.contactedContext, {
    contacted: true,
    channels: ['email'],
    lastContact: '2026-09-01T14:00:00.000Z',
  });
  assert.strictEqual(withContact.verdict, withoutContact.verdict); // contexto, não lógica nova
});

test('contato prévio (FR-015): lead nunca contatado → contactedContext null', () => {
  const rec = computeRecommendation({
    prospect: prospectFixture({ contactedChannels: [], lastContact: null, status: 'lead' }),
    reachability: reachFixture(),
    timing: timingFixture(),
  });
  assert.strictEqual(rec.contactedContext, null);
});

// ── US2/T019 — Auditoria: zero valores de contato no payload (SC-006) ──────

test('payload nunca contém valores de e-mail/telefone das entradas', () => {
  const secretEmail = 'socio-secreto@empresaexemplo.com.br';
  const secretPhone = '1133224455';
  const p = prospectFixture({
    cnpjEmail: secretEmail,
    cnpjPhones: [secretPhone],
  });
  const gp = graphProfileFixture({
    profile: {
      contact_points: [
        { type: 'whatsapp', value: secretPhone },
        { type: 'email', value: secretEmail },
      ],
      social: {},
      technologies: [],
    },
  });
  const payload = JSON.stringify(computeContactDecision(p, gp, NOW));
  assert.strictEqual(payload.includes(secretEmail), false, 'vazou e-mail no payload');
  assert.strictEqual(payload.includes(secretPhone), false, 'vazou telefone no payload');
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(payload), 'payload contém padrão de e-mail');
});

// ── US3 — Estados honestos: unknown (FR-008) e desatualização (FR-016) ─────

test('lead pendente sem nenhuma evidência → ambas métricas unknown, sem número (FR-008)', () => {
  const p = prospectFixture({
    enrichmentStatus: 'pending',
    cnpjEmail: null,
    cnpjPhones: [],
    cnpjRawData: null,
    cnpjOpenedAt: null,
    enrichmentSummary: {},
  });
  const decision = computeContactDecision(p, null, NOW);
  assert.strictEqual(decision.reachability.level, 'unknown');
  assert.strictEqual(decision.reachability.score, null);
  assert.strictEqual(decision.timing.level, 'unknown');
  assert.strictEqual(decision.timing.score, null);
  const payload = JSON.stringify(decision);
  assert.ok(!/\d+\/100/.test(payload), 'payload sugere precisão sem evidência');
});

test('enriquecimento parcial: com contatos mas sem sinais digitais → reach ok, timing unknown', () => {
  const p = prospectFixture({
    enrichmentStatus: 'partial',
    enrichmentSummary: {},
    cnpjRawData: null,
    cnpjOpenedAt: null,
  });
  const decision = computeContactDecision(p, null, NOW);
  assert.strictEqual(decision.reachability.level, 'medium'); // 65: corporativo + telefone
  assert.strictEqual(decision.timing.level, 'unknown');
  assert.strictEqual(decision.timing.inactive, null);
});

test('evidências antigas (>90 dias) → stale por métrica, valores preservados (FR-016)', () => {
  const p = prospectFixture({
    enrichmentStatus: 'enriched',
    updatedAt: STALE_DATE,
    enrichedAt: STALE_DATE,
  });
  const gp = graphProfileFixture({ enrichedAt: STALE_DATE.toISOString() });
  const decision = computeContactDecision(p, gp, NOW);
  assert.strictEqual(decision.reachability.stale, true);
  assert.strictEqual(decision.timing.stale, true);
  assert.strictEqual(decision.freshness.stale, true);
  assert.strictEqual(decision.freshness.thresholdDays, 90);
  // valores preservados — selo não oculta:
  assert.strictEqual(decision.reachability.score, 65);
  assert.strictEqual(decision.timing.score, 90);
});

test('idades mistas: cadastro antigo + grafo recente → stale só na métrica afetada', () => {
  const p = prospectFixture({
    updatedAt: STALE_DATE, // canais do cadastro são antigos
    enrichedAt: RECENT,
    cnpjRawData: null, // timing pontua só por sinais digitais recentes
  });
  const gp = graphProfileFixture({ enrichedAt: RECENT.toISOString() }); // sinais digitais recentes
  const decision = computeContactDecision(p, gp, NOW);
  assert.strictEqual(decision.reachability.stale, true, 'canais do cadastro antigo deveriam estar stale');
  assert.strictEqual(decision.timing.stale, false, 'sinais digitais recentes não deveriam estar stale');
});

test('thresholdDays presente e lead fresco não marca stale', () => {
  const decision = computeContactDecision(prospectFixture(), graphProfileFixture(), NOW);
  assert.strictEqual(decision.freshness.stale, false);
  assert.strictEqual(decision.reachability.stale, false);
});
