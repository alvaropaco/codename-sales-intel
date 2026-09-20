'use strict';

/**
 * Testes do backfill de avanço de qualificação (feature 005, hotfix 2026-09-20):
 * `backfillQualificationAdvance` (scripts/backfill-qualification-advance.js)
 * move para o estágio correto todo lead em "Em Qualificação" cujo
 * enriquecimento JÁ CONCLUIU (heala os cards parados pelo bug do call site de
 * statusAfterEnrichment e pelo avanço ausente no caminho PDL).
 *
 * Padrão: fake-prisma, sem banco real.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { backfillQualificationAdvance } = require('../scripts/backfill-qualification-advance');

function prospectFixture(overrides = {}) {
  return {
    id: 'p-1',
    orgId: 'org-prem',
    companyName: 'Empresa LTDA',
    status: 'prospect',
    enrichmentStatus: 'partial',
    analysisStatus: 'not_started',
    createdAt: new Date('2026-09-16T00:00:00Z'),
    ...overrides,
  };
}

async function setup(planByOrg = { 'org-prem': 'premium' }) {
  const prisma = createFakePrisma();
  const plans = { ...planByOrg };
  const analyses = [];
  const enqueueAnalysis = async (prospect) => {
    analyses.push(prospect.id);
  };
  return {
    prisma,
    analyses,
    enqueueAnalysis,
    planFor: async (orgId) => plans[orgId] || 'trial',
    seed: (overrides) => prisma.prospect.create({ data: prospectFixture(overrides) }),
  };
}

test('backfill avança concluídos premium para Análise profunda e enfileira análise', async () => {
  const ctx = await setup();
  await ctx.seed({ id: 'p-partial', enrichmentStatus: 'partial' });
  await ctx.seed({ id: 'p-enriched', enrichmentStatus: 'enriched', cnpj: '12345678000199' });
  await ctx.seed({ id: 'p-unavail', enrichmentStatus: 'unavailable' });

  const summary = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
  });

  assert.strictEqual(summary.scanned, 3);
  assert.strictEqual(summary.advanced, 3);
  assert.strictEqual(summary.queued, 3);
  for (const id of ['p-partial', 'p-enriched', 'p-unavail']) {
    const row = await ctx.prisma.prospect.findUnique({ where: { id } });
    assert.strictEqual(row.status, 'deep_analysis');
    assert.strictEqual(row.analysisStatus, 'not_started');
  }
  assert.deepStrictEqual(ctx.analyses.sort(), ['p-enriched', 'p-partial', 'p-unavail']);
});

test('backfill avança concluídos de trial direto para Prontas para contato (sem análise)', async () => {
  const ctx = await setup({ 'org-trial': 'trial' });
  await ctx.seed({ id: 'p-t', orgId: 'org-trial', enrichmentStatus: 'enriched' });

  const summary = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
  });

  assert.strictEqual(summary.advanced, 1);
  assert.strictEqual(summary.queued, 0);
  const row = await ctx.prisma.prospect.findUnique({ where: { id: 'p-t' } });
  assert.strictEqual(row.status, 'qualified');
});

test('backfill NÃO toca lead com enriquecimento pendente (a esteira segue devendo)', async () => {
  const ctx = await setup();
  await ctx.seed({ id: 'p-pending', enrichmentStatus: 'pending' });
  await ctx.seed({ id: 'p-null', enrichmentStatus: null });

  const summary = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
  });

  assert.strictEqual(summary.scanned, 2);
  assert.strictEqual(summary.advanced, 0);
  assert.strictEqual((await ctx.prisma.prospect.findUnique({ where: { id: 'p-pending' } })).status, 'prospect');
  assert.strictEqual((await ctx.prisma.prospect.findUnique({ where: { id: 'p-null' } })).status, 'prospect');
});

test('backfill é idempotente: na segunda passada nada resta a avançar', async () => {
  const ctx = await setup();
  await ctx.seed({ id: 'p-1' });

  const first = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
  });
  assert.strictEqual(first.advanced, 1);

  const second = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
  });
  assert.strictEqual(second.scanned, 0);
  assert.strictEqual(second.advanced, 0);
});

test('modo dry não escreve nada', async () => {
  const ctx = await setup();
  await ctx.seed({ id: 'p-1' });

  const summary = await backfillQualificationAdvance(ctx.prisma, {
    planFor: ctx.planFor,
    enqueueAnalysis: ctx.enqueueAnalysis,
    dry: true,
  });
  assert.strictEqual(summary.advanced, 1);
  assert.strictEqual((await ctx.prisma.prospect.findUnique({ where: { id: 'p-1' } })).status, 'prospect');
  assert.strictEqual(ctx.analyses.length, 0);
});
