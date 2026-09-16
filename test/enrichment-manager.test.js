const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma, createFakeJs } = require('./helpers/fake-prisma');
const contracts = require('../enrichment-contracts');
const capabilities = require('../enrichment-capabilities');
const { createEnrichmentManager } = require('../enrichment-manager');

// ── Deps comuns: prisma fake + bus fake + plano premium ─────────────────────

function makeDeps({ plan = 'premium', caps = capabilities } = {}) {
  const prisma = createFakePrisma();
  const js = createFakeJs();
  const manager = createEnrichmentManager({
    prisma,
    js,
    getOrgPlan: async () => plan,
    capabilities: caps,
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
  });
  return { prisma, js, manager };
}

async function seedProspect(prisma, over = {}) {
  return prisma.prospect.create({
    data: {
      id: 'p-1', orgId: 'org-1', companyName: 'Marispan Ltda',
      cnpj: '45299583000131', domain: 'marispan.com.br',
      enrichmentSummary: {}, createdAt: new Date(), ...over,
    },
  });
}

function decoded(js, subjectIncludes) {
  return js.published
    .filter((m) => m.subject.includes(subjectIncludes))
    .map((m) => contracts.parsePayload(m.data));
}

// ── Planejamento (fan-out) ──────────────────────────────────────────────────

test('US1 planejamento: 1 task por entidade × capability elegível, publicadas em ordem de prioridade', async () => {
  const { prisma, js, manager } = makeDeps();
  const prospect = await seedProspect(prisma);
  const { job, tasks } = await manager.createJob({ orgId: 'org-1', prospectId: prospect.id, trigger: 'manual' });

  // Premium: 3 habilitadas (todas basic; nenhuma premium habilitada ainda).
  assert.strictEqual(tasks.length, 3);
  assert.deepStrictEqual(tasks.map((t) => t.status), ['QUEUED', 'QUEUED', 'QUEUED']);
  assert.strictEqual(job.status, 'RUNNING');

  const taskMsgs = decoded(js, 'enrichment.task.');
  assert.strictEqual(taskMsgs.length, 3);
  // Ordem de publicação segue prioridade (0 primeiro — planejamento em lote).
  assert.deepStrictEqual(taskMsgs.map((t) => t.priority), [...taskMsgs.map((t) => t.priority)].sort((a, b) => a - b));
  // Headers de correlação obrigatórios.
  const msg = js.published.find((m) => m.subject.includes('enrichment.task.'));
  assert.ok(msg.opts.headers['Nats-Msg-Id']);
  assert.strictEqual(msg.opts.headers['X-Org-Id'], 'org-1');
  assert.ok(msg.opts.headers.traceparent);
});

test('US1 planejamento: replanejar o MESMO job não duplica tasks (taskKey determinístico)', async () => {
  const { prisma, js, manager } = await makeDeps();
  const prospect = await seedProspect(prisma);
  const { job } = await manager.createJob({ orgId: 'org-1', prospectId: prospect.id, trigger: 'manual' });
  const before = (await prisma.enrichmentTask.findMany({ where: { jobId: job.id } })).length;
  await manager.planTasks(job, prospect);
  const after = (await prisma.enrichmentTask.findMany({ where: { jobId: job.id } })).length;
  assert.strictEqual(before, after);
  // Nenhuma publicação duplicada: Nats-Msg-Id (taskId:attempt) únicos.
  const msgIds = js.published.map((m) => m.opts.headers['Nats-Msg-Id']);
  assert.strictEqual(new Set(msgIds).size, msgIds.length);
});

test('US1 planejamento: job sem nenhuma task aplicável encerra imediatamente COMPLETED com motivo', async () => {
  const emptyCaps = { eligibleCapabilities: () => [], getCapability: () => null };
  const { prisma, js, manager } = makeDeps({ caps: emptyCaps });
  const prospect = await seedProspect(prisma);
  const { job } = await manager.createJob({ orgId: 'org-1', prospectId: prospect.id, trigger: 'manual' });
  assert.strictEqual(job.status, 'COMPLETED');
  assert.ok(job.lastError && job.lastError.type === 'NO_TASKS');
  assert.strictEqual(js.published.filter((m) => m.subject === contracts.JOB_COMPLETED_SUBJECT).length, 1);
});

// ── Resultados parciais aplicados de forma independente ─────────────────────

async function seedJob(deps) {
  const prospect = await seedProspect(deps.prisma);
  const { job, tasks } = await deps.manager.createJob({ orgId: 'org-1', prospectId: prospect.id, trigger: 'manual' });
  return { prospect, job, tasks };
}

