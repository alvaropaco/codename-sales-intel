'use strict';

/**
 * Testes de resiliência do motor de enriquecimento (feature 006):
 * premissa "task nunca termina FAILED por erro transitório" — PARKED com
 * agendamento, job DEGRADED não-terminal, refinalização automática e falha
 * real apenas para não-transientes. Padrão test/enrichment-manager.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma, createFakeJs } = require('./helpers/fake-prisma');
const capabilities = require('../enrichment-capabilities');
const { createEnrichmentManager } = require('../enrichment-manager');

const SILENT = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };

function makeManager({ plan = 'premium' } = {}) {
  const prisma = createFakePrisma();
  const js = createFakeJs();
  const failuresReal = [];
  const manager = createEnrichmentManager({
    prisma,
    js,
    getOrgPlan: async () => plan,
    capabilities,
    logger: SILENT,
    onFailureReal: (info) => failuresReal.push(info),
  });
  return { prisma, js, manager, failuresReal };
}

async function seedJobAndTask(prisma, { taskOver = {}, jobOver = {} } = {}) {
  await prisma.enrichmentJob.create({
    data: { id: 'job-1', orgId: 'org-1', prospectId: 'p-1', status: 'RUNNING', trigger: 'api', plan: 'premium', engine: 'v2', ...jobOver },
  });
  await prisma.prospect.create({
    data: { id: 'p-1', orgId: 'org-1', companyName: 'Marispan Ltda', createdAt: new Date() },
  });
  return prisma.enrichmentTask.create({
    data: {
      id: 't-1', orgId: 'org-1', jobId: 'job-1', prospectId: 'p-1',
      taskKey: 'k-1', entityKey: 'prospect:p-1', entityType: 'prospect',
      capability: 'company.profile.deep', provider: null,
      input: {}, inputHash: 'h-1', status: 'RUNNING', attempt: 3, maxAttempts: 3,
      createdAt: new Date(), ...taskOver,
    },
  });
}

function failedResult(over = {}) {
  return {
    version: '1', workerVersion: '1', completedAt: new Date().toISOString(),
    taskId: 't-1', taskKey: 'k-1', jobId: 'job-1',
    orgId: 'org-1', prospectId: 'p-1', entityKey: 'prospect:p-1', entityType: 'prospect',
    capability: 'company.profile.deep', provider: 'pdl', status: 'FAILED',
    error: { type: 'PROVIDER_CIRCUIT_OPEN', message: 'circuito aberto', retryable: true },
    attempt: 3, durationMs: 120,
    ...over,
  };
}

test('erro TRANSIENTE esgotado → PARKED com agendamento e retry event (FR-001)', async () => {
  const { prisma, manager } = makeManager();
  await seedJobAndTask(prisma);

  const out = await manager.handleResult(failedResult());
  assert.strictEqual(out.ok, true);

  const task = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(task.status, 'PARKED');            // nunca FAILED (FR-001)
  assert.strictEqual(task.parkCycles, 1);
  assert.ok(task.nextAttemptAt, 'nextAttemptAt deveria estar agendado');
  assert.ok(task.parkedAt, 'parkedAt deveria ser registrado');

  const events = prisma.enrichmentTaskRetryEvent.rows;
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].cycle, 1);
  assert.strictEqual(events[0].errorType, 'PROVIDER_CIRCUIT_OPEN');
  assert.strictEqual(events[0].publishedAt ?? null, null); // aguardando sweeper
});

test('job com todas as tasks em PARKED → DEGRADED, sem publicar completion (FR-009)', async () => {
  const { prisma, js, manager } = makeManager();
  await seedJobAndTask(prisma);

  const out = await manager.handleResult(failedResult());
  assert.strictEqual(out.jobFinalized, 'DEGRADED');     // não-terminal (aguardando provedor)

  const job = await prisma.enrichmentJob.findUnique({ where: { id: 'job-1' } });
  assert.strictEqual(job.status, 'DEGRADED');
  assert.strictEqual(job.completedAt, null);
  // Nenhum evento job.completed publicado para DEGRADED (invariante I3)
  assert.strictEqual(js.published.filter((m) => m.subject.includes('job.completed')).length, 0);
});

test('conclusão tardia da parked refinaliza o job (FR-004)', async () => {
  const { prisma, js, manager } = makeManager();
  await seedJobAndTask(prisma);
  await manager.handleResult(failedResult());           // → PARKED + DEGRADED

  // Sweeper re-publicou (QUEUED) e o worker concluiu:
  await prisma.enrichmentTask.update({ where: { id: 't-1' }, data: { status: 'QUEUED', attempt: 4 } });
  const out = await manager.handleResult(failedResult({
    status: 'COMPLETED', attempt: 4,
    data: { company: { name: 'Marispan' } }, facts: [{ attribute: 'company.name', value: 'Marispan', confidence: 0.9 }],
    error: undefined,
  }));

  assert.strictEqual(out.jobFinalized, 'COMPLETED');
  const job = await prisma.enrichmentJob.findUnique({ where: { id: 'job-1' } });
  assert.strictEqual(job.status, 'COMPLETED');
  const task = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(task.status, 'COMPLETED');
  // completion publicado exatamente 1× (refinalização aditiva, sem duplicata)
  assert.strictEqual(js.published.filter((m) => m.subject.includes('job.completed')).length, 1);
});

test('erro NÃO-transiente esgotado → FAILED real + notificação (FR-005)', async () => {
  const { prisma, manager, failuresReal } = makeManager();
  await seedJobAndTask(prisma);

  const out = await manager.handleResult(failedResult({
    error: { type: 'VALIDATION', message: 'entrada inválida', retryable: false },
  }));

  assert.strictEqual(out.ok, true);
  const task = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(task.status, 'FAILED');            // não-transiente é terminal
  assert.strictEqual(failuresReal.length, 1);
  assert.strictEqual(failuresReal[0].errorType, 'VALIDATION');
  assert.strictEqual(failuresReal[0].orgId, 'org-1');
});

test('segundo ciclo parked incrementa parkCycles e cria novo retry event (I2)', async () => {
  const { prisma, manager } = makeManager();
  await seedJobAndTask(prisma);
  // Job fica RUNNING (há outra task ativa) para não finalizar nos parks
  await prisma.enrichmentTask.create({
    data: {
      id: 't-2', orgId: 'org-1', jobId: 'job-1', prospectId: 'p-1',
      taskKey: 'k-2', entityKey: 'prospect:p-1', entityType: 'prospect',
      capability: 'company.identity', status: 'RUNNING', attempt: 0, maxAttempts: 3,
      input: {}, inputHash: 'h-2', createdAt: new Date(),
    },
  });

  await manager.handleResult(failedResult());
  const first = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(first.parkCycles, 1);

  // Sweeper re-publicou (QUEUED) e falhou transiente de novo:
  await prisma.enrichmentTask.update({ where: { id: 't-1' }, data: { status: 'QUEUED', attempt: 4 } });
  await manager.handleResult(failedResult({ attempt: 4 }));

  const t1 = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(t1.parkCycles, 2);
  assert.strictEqual(prisma.enrichmentTaskRetryEvent.rows.filter((e) => e.taskId === 't-1').length, 2);
});

test('resync de task órfã com tentativas esgotadas → PARKED (nunca FAILED, FR-001)', async () => {
  const { prisma, manager } = makeManager();
  await seedJobAndTask(prisma);
  await prisma.enrichmentTask.update({
    where: { id: 't-1' },
    data: { status: 'RUNNING', attempt: 3, maxAttempts: 3, startedAt: new Date(Date.now() - 3600e3) },
  });

  const summary = await manager.resyncStalledTasks({ staleMs: 60000 });
  assert.ok(summary.parked >= 1);                       // esgotada vai para PARKED
  const task = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(task.status, 'PARKED');            // não FAILED (ORPHANED é transiente na natureza)
});
