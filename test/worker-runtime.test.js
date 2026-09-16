const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma, createFakeMessage } = require('./helpers/fake-prisma');
const contracts = require('../enrichment-contracts');
const capabilities = require('../enrichment-capabilities');
const { createWorkerRuntime } = require('../workers/sdk/runtime');

const WORKER_VERSION = 'test-worker-1';

function makeTask(over = {}) {
  return {
    version: '1',
    taskId: 't-1', taskKey: 'key-1', jobId: 'job-1', orgId: 'org-1', prospectId: 'p-1',
    entityKey: 'prospect:p-1', entityType: 'prospect',
    capability: 'identity.domain.verify', provider: null,
    input: { domain: 'exemplo.com.br' },
    priority: 1, attempt: 1, maxAttempts: 3, timeoutMs: 500,
    depth: 0, spawnedByTaskId: null, notBefore: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** Runtime com fakes; executores de teste retornam resultado fixo ou lançam. */
function makeRuntime({ executors = {}, prismaOver = {}, jsOver = {}, ...over } = {}) {
  const prisma = Object.assign(createFakePrisma(), prismaOver);
  const js = Object.assign({ publish: async () => ({ seq: 1 }) }, jsOver);
  const trace = [];
  const published = [];
  // Instrumenta a persistência para asserir a ordem persist→publish→ack.
  const origUpsert = prisma.enrichmentResult.upsert.bind(prisma.enrichmentResult);
  prisma.enrichmentResult.upsert = async (args) => {
    trace.push('persist');
    return origUpsert(args);
  };
  const runtime = createWorkerRuntime({
    name: 'identity',
    capabilities,
    workerVersion: WORKER_VERSION,
    deps: {
      prisma,
      js,
      registerExecutors: (map) => Object.assign(trace, [], map), // noop
      publisher: async (result) => { trace.push('publish'); published.push(result); },
      logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
    },
    ...over,
  });
  runtime.registerExecutorsForTest(executors);
  return { runtime, prisma, js, trace, published };
}

const OK_EXECUTOR = async () => ({
  status: 'COMPLETED',
  data: { domain_active: true },
  facts: [{ attribute: 'company.domain_active', value: true, confidence: 0.9,
    evidence: { sourceType: 'dns', retrievedAt: new Date().toISOString() } }],
});

// ── Caminho feliz ───────────────────────────────────────────────────────────

test('US1 runtime caminho feliz: RUNNING → executa → persiste → publica → ack (ordem)', async () => {
  const { runtime, prisma, trace, published } = makeRuntime({
    executors: { 'identity.domain.verify': OK_EXECUTOR },
  });
  const msg = createFakeMessage(makeTask(), { trace });

  await runtime.processMessage(msg);

  assert.deepStrictEqual(trace, ['persist', 'publish', 'ack']); // ack SOMENTE após persist+publish
  const taskRow = await prisma.enrichmentTask.findUnique({ where: { id: 't-1' } });
  assert.strictEqual(taskRow.status, 'RUNNING'); // runtime marca início (startedAt)
  assert.ok(taskRow.startedAt);
  const resultRow = await prisma.enrichmentResult.findUnique({ where: { taskId: 't-1' } });
  assert.strictEqual(resultRow.status, 'COMPLETED');
  assert.strictEqual(resultRow.workerVersion, WORKER_VERSION);
  assert.strictEqual(published[0].status, 'COMPLETED');
  assert.strictEqual(published[0].facts.length, 1);
});

test('US1 runtime: capability desconhecida → FAILED permanente INVALID_INPUT com ack imediato', async () => {
  const { runtime, trace, published } = makeRuntime({});
  const msg = createFakeMessage(makeTask({ capability: 'capability.fantasma' }), { trace });
  await runtime.processMessage(msg);
  assert.deepStrictEqual(trace, ['publish', 'ack']);
  assert.strictEqual(published[0].status, 'FAILED');
  assert.strictEqual(published[0].error.type, 'INVALID_INPUT');
  assert.strictEqual(published[0].error.retryable, false);
});

test('US1 runtime: input inválido pelo catálogo → FAILED permanente, executor nunca chamado', async () => {
  let called = 0;
  const { runtime, trace, published } = makeRuntime({
    executors: { 'identity.domain.verify': async () => { called += 1; return OK_EXECUTOR(); } },
  });
  const msg = createFakeMessage(makeTask({ input: {} }), { trace }); // domain ausente
  await runtime.processMessage(msg);
  assert.strictEqual(called, 0);
  assert.deepStrictEqual(trace, ['publish', 'ack']);
  assert.strictEqual(published[0].error.type, 'INVALID_INPUT');
});

test('US1 runtime: concorrência respeitada (semáforo do processo)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const slowExecutor = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight -= 1;
    return OK_EXECUTOR();
  };
  const { runtime } = makeRuntime({ executors: { 'identity.domain.verify': slowExecutor }, concurrency: 2 });

  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      runtime.processMessage(createFakeMessage(makeTask({ taskId: `t-${i}` })))
    )
  );
  assert.ok(maxInFlight <= 2, `maxInFlight=${maxInFlight} deve ser <= 2`);
});

test('US1 runtime: payload ilegível → poison (term), sem publish', async () => {
  const { runtime, trace, published } = makeRuntime({});
  const msg = { data: Buffer.from('isto não é json'), ack: async () => trace.push('ack'), nak: async () => trace.push('nak'), term: async () => trace.push('term') };
  await runtime.processMessage(msg);
  assert.deepStrictEqual(trace, ['term']);
  assert.strictEqual(published.length, 0);
});
