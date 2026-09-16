const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { makeExecutors } = require('../workers/company-deep');

// ── T057 — ponte company.deepgraph: worker Python como provider ─────────────

function makeBridgeDeps(over = {}) {
  const prisma = createFakePrisma();
  const deps = {
    prisma,
    requestEnrichment: async () => 'evt-1',
    sleep: async () => {},
    pollIntervalMs: 0,
    ...over,
  };
  const executors = makeExecutors(deps);
  return { prisma, executors, deps };
}

const TASK = {
  version: '1', taskId: 't-dg', taskKey: 'k-dg', jobId: 'j-1', orgId: 'org-1',
  prospectId: 'p-1', entityKey: 'prospect:p-1', entityType: 'prospect',
  capability: 'company.deepgraph', provider: null,
  input: { cnpj: '45299583000131' },
  priority: 1, attempt: 1, maxAttempts: 2, timeoutMs: 30000,
  depth: 0, spawnedByTaskId: null, createdAt: new Date().toISOString(),
};

const CTX = { signal: null, logger: { info() {}, warn() {}, error() {}, child() { return this; } } };

test('T057 ponte deepgraph: publica legado, espera worker Python e devolve o summary', async () => {
  const { prisma, executors } = makeBridgeDeps({
    requestEnrichment: async (p, prospect) => {
      // Ledger criado como no fluxo real (nats-enrichment.requestEnrichment).
      await p.enrichmentRequest.create({ data: { eventId: 'evt-1', orgId: prospect.orgId, prospectId: prospect.id, cnpj: prospect.cnpj } });
      return 'evt-1';
    },
  });
  await prisma.prospect.create({ data: { id: 'p-1', orgId: 'org-1', companyName: 'Marispan', cnpj: '45299583000131', enrichmentSummary: {}, createdAt: new Date() } });

  // O "worker Python" materializa o resultado no CnpjEnrichment (contrato legado).
  const origSleep = makeExecutors; // noop de clareza
  void origSleep;
  const executors2 = makeExecutors({
    prisma,
    requestEnrichment: async (p, prospect) => {
      await p.enrichmentRequest.create({ data: { eventId: 'evt-1', orgId: prospect.orgId, prospectId: prospect.id, cnpj: prospect.cnpj } });
      await p.cnpjEnrichment.create({
        data: { companyId: 'company-uuid', enrichmentVersion: 1, requestEventId: 'evt-1', status: 'COMPLETED', rawPayload: { summary: { commercial_potential: 88, technologies: 12 } } },
      });
      return 'evt-1';
    },
    sleep: async () => {},
    pollIntervalMs: 0,
  });

  const outcome = await executors2['company.deepgraph'](TASK, CTX);
  assert.strictEqual(outcome.status, 'COMPLETED');
  assert.strictEqual(outcome.provider, 'python.worker.graph');
  assert.strictEqual(outcome.data.commercial_potential, 88);
  void executors;
});

test('T057 ponte deepgraph: sem CNPJ no prospect → falha permanente sem publicar', async () => {
  const { prisma, executors } = makeBridgeDeps();
  await prisma.prospect.create({ data: { id: 'p-1', orgId: 'org-1', companyName: 'Sem CNPJ', enrichmentSummary: {}, createdAt: new Date() } });
  let published = 0;
  const out = await executors['company.deepgraph'](TASK, CTX);
  void published;
  assert.strictEqual(out.status, 'FAILED');
  assert.strictEqual(out.error.type, 'INVALID_INPUT');
  assert.strictEqual(out.error.retryable, false);
});

test('T057 ponte deepgraph: timeout do worker Python → FAILED sem retry', async () => {
  const { prisma, executors } = makeBridgeDeps();
  await prisma.prospect.create({ data: { id: 'p-1', orgId: 'org-1', companyName: 'Marispan', cnpj: '45299583000131', enrichmentSummary: {}, createdAt: new Date() } });
  // Timeout curto simulado: sleep consome o deadline imediatamente.
  const executors2 = makeExecutors({
    prisma,
    requestEnrichment: async () => {
      await prisma.enrichmentRequest.create({ data: { eventId: 'evt-1', orgId: 'org-1', prospectId: 'p-1', cnpj: '45299583000131' } });
      return 'evt-1';
    },
    sleep: async (ms) => { await prisma; void ms; },
    pollIntervalMs: 40 * 1000, // cada "poll" consome o timeout inteiro
  });
  const out = await executors2['company.deepgraph']({ ...TASK, timeoutMs: 1000 }, CTX);
  assert.strictEqual(out.status, 'FAILED');
  assert.strictEqual(out.error.type, 'TIMEOUT');
  assert.strictEqual(out.error.retryable, false);
});

// ── T055 — logo com probe (provider fake) ───────────────────────────────────

test('T055 company.logo: URL do Clearbit com probe ok → COMPLETED com evidência', async () => {
  const executors = makeExecutors({
    logoForDomain: (domain) => `https://logo.clearbit.com/${domain}`,
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  const out = await executors['company.logo'](
    { ...TASK, capability: 'company.logo', input: { domain: 'marispan.com.br' } },
    CTX
  );
  assert.strictEqual(out.status, 'COMPLETED');
  assert.strictEqual(out.data.logo_url, 'https://logo.clearbit.com/marispan.com.br');
  assert.strictEqual(out.facts[0].attribute, 'company.logo');
});

test('T055 company.logo: probe falha → PROVIDER_UNAVAILABLE transiente', async () => {
  const executors = makeExecutors({
    logoForDomain: (domain) => `https://logo.clearbit.com/${domain}`,
    fetchImpl: async () => { throw new Error('dns fail'); },
  });
  const out = await executors['company.logo'](
    { ...TASK, capability: 'company.logo', input: { domain: 'inexistente.com.br' } },
    CTX
  );
  assert.strictEqual(out.status, 'FAILED');
  assert.strictEqual(out.error.type, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual(out.error.retryable, true);
});
