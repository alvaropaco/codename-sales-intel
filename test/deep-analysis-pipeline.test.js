'use strict';

/**
 * Testes de orquestração da análise profunda (feature 005) — runner criado
 * por createDeepAnalysisRunner com dependências injetadas (fake-prisma +
 * fake-llm), no padrão test/qualification.test.js. Cobertura: gatilho
 * idempotente, aplicação do veredito, falhas, concorrência, gating por plano
 * e reconciliação no boot (R6).
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createFakeLlm, contactResult, noContactResult } = require('./helpers/fake-llm');
const { createDeepAnalysisRunner } = require('../deep-analysis');

function prospectFixture(overrides = {}) {
  return {
    id: 'lead-001',
    orgId: 'org-1',
    companyName: 'Empresa Exemplo LTDA',
    industry: 'Tecnologia',
    status: 'deep_analysis',
    analysisStatus: 'not_started',
    enrichmentStatus: 'enriched',
    enrichmentVersion: 3,
    enrichmentSummary: { technologies: ['hubspot'] },
    opportunityScore: 64,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

async function setup({ plan = 'premium', llm, prospect: prospectOverrides } = {}) {
  const prisma = createFakePrisma();
  await prisma.organization.create({ data: { id: 'org-1', name: 'Cliente Org', plan } });
  await prisma.commercialSettings.create({
    data: { id: 'cs-1', orgId: 'org-1', productDescription: 'SaaS de gestão fiscal' },
  });
  const prospect = await prisma.prospect.create({ data: prospectFixture(prospectOverrides) });
  const fakeLlm = llm || createFakeLlm();
  const metrics = [];
  const runner = createDeepAnalysisRunner({
    prisma,
    callLlm: fakeLlm,
    getOrgPlan: async () => plan,
    onMetric: (name, labels) => metrics.push({ name, labels }),
    logger: { info() {}, warn() {}, error() {} },
  });
  return { prisma, prospect, fakeLlm, runner, metrics };
}

test('enqueue premium: executa análise e aplica veredito positivo (FR-005/FR-009)', async () => {
  const { prisma, prospect, runner, metrics } = await setup();

  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  assert.strictEqual(result.started, true);
  await result.done;

  const rows = prisma.deepAnalysis.rows;
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.verdict, 'contact');
  assert.strictEqual(row.finalScore, 72);
  assert.strictEqual(row.orgId, 'org-1');
  assert.strictEqual(row.enrichmentVersion, 3);
  assert.strictEqual(row.deterministicScore, 64);
  assert.strictEqual(row.orgContextConsidered, true); // commercialSettings semeado
  assert.ok(row.summary.length > 0);
  assert.ok(Array.isArray(row.impressions) && row.impressions.length > 0);

  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(fresh.status, 'qualified'); // FR-009
  assert.strictEqual(fresh.analysisStatus, 'completed');
  assert.strictEqual(fresh.verdict, 'contact');
  assert.strictEqual(fresh.opportunityScore, 72); // FR-008: score da IA vira o exibido
  assert.strictEqual(fresh.currentDeepAnalysisId, row.id);

  assert.ok(metrics.some((m) => m.name === 'started'));
  assert.ok(metrics.some((m) => m.name === 'completed' && m.labels.verdict === 'contact'));
});

test('enqueue é idempotente no mesmo enrichmentVersion (princípio II)', async () => {
  const { prisma, prospect, runner } = await setup();

  const first = await runner.enqueue(prospect, { trigger: 'auto' });
  await first.done;

  // Gatilho duplicado (ex.: reentrega do mesmo evento NATS): o lead já saiu
  // da coluna (veredito aplicado) — nada é reexecutado, nenhuma linha nova.
  const second = await runner.enqueue(prospect, { trigger: 'auto' });
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(prisma.deepAnalysis.rows.length, 1); // nenhuma duplicata

  // E no estado intermediário (lead ainda na coluna, versão já analisada):
  const stale = { ...prospect, status: 'deep_analysis', analysisStatus: 'not_started' };
  const third = await runner.enqueue(stale, { trigger: 'auto' });
  assert.strictEqual(third.skipped, true);
  assert.strictEqual(third.reason, 'already_completed');
  assert.strictEqual(prisma.deepAnalysis.rows.length, 1);
});

test('veredito negativo move o lead para Descartados (FR-010)', async () => {
  const { prisma, prospect, runner } = await setup({ llm: createFakeLlm({ result: noContactResult() }) });

  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  await result.done;

  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(fresh.status, 'discarded');
  assert.strictEqual(fresh.verdict, 'no_contact');
  assert.strictEqual(fresh.opportunityScore, 24);
});

test('falha do LLM mantém o lead em Análise profunda com estado de erro (FR-015)', async () => {
  const { prisma, prospect, runner, metrics } = await setup({
    llm: createFakeLlm({ fail: true }),
  });

  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  await result.done;

  const row = prisma.deepAnalysis.rows[0];
  assert.strictEqual(row.status, 'failed');
  assert.ok(row.errorMessage.length > 0);
  assert.strictEqual(row.verdict, null);

  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(fresh.status, 'deep_analysis'); // não avança nem descarta
  assert.strictEqual(fresh.analysisStatus, 'failed');
  assert.ok(metrics.some((m) => m.name === 'failed'));
});

test('JSON inválido da IA resulta em análise falha (resultado nunca é aplicado)', async () => {
  const { prisma, prospect, runner } = await setup({
    llm: createFakeLlm({ rawContent: 'não sei analisar isso' }),
  });

  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  await result.done;

  const row = prisma.deepAnalysis.rows[0];
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.verdict, null);
  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(fresh.status, 'deep_analysis');
});

test('reexecução concorrente é no-op (uma execução por lead)', async () => {
  const { prospect, runner } = await setup();

  const first = await runner.enqueue(prospect, { trigger: 'manual' });
  assert.strictEqual(first.started, true);
  const second = await runner.enqueue(prospect, { trigger: 'manual' });
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.reason, 'running');
  await first.done;
});

test('org sem plano premium nunca executa análise (FR-018)', async () => {
  const { prisma, prospect, runner, fakeLlm } = await setup({ plan: 'trial' });

  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'plan');
  assert.strictEqual(prisma.deepAnalysis.rows.length, 0);
  assert.strictEqual(fakeLlm.calls.length, 0);
});

let reconcileImplCalls = 0;

test('reconcile no boot re-despacha análise presa em running (R6)', async () => {
  const { prisma, prospect, runner } = await setup({
    // primeira chamada falha (linha termina failed; o teste simula o estado
    // "presa em running" de um pod que morreu no meio), reconcile com LLM saudável
    llm: createFakeLlm({
      impl: (opts) => {
        reconcileImplCalls += 1;
        if (reconcileImplCalls === 1) throw new Error('LiteLLM HTTP 502');
        return Promise.resolve({ content: JSON.stringify(contactResult()), usage: null, model: 'fake-model' });
      },
    }),
  });

  const broken = await runner.enqueue(prospect, { trigger: 'auto' });
  await broken.done;
  assert.strictEqual(prisma.deepAnalysis.rows[0].status, 'failed');
  // Simula o estado "presa": execução running sem conclusão
  await prisma.deepAnalysis.update({
    where: { id: prisma.deepAnalysis.rows[0].id },
    data: { status: 'running', errorMessage: null },
  });
  await prisma.prospect.update({ where: { id: prospect.id }, data: { analysisStatus: 'running' } });

  const summary = await runner.reconcile({ limit: 10 });
  assert.strictEqual(summary.reconciled, 1);
  // A execução interrompida permanece no histórico; a nova linha conclui.
  assert.strictEqual(prisma.deepAnalysis.rows.length, 2);
  assert.ok(prisma.deepAnalysis.rows.some((r) => r.status === 'completed'));

  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(fresh.analysisStatus, 'completed');
  assert.strictEqual(fresh.status, 'qualified');

  const empty = await runner.reconcile({ limit: 10 });
  assert.strictEqual(empty.reconciled, 0);
});

test('reconcile também enfileira leads parados em not_started (US1 checkpoint)', async () => {
  const { prisma, prospect, runner } = await setup();
  // Lead pousou na coluna mas a fila nunca rodou (release em duas ondas)
  await prisma.prospect.update({ where: { id: prospect.id }, data: { analysisStatus: 'not_started' } });

  const summary = await runner.reconcile({ limit: 10 });
  assert.strictEqual(summary.reconciled, 1);
  const row = prisma.deepAnalysis.rows[0];
  assert.strictEqual(row.status, 'completed');
});

test('recalcLeadScore não sobrescreve o score da IA com análise vigente (FR-008/T034)', async () => {
  const { prisma, prospect, runner } = await setup();
  const result = await runner.enqueue(prospect, { trigger: 'auto' });
  await result.done;
  assert.strictEqual((await prisma.prospect.findUnique({ where: { id: prospect.id } })).opportunityScore, 72);

  // Evidência tardia dispara o recálculo determinístico…
  const { recalcLeadScore } = require('../opportunity-score');
  await recalcLeadScore(prisma, prospect.id);

  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  // …o score oficial continua o da IA; o breakdown segue atualizado.
  assert.strictEqual(fresh.opportunityScore, 72);
  assert.ok(fresh.enrichmentSummary.score_breakdown, 'score_breakdown deveria ser atualizado');
});
