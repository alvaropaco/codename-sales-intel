'use strict';

/**
 * Testes do reenfileiramento do backlog (feature 006, US2/FR-008):
 * scripts/backfill-requeue-failed.js — apenas tasks FAILED com erro
 * TRANSIENTE voltam (PARKED escalonado); não-transientes ficam de fora
 * (falha real, notificável); idempotente; dry não escreve.
 * Padrão: fake-prisma, sem rede.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { backfillRequeueFailed } = require('../scripts/backfill-requeue-failed');

const NOW = new Date('2026-09-20T12:00:00Z');

function failedFixture(overrides = {}) {
  return {
    id: 't-1', orgId: 'org-1', jobId: 'job-1', prospectId: 'p-1',
    taskKey: 'k-1', entityKey: 'prospect:p-1', entityType: 'prospect',
    capability: 'company.profile.deep', status: 'FAILED',
    attempt: 3, maxAttempts: 3, parkCycles: 0,
    lastError: { type: 'PROVIDER_CIRCUIT_OPEN', message: 'circuito aberto', provider: 'pdl', attempt: 3 },
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

async function setup(tasks) {
  const prisma = createFakePrisma();
  for (const t of tasks) await prisma.enrichmentTask.create({ data: { ...failedFixture(), ...t } });
  return { prisma };
}

test('reenfileira apenas FAILED transitórios, escalonando nextAttemptAt', async () => {
  const prisma = createFakePrisma();
  for (const [i, id] of ['t-1', 't-2', 't-3'].entries()) {
    await prisma.enrichmentTask.create({
      data: failedFixture({ id, taskKey: `k-${i + 1}`, lastError: { type: i === 2 ? 'TIMEOUT' : 'PROVIDER_CIRCUIT_OPEN', provider: 'pdl', attempt: 3 } }),
    });
  }

  const summary = await backfillRequeueFailed(prisma, { staggerStepMs: 60000 });

  assert.strictEqual(summary.scanned, 3);
  assert.strictEqual(summary.requeued, 3);
  const nexts = [];
  for (const id of ['t-1', 't-2', 't-3']) {
    const row = await prisma.enrichmentTask.findUnique({ where: { id } });
    assert.strictEqual(row.status, 'PARKED');
    assert.strictEqual(row.parkCycles, 1);
    assert.ok(row.nextAttemptAt);
    nexts.push(new Date(row.nextAttemptAt).getTime());
    const events = prisma.enrichmentTaskRetryEvent.rows.filter((e) => e.taskId === id);
    assert.strictEqual(events.length, 1); // FR-007: 1 ciclo = 1 evento
  }
  // Escalonamento crescente (sem rajada)
  assert.ok(nexts[0] < nexts[1] && nexts[1] < nexts[2]);
});

test('não-transiente e erro desconhecido ficam de fora (falha real, FR-005)', async () => {
  const prisma = createFakePrisma();
  await prisma.enrichmentTask.create({
    data: failedFixture({ id: 't-real', taskKey: 'k-real', lastError: { type: 'VALIDATION', message: 'entrada inválida', attempt: 3 } }),
  });
  await prisma.enrichmentTask.create({
    data: failedFixture({ id: 't-se', taskKey: 'k-se', lastError: null }),
  });

  const summary = await backfillRequeueFailed(prisma, {});

  assert.strictEqual(summary.scanned, 2);
  assert.strictEqual(summary.requeued, 0);
  assert.strictEqual(summary.skippedRealFailures, 2);
  for (const id of ['t-real', 't-se']) {
    const row = await prisma.enrichmentTask.findUnique({ where: { id } });
    assert.strictEqual(row.status, 'FAILED'); // permanece falha real (notificável)
  }
});

test('idempotente: segunda passada não re-enfileira nada', async () => {
  const prisma = createFakePrisma();
  await prisma.enrichmentTask.create({ data: failedFixture({ id: 't-1' }) });

  await backfillRequeueFailed(prisma, {});
  const second = await backfillRequeueFailed(prisma, {});

  assert.strictEqual(second.scanned, 0);   // task virou PARKED, não FAILED
  assert.strictEqual(second.requeued, 0);
  assert.strictEqual(prisma.enrichmentTaskRetryEvent.rows.length, 1);
});

test('dry não escreve', async () => {
  const prisma = createFakePrisma();
  await prisma.enrichmentTask.create({ data: failedFixture({ id: 't-1' }) });

  const summary = await backfillRequeueFailed(prisma, { dry: true });

  assert.strictEqual(summary.requeued, 1);
  const row = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(row.status, 'FAILED');            // intocado
  assert.strictEqual(prisma.enrichmentTaskRetryEvent.rows.length, 0);
});

test('limit respeitado', async () => {
  const prisma = createFakePrisma();
  for (const [i, id] of ['t-1', 't-2', 't-3'].entries()) {
    await prisma.enrichmentTask.create({ data: failedFixture({ id, taskKey: `k-${i + 1}` }) });
  }

  const summary = await backfillRequeueFailed(prisma, { limit: 2 });

  assert.strictEqual(summary.scanned, 2);
  assert.strictEqual(summary.requeued, 2);
});
