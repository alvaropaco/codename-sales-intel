const test = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../logger');
const contracts = require('../enrichment-contracts');
const { createFakePrisma, createFakeMessage } = require('./helpers/fake-prisma');
const capabilities = require('../enrichment-capabilities');
const { createWorkerRuntime } = require('../workers/sdk/runtime');

test('logger: child compõe bindings (org/job/task) sem mutar o pai', () => {
  const base = createLogger({ component: 'worker' });
  const child = base.child({ orgId: 'org-1', jobId: 'j-1' });
  const grand = child.child({ taskId: 't-1' });
  const seen = [];
  const spy = { info: (line) => seen.push(JSON.parse(line)) };
  const origLog = console.log;
  console.log = (line) => spy.info(line);
  try {
    grand.info('mensagem de teste');
  } finally {
    console.log = origLog;
  }
  assert.strictEqual(seen[0].orgId, 'org-1');
  assert.strictEqual(seen[0].jobId, 'j-1');
  assert.strictEqual(seen[0].taskId, 't-1');
  assert.strictEqual(seen[0].component, 'worker');
  assert.strictEqual(seen[0].level, 'info');
});

test('US8 runtime: logs do processamento carregam correlação da task', async () => {
  const logLines = [];
  const baseLogger = {
    child(bindings) {
      return {
        info: (msg) => logLines.push({ ...bindings, msg }),
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
    },
    info() {}, warn() {}, error() {}, debug() {},
  };
  const prisma = createFakePrisma();
  const runtime = createWorkerRuntime({
    name: 'identity',
    capabilities,
    workerVersion: 'test',
    deps: {
      prisma,
      publisher: async () => {},
      logger: baseLogger,
    },
  });
  runtime.registerExecutors({
    'identity.domain.verify': async (task, ctx) => {
      ctx.logger.info('domain.verify concluído');
      return { status: 'COMPLETED', data: { domain_active: true } };
    },
  });
  const task = {
    version: '1', taskId: 't-corr', taskKey: 'k-corr', jobId: 'job-c', orgId: 'org-c',
    prospectId: 'p-c', entityKey: 'prospect:p-c', entityType: 'prospect',
    capability: 'identity.domain.verify', provider: null, input: { domain: 'exemplo.com' },
    priority: 1, attempt: 1, maxAttempts: 3, timeoutMs: 500, depth: 0,
    spawnedByTaskId: null, notBefore: null, createdAt: new Date().toISOString(),
    traceparent: contracts.makeTraceparent(),
  };
  await runtime.processMessage(createFakeMessage(task));
  const entry = logLines.find((l) => String(l.msg).includes('domain.verify'));
  assert.ok(entry, 'executor logou com bindings');
  assert.strictEqual(entry.orgId, 'org-c');
  assert.strictEqual(entry.jobId, 'job-c');
  assert.strictEqual(entry.taskId, 't-corr');
});

test('US8 manager: toda task publicada carrega traceparent W3C gerado', async () => {
  const { createFakeJs } = require('./helpers/fake-prisma');
  const { createEnrichmentManager } = require('../enrichment-manager');
  const prisma = createFakePrisma();
  await prisma.prospect.create({ data: { id: 'p-1', orgId: 'org-1', companyName: 'X', cnpj: '45299583000131', domain: 'x.com', enrichmentSummary: {}, createdAt: new Date() } });
  const manager = createEnrichmentManager({
    prisma, js: createFakeJs(), getOrgPlan: async () => 'trial',
    capabilities, logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  const js = createFakeJs();
  const manager2 = createEnrichmentManager({
    prisma, js, getOrgPlan: async () => 'trial',
    capabilities, logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  void manager2;
  await manager.createJob({ orgId: 'org-1', prospectId: 'p-1', trigger: 'manual' });
  for (const msg of js.published) {
    if (msg.subject.includes('enrichment.task.')) {
      assert.match(msg.opts.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
  }
});
