'use strict';

/**
 * Testes do sweeper de tasks PARKED (feature 006): re-publicação de tasks
 * vencidas com taxa limitada por provedor, lock de líder, expiração da janela
 * (falha real + notificação) e tolerância a falhas de publicação.
 * Padrão: fake-prisma + fake-redis com relógio controlável.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createFakeRedis, createFakeClock } = require('./helpers/fake-redis');
const { createEnrichmentSweeper } = require('../enrichment-sweeper');

const HOUR = 3600e3;

function parkedFixture(overrides = {}) {
  return {
    id: 't-1', orgId: 'org-1', jobId: 'job-1', prospectId: 'p-1',
    taskKey: 'k-1', entityKey: 'prospect:p-1', entityType: 'prospect',
    capability: 'company.profile.deep', status: 'PARKED',
    attempt: 3, maxAttempts: 3, parkCycles: 1,
    lastError: { type: 'PROVIDER_CIRCUIT_OPEN', message: 'circuito aberto', provider: 'pdl', attempt: 3 },
    parkedAt: new Date(1_700_000_000_000),
    nextAttemptAt: new Date(1_700_000_000_000),
    createdAt: new Date(1_700_000_000_000),
    ...overrides,
  };
}

function setup({ ratePerMin = 6, parkWindowHours = 72 } = {}) {
  const clock = createFakeClock({ start: 1_700_070_000_000 });
  const prisma = createFakePrisma();
  const redis = createFakeRedis({ clock: { now: () => clock.now() } });
  const published = [];
  const parkExpired = [];
  const makeSweeper = (overrides = {}) => createEnrichmentSweeper({
    prisma,
    republishTask: async (task, opts) => { published.push({ task, opts }); },
    redis,
    config: { parkWindowHours, providerRatePerMin: ratePerMin, leaderTtlMs: 65000 },
    now: () => clock.now(),
    logger: { info() {}, warn() {}, error() {} },
    notifier: { notifyParkExpired: async (info) => { parkExpired.push(info); } },
    ...overrides,
  });
  const sweeper = makeSweeper();
  return {
    clock, prisma, redis, published, parkExpired, sweeper, makeSweeper,
    now: () => clock.now(),
    seed: (over) => prisma.enrichmentTask.create({ data: parkedFixture({ parkedAt: new Date(clock.start), nextAttemptAt: new Date(clock.start), ...over }) }),
  };
}

test('sweeper re-publica apenas tasks vencidas e marca o ciclo como publicado', async () => {
  const ctx = setup();
  await ctx.seed({ id: 't-due', nextAttemptAt: new Date(ctx.now() - 1000) });
  await ctx.seed({ id: 't-future', nextAttemptAt: new Date(ctx.now() + 3600e3) });

  const out = await ctx.sweeper.runOnce({ limit: 100 });

  assert.strictEqual(out.scanned, 1);
  assert.strictEqual(out.republished, 1);
  assert.strictEqual(ctx.published.length, 1);
  assert.strictEqual(ctx.published[0].opts.attempt, 4); // attempt+1

  const due = await ctx.prisma.enrichmentTask.findUnique({ where: { id: 't-due' } });
  assert.strictEqual(due.status, 'QUEUED');             // volta à fila
  assert.strictEqual(due.attempt, 4);
  const events = ctx.prisma.enrichmentTaskRetryEvent.rows.filter((e) => e.taskId === 't-due');
  // O ciclo vigente é marcado como publicado (updateMany) — sem evento para
  // tasks nunca parkadas pelo manager.
  assert.ok(events.every((e) => e.publishedAt !== null) || events.length === 0);
  const future = await ctx.prisma.enrichmentTask.findUnique({ where: { id: 't-future' } });
  assert.strictEqual(future.status, 'PARKED');          // não vencida: intocada
});

test('token bucket limita re-publicações por provedor (FR-003)', async () => {
  const ctx = setup({ ratePerMin: 2 });
  await ctx.seed({ id: 'a', nextAttemptAt: new Date(ctx.now() - 1000) });
  await ctx.seed({ id: 'b', nextAttemptAt: new Date(ctx.now() - 1000), taskKey: 'k-b' });
  await ctx.seed({ id: 'c', nextAttemptAt: new Date(ctx.now() - 1000), taskKey: 'k-c' });

  const out = await ctx.sweeper.runOnce({ limit: 100 });

  assert.strictEqual(out.republished, 2);               // taxa 2/min
  assert.strictEqual(out.deferred, 1);                  // terceira fica para o próximo ciclo
  assert.strictEqual(ctx.published.length, 2);
  const states = [];
  for (const id of ['a', 'b', 'c']) {
    const t = await ctx.prisma.enrichmentTask.findUnique({ where: { id } });
    states.push(t.status);
  }
  assert.strictEqual(states.filter((s) => s === 'PARKED').length, 1);
});

test('janela expirada → FAILED PARK_WINDOW_EXPIRED + notificação (FR-006)', async () => {
  const ctx = setup({ parkWindowHours: 72 });
  const old = new Date(ctx.now() - 73 * HOUR);
  await ctx.seed({ id: 't-old', parkedAt: old, nextAttemptAt: new Date(ctx.now() - 1000) });

  const out = await ctx.sweeper.runOnce({ limit: 100 });

  assert.strictEqual(out.expired, 1);
  const task = await ctx.prisma.enrichmentTask.findUnique({ where: { id: 't-old' } });
  assert.strictEqual(task.status, 'FAILED');
  assert.strictEqual(task.lastError.type, 'PARK_WINDOW_EXPIRED');
  assert.strictEqual(ctx.parkExpired.length, 1);
  assert.strictEqual(ctx.parkExpired[0].taskId, 't-old');
});

test('lock de líder: holder externo faz o ciclo pular (R2)', async () => {
  const ctx = setup();
  await ctx.seed({ id: 't-1', nextAttemptAt: new Date(ctx.now() - 1000) });

  // Outro holder pré-ocupa o lock (SET NX PX falha para o sweeper)
  await ctx.redis.set('enrichment:sweeper:leader', 'outro-holder', 'PX', 65000, 'NX');
  const skipped = await ctx.sweeper.runOnce({ limit: 100 });
  assert.strictEqual(skipped.skipped, 'leader');
  assert.strictEqual(ctx.published.length, 0);

  // Lock expira (relógio avança) → ciclo roda normalmente
  ctx.clock.advance(66000);
  const run = await ctx.sweeper.runOnce({ limit: 100 });
  assert.strictEqual(run.skipped, undefined);
  assert.strictEqual(run.republished, 1);
});

test('falha de re-publicação não derruba o ciclo nem perde a task', async () => {
  const clock = createFakeClock({ start: 1_700_070_000_000 });
  const prisma = createFakePrisma();
  await prisma.enrichmentTask.create({ data: parkedFixture({ parkedAt: new Date(clock.start), nextAttemptAt: new Date(clock.start) }) });
  let calls = 0;
  const sweeper = createEnrichmentSweeper({
    prisma,
    republishTask: async () => {
      calls += 1;
      if (calls === 1) throw new Error('nats fora');
    },
    redis: createFakeRedis({ clock: { now: () => clock.now() } }),
    config: { parkWindowHours: 72, providerRatePerMin: 100, leaderTtlMs: 65000 },
    now: () => clock.now(),
    logger: { info() {}, warn() {}, error() {} },
  });

  const out1 = await sweeper.runOnce({ limit: 10 });
  assert.strictEqual(out1.republished, 0);
  const task = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(task.status, 'PARKED');            // permanece parked
  const out2 = await sweeper.runOnce({ limit: 10 });
  assert.strictEqual(out2.republished, 1);              // próximo ciclo recupera
});
