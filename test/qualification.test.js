const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma, createFakeJs } = require('./helpers/fake-prisma');
const { createQualificationConsumer } = require('../qualification');

function makeConsumer({ recalc, forceFail = false } = {}) {
  const prisma = createFakePrisma();
  const js = createFakeJs();
  const metrics = { total: 0, failures: 0 };
  const recalcCalls = [];
  const consumer = createQualificationConsumer({
    prisma,
    js,
    recalcLeadScore: async (p, prospectId) => {
      metrics.total += 1;
      recalcCalls.push(prospectId);
      if (forceFail) throw new Error('falha forçada');
      if (recalc) return recalc(p, prospect);
    },
    onMetric: (name) => { metrics[name] = (metrics[name] || 0) + 1; },
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
    debounceMs: 30,
    now: () => new Date(),
  });
  return { consumer, prisma, js, metrics, recalcCalls };
}

const RESULT = (over = {}) => ({
  version: '1', taskId: 't-1', taskKey: 'k-1', jobId: 'j-1',
  orgId: 'org-1', prospectId: 'p-1', entityKey: 'prospect:p-1', entityType: 'prospect',
  capability: 'search.news', provider: null, status: 'COMPLETED',
  data: {}, facts: [], error: null, durationMs: 5, workerVersion: 't',
  suggestedTasks: [], completedAt: new Date().toISOString(), ...over,
});

test('US7 result COMPLETED dispara recálculo de score do prospect', async () => {
  const { consumer, recalcCalls } = makeConsumer();
  await consumer.handleResult(RESULT());
  await new Promise((r) => setTimeout(r, 60)); // janela do debounce
  assert.strictEqual(recalcCalls.length, 1);
  assert.strictEqual(recalcCalls[0], 'p-1');
});

test('US7 debounce: N results do mesmo prospect em janela curta → 1 recálculo', async () => {
  const { consumer, recalcCalls } = makeConsumer();
  for (let i = 0; i < 5; i += 1) {
    await consumer.handleResult(RESULT({ taskId: `t-${i}` }));
  }
  await new Promise((r) => setTimeout(r, 60)); // janela do debounce passa
  assert.strictEqual(recalcCalls.length, 1); // coalescido
});

test('US7 prospects diferentes recalculam separadamente', async () => {
  const { consumer, recalcCalls } = makeConsumer();
  await consumer.handleResult(RESULT({ prospectId: 'p-1' }));
  await consumer.handleResult(RESULT({ prospectId: 'p-2' }));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepStrictEqual(recalcCalls.sort(), ['p-1', 'p-2']);
});

test('US7 falha na qualificação é isolada (não propaga, conta métrica)', async () => {
  const { consumer, metrics } = makeConsumer({ forceFail: true });
  await consumer.handleResult(RESULT()); // NÃO deve lançar
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(metrics.b2base_enrichment_qualification_failures_total, 1);
});

test('US7 FAILED transiente não recalcula (nada novo a pontuar ainda)', async () => {
  const { consumer, recalcCalls } = makeConsumer();
  await consumer.handleResult(RESULT({ status: 'FAILED', error: { type: 'RATE_LIMIT', message: 'x', retryable: true } }));
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(recalcCalls.length, 0);
});

test('US7 job.completed dispara recálculo final imediato', async () => {
  const { consumer, recalcCalls } = makeConsumer();
  await consumer.handleJobCompleted({
    version: '1', jobId: 'j-1', orgId: 'org-1', prospectId: 'p-9',
    status: 'PARTIAL', counts: { total: 2, completed: 1, failed: 1 }, completionPct: 50,
    completedAt: new Date().toISOString(),
  });
  assert.ok(recalcCalls.includes('p-9'));
});
