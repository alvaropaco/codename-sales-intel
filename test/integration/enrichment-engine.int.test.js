// Testes de integração opt-in do motor de enriquecimento distribuído.
// Só rodam com NATS JetStream e Redis reais (quickstart.md); sem as envs,
// pulam automaticamente — a suíte de unidades (pnpm test) cobre o resto.
const test = require('node:test');
const assert = require('node:assert');

const RUN = Boolean(process.env.NATS_URL && process.env.REDIS_URL);

// ── Fakes compartilhados (manager e worker usam o MESMO estado) ─────────────
function makeWorld() {
  const { createFakePrisma } = require('../helpers/fake-prisma');
  const prisma = createFakePrisma();
  const contracts = require('../../enrichment-contracts');
  const capabilities = require('../../enrichment-capabilities');
  const natsStream = require('../../nats-stream');
  // Capability única para o job completar com 1 task no cenário e2e.
  const singleCaps = {
    eligibleCapabilities: ({ plan } = {}) => ['search.news'],
    getCapability: (name) => (name === 'search.news'
      ? {
        capability: 'search.news', family: 'search', tier: 'basic', enabled: true,
        entityType: ['prospect'], timeoutMs: 5000, maxAttempts: 2, priority: 2,
        providers: ['searxng'],
        inputSchema: { companyName: 'string' },
        validateInput: (i) => (i && i.companyName ? { ok: true } : { ok: false, code: 'INVALID_INPUT', message: 'companyName obrigatório' }),
        expand: [],
      }
      : null),
  };
  return { prisma, contracts, capabilities, natsStream, singleCaps };
}

async function fetchOne(js, durable, filterSubject, { expires = 3000 } = {}) {
  const consumer = js.consumers.get({ durable });
  const msgs = await consumer.fetch({ max_messages: 1, expires });
  for await (const m of msgs) return m;
  return null;
}

test('integração: stream ENRICHMENT aceita publish/consume roundtrip', { skip: RUN ? false : 'NATS_URL/REDIS_URL ausentes' }, async (t) => {
  const { natsStream, contracts } = makeWorld();
  const nc = await natsStream.connectNats({ name: 'b2base-int-test' });
  const jsm = await nc.jetstreamManager();
  await natsStream.ensureStream(jsm);
  const js = nc.jetstream();

  const result = {
    version: '1', taskId: `it-${Date.now()}`, taskKey: 'it-key', jobId: 'it-job',
    orgId: 'it-org', prospectId: 'it-prospect', entityKey: 'prospect:it',
    entityType: 'prospect', capability: 'identity.domain.verify', provider: 'dns.direct',
    status: 'COMPLETED', data: {}, facts: [], error: null, durationMs: 1,
    workerVersion: 'integration', suggestedTasks: [], completedAt: new Date().toISOString(),
  };
  const hdr = natsStream.headers();
  for (const [k, v] of Object.entries(contracts.buildResultHeaders({ ...result, attempt: 1 }))) hdr.set(k, v);
  await js.publish(contracts.RESULT_SUBJECT, contracts.serializePayload(result), { headers: hdr, timeout: 5000 });

  const durable = `it-result-${Date.now()}`;
  await natsStream.ensurePullConsumer(jsm, { durable, filterSubject: contracts.RESULT_SUBJECT, ackWaitMs: 5000, maxDeliver: 2 });
  const m = await fetchOne(js, durable, contracts.RESULT_SUBJECT);
  assert.ok(m, 'mensagem de resultado deveria chegar');
  const parsed = contracts.parsePayload(m.data);
  assert.strictEqual(parsed.taskId, result.taskId);
  await m.ack();
  await natsStream.closeAll();
});

test('integração e2e: job → task publicada → worker executa → result aplicado → job COMPLETED', { skip: RUN ? false : 'NATS_URL/REDIS_URL ausentes' }, async () => {
  const { prisma, contracts, natsStream, singleCaps } = makeWorld();
  const { createEnrichmentManager } = require('../../enrichment-manager');
  const { createWorkerRuntime } = require('../../workers/sdk/runtime');
  const { makeResultPublisher } = require('../../workers/sdk/result-publisher');

  // Conexão única; manager e worker publicam pelo mesmo js.
  const nc = await natsStream.connectNats({ name: 'b2base-int-e2e' });
  const jsm = await nc.jetstreamManager();
  await natsStream.ensureStream(jsm);
  const js = nc.jetstream();
  const jsAdapter = {
    async publish(subject, data, opts = {}) {
      const hdr = natsStream.headers();
      for (const [k, v] of Object.entries(opts.headers || {})) hdr.set(k, v);
      await js.publish(subject, data, { headers: hdr, timeout: 5000 });
    },
  };

  // Seed: prospect viável (companyName → search.news).
  await prisma.prospect.create({
    data: { id: `p-${Date.now()}`, orgId: 'org-e2e', companyName: 'Marispan Ltda', enrichmentSummary: {}, createdAt: new Date() },
  });
  const prospect = (await prisma.prospect.findMany({ where: { orgId: 'org-e2e' } }))[0];

  const suffix = `${Date.now()}`;
  const manager = createEnrichmentManager({
    prisma,
    js: jsAdapter,
    getOrgPlan: async () => 'trial',
    capabilities: singleCaps,
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  const { job } = await manager.createJob({ orgId: 'org-e2e', prospectId: prospect.id, trigger: 'manual' });

  // Worker: consome a task publicada pelo manager.
  const workerDurable = `it-worker-${suffix}`;
  await natsStream.ensurePullConsumer(jsm, { durable: workerDurable, filterSubject: 'enrichment.task.search.>', ackWaitMs: 10000, maxDeliver: 3 });
  const taskMsg = await fetchOne(js, workerDurable, 'enrichment.task.search.>');
  assert.ok(taskMsg, 'task deveria ser publicada no stream');
  const taskPayload = contracts.parsePayload(taskMsg.data);
  assert.strictEqual(taskPayload.capability, 'search.news');

  const runtime = createWorkerRuntime({
    name: 'search',
    capabilities: singleCaps,
    workerVersion: 'integration',
    deps: {
      prisma,
      js,
      publisher: makeResultPublisher({ js }),
      logger: { info() {}, warn() {}, error() {}, child() { return this; } },
    },
  });
  runtime.registerExecutors({
    'search.news': async () => ({
      status: 'COMPLETED', provider: 'searxng',
      data: { news: [{ title: 'Marispan cresce', url: 'https://news.exemplo' }] },
      facts: [{ attribute: 'company.news', value: ['marispan'], confidence: 0.7,
        evidence: { sourceType: 'searxng', retrievedAt: new Date().toISOString() } }],
    }),
  });
  await runtime.processMessage(taskMsg);

  // Manager: consome o resultado publicado pelo worker e conclui o job.
  const managerDurable = `it-manager-${suffix}`;
  await natsStream.ensurePullConsumer(jsm, { durable: managerDurable, filterSubject: contracts.RESULT_SUBJECT, ackWaitMs: 10000, maxDeliver: 3 });
  const resultMsg = await fetchOne(js, managerDurable, contracts.RESULT_SUBJECT);
  assert.ok(resultMsg, 'resultado deveria ser publicado no stream');
  const resultPayload = contracts.parsePayload(resultMsg.data);
  await resultMsg.ack();
  await manager.handleResult(resultPayload);

  const finalJob = await prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'COMPLETED');
  const updated = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  assert.strictEqual(updated.enrichmentSummary.v2['search.news'].data.news.length, 1);

  await runtime.stop();
  await natsStream.closeAll();
});
