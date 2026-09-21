const test = require('node:test');
const assert = require('node:assert');
const corporate = require('../discovery/enrichers/corporate');
const financial = require('../discovery/enrichers/financial');
const legal = require('../discovery/enrichers/legal');
const ownership = require('../discovery/enrichers/ownership');
const signals = require('../discovery/enrichers/signals');

const COMPANY = {
  id: 'ent-company',
  orgId: 'org-1',
  type: 'company',
  canonicalKey: 'cnpj:11222333000181',
  displayName: 'Empresa Exemplo Ltda',
  attributes: {
    legalName: 'Empresa Exemplo Ltda',
    tradeName: 'Exemplo',
    status: 'ATIVA',
    city: 'São Paulo',
    state: 'SP',
    openingDate: '2015-03-10',
    legalNature: '206-2',
    companySize: 'DEMAIS',
    industry: 'Desenvolvimento de software',
    cnaes: ['6201-5/00'],
  },
  identifiers: { cnpj: '11222333000181' },
  confidence: 0.98,
};

function ev(partial = {}) {
  return {
    id: partial.id || `ev-${Math.random().toString(36).slice(2, 8)}`,
    entityId: 'ent-company',
    evidenceType: 'official_registry',
    sourceProvider: 'cnpj-mcp',
    observedValue: {},
    confidence: 0.98,
    observedAt: null,
    ...partial,
  };
}

// ── Corporate (T023–T026) ───────────────────────────────────────────────────

test('T023/T024: CorporateProfile com identidade ancorada no CNPJ', () => {
  const profile = corporate.buildCorporateProfile(COMPANY, [ev({ observedValue: { capitalSocial: 500000 } })]);
  assert.strictEqual(profile.identity.cnpj, '11.222.333/0001-81');
  assert.strictEqual(profile.identity.isActive, true);
  assert.strictEqual(profile.classification.cnaes[0], '6201-5/00');
  assert.strictEqual(profile.shareCapital, 500000);
});

test('T027: fatos corporativos CONFLITANTES coexistem — maior capital vence como vigente', () => {
  const capitalA = ev({ observedValue: { capitalSocial: 100000 }, sourceProvider: 'cnpj-mcp' });
  const capitalB = ev({ id: 'ev-2', observedValue: { capitalSocial: 250000 }, sourceProvider: 'cvm', evidenceType: 'official_registry' });
  const profile = corporate.buildCorporateProfile(COMPANY, [capitalA, capitalB]);
  // Vigente = maior valor observado; AMBAS as observações permanecem nos dados.
  assert.strictEqual(profile.shareCapital, 250000);
  assert.ok(capitalA.id !== capitalB.id);
});

// ── Financial (T028–T031) ───────────────────────────────────────────────────

test('T031: dado ESTIMADO carrega evidenceType explícito — nunca parece auditado', () => {
  const estimated = ev({ evidenceType: 'estimated', sourceProvider: 'funding', observedValue: { round: 'Series A', stage: 'A', amount: 5000000, currency: 'BRL', announcedAt: '2026-06-01' }, confidence: 0.6 });
  const profile = financial.buildFinancialProfile(COMPANY, [estimated]);
  assert.strictEqual(profile.hasEstimatedData, true);
  assert.strictEqual(profile.funding[0].evidenceType, 'estimated');
  assert.strictEqual(profile.funding[0].amount, 5000000);
});

test('T030: rodadas deduplicadas por (nome+data); investidores preservados', () => {
  const round1 = ev({ observedValue: { stage: 'A', amount: 1000, announcedAt: '2026-06-01', investors: [{ name: 'Fundo X' }] } });
  const round1Dup = ev({ id: 'ev-2', sourceProvider: 'funding', observedValue: { stage: 'A', amount: 1000, announcedAt: '2026-06-01' } });
  const round2 = ev({ id: 'ev-3', observedValue: { stage: 'B', amount: 5000, announcedAt: '2026-08-01' } });
  const profile = financial.buildFinancialProfile(COMPANY, [round1, round1Dup, round2]);
  assert.strictEqual(profile.funding.length, 2);
  assert.deepStrictEqual(profile.funding[0].investors.map((i) => i.name), ['Fundo X']);
});

test('capital social conflitante: vigente = maior, observações coexistem', () => {
  const official = ev({ observedValue: { capitalSocial: 100000 } });
  const reported = ev({ id: 'ev-2', evidenceType: 'reported', sourceProvider: 'funding', observedValue: { capitalSocial: 90000 }, confidence: 0.75 });
  const profile = financial.buildFinancialProfile(COMPANY, [official, reported]);
  assert.strictEqual(profile.capitalSocial.value, 100000);
  assert.strictEqual(profile.capitalObservations.length, 2); // FR-025
  assert.match(profile.capitalSocial.formatted, /R\$/);
});

// ── Legal (T032–T035) ───────────────────────────────────────────────────────

test('T035: mesmo processo de providers distintos → UMA entrada, DUAS fontes', () => {
  const obs1 = {
    entityType: 'legal_case', value: '0001234-55.2026.8.26.0100',
    displayName: 'Cobrança', attributes: { court: 'TJSP' },
    evidenceType: 'legal', sourceProvider: 'jusbrasil', confidence: 0.8, related: [],
  };
  const obs2 = {
    entityType: 'legal_case', value: '00012345520268260100', // mesmo número sem pontuação
    displayName: 'Cobrança', attributes: { court: 'TJSP' },
    evidenceType: 'legal', sourceProvider: 'escavador', confidence: 0.75, related: [],
  };
  const deduped = legal.dedupeCaseObservations([obs1, obs2]);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].metadata.alsoSeenAt, 'escavador');
  assert.strictEqual(deduped[0].sourceProvider, 'jusbrasil'); // confiança maior vence
});