test('US1 resultado COMPLETED: task conclui, fatos aplicados ao perfil, job segue RUNNING', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks.find((t) => t.capability === 'identity.cnpj.basic');

  await deps.manager.handleResult({
    version: '1', taskId: task.id, taskKey: task.taskKey, jobId: job.id,
    orgId: 'org-1', prospectId: job.prospectId, entityKey: task.entityKey, entityType: task.entityType,
    capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj', status: 'COMPLETED',
    data: { cnpj: '45299583000131' },
    facts: [{ attribute: 'company.cnpj', value: '45299583000131', confidence: 0.95,
      evidence: { sourceType: 'brasilapi', retrievedAt: new Date().toISOString() } }],
    error: null, durationMs: 200, workerVersion: 'test', suggestedTasks: [],
    completedAt: new Date().toISOString(),
  });

  const updatedTask = await deps.prisma.enrichmentTask.findUnique({ where: { id: task.id } });
  assert.strictEqual(updatedTask.status, 'COMPLETED');
  const prospect = await deps.prisma.prospect.findUnique({ where: { id: job.prospectId } });
  assert.strictEqual(prospect.enrichmentSummary.v2['identity.cnpj.basic'].data.cnpj, '45299583000131');
  const stillRunning = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(stillRunning.status, 'RUNNING'); // resultados parciais NÃO concluem o job
});

test('US1 resultado duplicado (redelivery) não aplica fatos duas vezes', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  const result = {
    version: '1', taskId: task.id, taskKey: task.taskKey, jobId: job.id,
    orgId: 'org-1', prospectId: job.prospectId, entityKey: task.entityKey, entityType: task.entityType,
    capability: task.capability, provider: null, status: 'COMPLETED', data: { ok: 1 }, facts: [],
    error: null, durationMs: 5, workerVersion: 'test', suggestedTasks: [], completedAt: new Date().toISOString(),
  };
  await deps.manager.handleResult(result);
  await deps.manager.handleResult(result); // redelivery
  const updates = deps.prisma.prospect.rows[0].enrichmentSummary.v2[task.capability].appliedCount;
  assert.strictEqual(updates, 1);
});

// ── Conclusão: COMPLETED / PARTIAL / FAILED com percentuais ─────────────────

function mkResult(job, task, status, extra = {}) {
  return {
    version: '1', taskId: task.id, taskKey: task.taskKey, jobId: job.id,
    orgId: 'org-1', prospectId: job.prospectId, entityKey: task.entityKey, entityType: task.entityType,
    capability: task.capability, provider: null, status,
    data: status === 'COMPLETED' ? { ok: 1 } : null, facts: [],
    error: status === 'COMPLETED' ? null : { type: 'INVALID_INPUT', message: 'x', retryable: false },
    durationMs: 5, workerVersion: 'test', suggestedTasks: [], completedAt: new Date().toISOString(),
    ...extra,
  };
}

test('US1 conclusão: todas COMPLETED → job COMPLETED + evento job.completed.v1', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  for (const t of tasks) await deps.manager.handleResult(mkResult(job, t, 'COMPLETED'));
  const finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'COMPLETED');
  const completedEvents = deps.js.published.filter((m) => m.subject === contracts.JOB_COMPLETED_SUBJECT);
  assert.strictEqual(completedEvents.length, 1);
  const payload = contracts.parsePayload(completedEvents[0].data);
  assert.strictEqual(payload.status, 'COMPLETED');
  assert.strictEqual(payload.counts.completed, 3);
  assert.strictEqual(payload.completionPct, 100);
});

test('US1 conclusão: sucessos + falhas permanentes → job PARTIAL com percentual coerente', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  await deps.manager.handleResult(mkResult(job, tasks[0], 'COMPLETED'));
  await deps.manager.handleResult(mkResult(job, tasks[1], 'FAILED'));
  await deps.manager.handleResult(mkResult(job, tasks[2], 'COMPLETED'));
  const finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'PARTIAL');
  const evt = deps.js.published.find((m) => m.subject === contracts.JOB_COMPLETED_SUBJECT);
  const payload = contracts.parsePayload(evt.data);
  assert.strictEqual(payload.status, 'PARTIAL');
  assert.strictEqual(payload.completionPct, 66.7); // 2/3
});

test('US1 conclusão: todas falhadas → job FAILED', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  for (const t of tasks) await deps.manager.handleResult(mkResult(job, t, 'FAILED'));
  const finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'FAILED');
});

test('US1 segurança: result de outra organização é ignorado (não aplica, não conclui)', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  await deps.manager.handleResult({ ...mkResult(job, tasks[0], 'COMPLETED'), orgId: 'org-OUTRO' });
  const untouched = await deps.prisma.enrichmentTask.findUnique({ where: { id: tasks[0].id } });
  assert.strictEqual(untouched.status, 'QUEUED');
});
