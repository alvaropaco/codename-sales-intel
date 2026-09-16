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

// ════════════════════════════════════════════════════════════════════════════
// US2 — resiliência: timeout, retry, permanente × transiente, redelivery, nak
// ════════════════════════════════════════════════════════════════════════════

test('US2 timeout: executor além do timeoutMs → TIMEOUT transiente (retryable)', async () => {
  const { runtime, published, trace } = makeRuntime({
    executors: {
      'identity.domain.verify': async (task, { signal }) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('abortado'); e.name = 'AbortError'; reject(e); });
        });
        return OK_EXECUTOR();
      },
    },
  });
  const msg = createFakeMessage(makeTask({ timeoutMs: 80 }), { trace });
  const out = await runtime.processMessage(msg);
  assert.strictEqual(out.status, 'FAILED');
  assert.strictEqual(published[0].error.type, 'TIMEOUT');
  assert.strictEqual(published[0].error.retryable, true); // manager re-publica com attempt+1
  assert.deepStrictEqual(trace, ['persist', 'publish', 'ack']);
});

test('US2 erro transiente do executor (RATE_LIMIT) → retryable true', async () => {
  const { runtime, published } = makeRuntime({
    executors: {
      'identity.domain.verify': async () => {
        const e = new Error('429 do provider');
        e.code = 'RATE_LIMIT';
        throw e;
      },
    },
  });
  await runtime.processMessage(createFakeMessage(makeTask()));
  assert.strictEqual(published[0].error.type, 'RATE_LIMIT');
  assert.strictEqual(published[0].error.retryable, true);
});

test('US2 falha permanente do executor → retryable false, persiste e ack', async () => {
  const { runtime, published, trace } = makeRuntime({
    executors: {
      'identity.domain.verify': async () => ({
        status: 'FAILED',
        error: { type: 'INVALID_DATA', message: 'domínio malformado', retryable: false },
      }),
    },
  });
  await runtime.processMessage(createFakeMessage(makeTask(), { trace }));
  assert.strictEqual(published[0].status, 'FAILED');
  assert.strictEqual(published[0].error.retryable, false);
  assert.deepStrictEqual(trace, ['persist', 'publish', 'ack']);
});

test('US2 redelivery: resultado já persistido → NÃO reexecuta provider, republisha e ack', async () => {
  let calls = 0;
  const { runtime, prisma, trace, published } = makeRuntime({
    executors: { 'identity.domain.verify': async () => { calls += 1; return OK_EXECUTOR(); } },
  });
  // Primeira execução normal.
  await runtime.processMessage(createFakeMessage(makeTask(), { trace }));
  assert.strictEqual(calls, 1);
  // Redelivery da mesma mensagem (broker reentrega após ack perdido, p. ex.).
  const trace2 = [];
  await runtime.processMessage(createFakeMessage(makeTask(), { trace: trace2 }));
  assert.strictEqual(calls, 1); // atalho idempotente: provider NÃO foi reexecutado
  assert.strictEqual(trace2[trace2.length - 1], 'ack');
  assert.strictEqual(published.length, 2);
  assert.strictEqual(published[1].status, 'COMPLETED');
});

test('US2 publish falha → nak(delay) sem ack (broker reentrega a mesma mensagem)', async () => {
  const { runtime, trace } = makeRuntime({
    executors: { 'identity.domain.verify': OK_EXECUTOR },
    jsOver: {},
  });
  // Publisher que falha sempre (JetStream fora do ar, p. ex.).
  const { createWorkerRuntime: _c } = require('../workers/sdk/runtime');
  const failRuntime = runtime;
  failRuntime.setPublisherForTest(async () => { throw new Error('jetstream indisponível'); });
  const msg = createFakeMessage(makeTask(), { trace });
  const out = await failRuntime.processMessage(msg);
  assert.strictEqual(out.status, 'NAK');
  const nak = trace.find((t) => Array.isArray(t) && t[0] === 'nak');
  assert.ok(nak, 'esperado nak com delay');
  assert.ok(nak[1] >= 5000, `delay ${nak[1]} deve respeitar o 1º degrau de backoff`);
  assert.ok(!trace.includes('ack'), 'não deve ackar quando o publish falha');
});