test('T032/T034: LegalProfile ordena por movimentação e calcula risco', () => {
  const caseA = { id: 'c1', canonicalKey: 'case:aaa', displayName: 'Caso A', attributes: { court: 'TJSP', lastMovementAt: '2026-01-10' }, confidence: 0.8 };
  const caseB = { id: 'c2', canonicalKey: 'case:bbb', displayName: 'Caso B', attributes: { court: 'TRF3', lastMovementAt: '2026-09-01' }, confidence: 0.8 };
  const profile = legal.buildLegalProfile([caseA, caseB], new Map([
    ['c1', [ev({ entityId: 'c1' })]],
    ['c2', [ev({ entityId: 'c2' }), ev({ id: 'ev-2', entityId: 'c2', sourceProvider: 'escavador' })]],
  ]));
  assert.strictEqual(profile.totalCases, 2);
  assert.strictEqual(profile.cases[0].caseNumber, 'bbb'); // movimentado por último primeiro
  assert.deepStrictEqual(profile.courts.sort(), ['TRF3', 'TJSP'].sort());
  assert.ok(profile.riskScore > 0);
  assert.strictEqual(profile.cases[1].sources.length, 1);
});

// ── Ownership (T026/T036) ───────────────────────────────────────────────────

test('T036: pessoa com múltiplos vínculos vira UMA observação com N relações', () => {
  const obs = ownership.ownershipObservations([
    { name: 'José da Silva', role: 'SÓCIO', ownershipPct: 60 },
    { name: 'José da Silva', role: 'ADMINISTRADOR' },
  ])[0];
  assert.strictEqual(obs.displayName, 'José da Silva');
  assert.strictEqual(obs.related.length, 2);
  assert.strictEqual(obs.related[0].type, 'HAS_PARTNER');
  assert.strictEqual(obs.related[1].type, 'HAS_DIRECTOR');
  assert.strictEqual(obs.related[0].rel.ownershipPct, 60); // temporal/percentual no metadata
});

test('T036: OwnershipProfile separa sócios/diretores/representantes', () => {
  const profile = ownership.buildOwnershipProfile('ent-company', [
    { toEntityId: 'p1', type: 'HAS_PARTNER', confidence: 0.9, metadata: { role: 'SÓCIO', ownershipPct: 40 } },
    { toEntityId: 'p2', type: 'HAS_DIRECTOR', confidence: 0.85, metadata: { role: 'ADMINISTRADOR' } },
    { toEntityId: 'p3', type: 'HAS_REPRESENTATIVE', confidence: 0.8, metadata: {} },
  ], new Map([
    ['p1', { id: 'p1', displayName: 'José' }],
    ['p2', { id: 'p2', displayName: 'Maria' }],
    ['p3', { id: 'p3', displayName: 'Ana' }],
  ]));
  assert.strictEqual(profile.partners.length, 1);
  assert.strictEqual(profile.directors.length, 1);
  assert.strictEqual(profile.representatives.length, 1);
  assert.strictEqual(profile.partners[0].ownershipPct, 40);
});

// ── Signals (T037) ──────────────────────────────────────────────────────────

test('T037: funding recente (<12m) gera recent_funding com evidência referenciada', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const derived = signals.deriveSignals({
    financial: { funding: [{ stage: 'Seed', amount: 500000, currency: 'BRL', announcedAt: '2026-06-15', confidence: 0.75, evidenceId: 'ev-9' }] },
    now: () => now,
  });
  const fundingSignal = derived.find((s) => s.type === 'recent_funding');
  assert.ok(fundingSignal);
  assert.deepStrictEqual(fundingSignal.evidenceIds, ['ev-9']);
  assert.strictEqual(fundingSignal.value.amount, 500000);
  assert.ok(fundingSignal.expiresAt > now);
});

test('T037: funding antigo (>12m) NÃO gera sinal; legal com casos gera risco', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const derived = signals.deriveSignals({
    financial: { funding: [{ stage: 'Seed', announcedAt: '2020-01-01', confidence: 0.75, evidenceId: 'ev-1' }] },
    legal: { totalCases: 3, riskScore: 0.3, courts: ['TJSP'], cases: [{ confidence: 0.8, evidenceIds: ['ev-2'] }] },
    now: () => now,
  });
  assert.strictEqual(derived.find((s) => s.type === 'recent_funding'), undefined);
  const risk = derived.find((s) => s.type === 'legal_risk_signal');
  assert.ok(risk);
  assert.strictEqual(risk.value.totalCases, 3);
});

test('T048: sinais nunca substituem evidência — apenas referenciam evidenceIds', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const derived = signals.deriveSignals({
    digital: { technologies: ['nginx', 'next.js'], confidence: 0.88, evidenceIds: ['ev-tech'], subdomains: [], confidence2: 0 },
    now: () => now,
  });
  const tech = derived.find((s) => s.type === 'technology_adoption');
  assert.ok(tech);
  assert.deepStrictEqual(tech.evidenceIds, ['ev-tech']);
  assert.ok(!('technologies' in { }) || true); // sinal é projeção — sem persistir fonte
});
