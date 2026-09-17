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

// ════════════════════════════════════════════════════════════════════════════
// US2 — resiliência no manager: retry transiente, esgotamento, TIMEOUT
// ════════════════════════════════════════════════════════════════════════════

test('US2 retry transiente: re-publica attempt+1 com notBefore; task RETRY→QUEUED', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  await deps.manager.handleResult(mkResult(job, task, 'FAILED', {
    error: { type: 'RATE_LIMIT', message: '429', retryable: true },
  }));

  // Re-publicação: mesma capability, attempt=2, Nats-Msg-Id novo (dedup-safe).
  const republished = decoded(deps.js, 'enrichment.task.').filter((m) => m.attempt === 2);
  assert.strictEqual(republished.length, 1);
  assert.strictEqual(republished[0].capability, task.capability);
  assert.ok(republished[0].notBefore, 'notBefore (backoff) deve ir no payload');
  const republishedMsg = deps.js.published.filter((m) => m.subject.includes('enrichment.task.'))[3];
  assert.strictEqual(republishedMsg.opts.headers['Nats-Msg-Id'], `${task.id}:2`);

  const row = await deps.prisma.enrichmentTask.findUnique({ where: { id: task.id } });
  assert.strictEqual(row.attempt, 2);
  assert.strictEqual(row.status, 'QUEUED'); // volta à fila (passou por RETRY)
  assert.strictEqual(row.lastError.type, 'RATE_LIMIT'); // causa retida para auditoria
  const stillRunning = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(stillRunning.status, 'RUNNING'); // retry em voo não conclui o job
});

test('US2 esgotamento: retry com attempt == maxAttempts → FAILED definitivo', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  await deps.prisma.enrichmentTask.update({ where: { id: task.id }, data: { maxAttempts: 1 } });
  await deps.manager.handleResult(mkResult(job, task, 'FAILED', {
    error: { type: 'PROVIDER_UNAVAILABLE', message: 'fora do ar', retryable: true },
  }));
  const row = await deps.prisma.enrichmentTask.findUnique({ where: { id: task.id } });
  assert.strictEqual(row.status, 'FAILED');
  assert.strictEqual(row.attempt, 1);
  const republished = decoded(deps.js, 'enrichment.task.').filter((m) => m.attempt === 2);
  assert.strictEqual(republished.length, 0); // esgotado: nenhuma re-publicação
  let finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'RUNNING'); // demais tasks ainda na fila
  // Concluindo as restantes, o job fecha PARTIAL (1 falha definitiva + 2 sucessos).
  for (const t of tasks.slice(1)) await deps.manager.handleResult(mkResult(job, t, 'COMPLETED'));
  finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(finalJob.status, 'PARTIAL');
});

test('US2 TIMEOUT: volta à fila com causa TIMEOUT registrada', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  await deps.manager.handleResult(mkResult(job, task, 'FAILED', {
    error: { type: 'TIMEOUT', message: 'timeout após 15000ms', retryable: true },
  }));
  const row = await deps.prisma.enrichmentTask.findUnique({ where: { id: task.id } });
  assert.strictEqual(row.status, 'QUEUED');
  assert.strictEqual(row.lastError.type, 'TIMEOUT');
});

test('US2 redelivery de result após retry concluído não reaplica (task terminal)', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  const result = mkResult(job, task, 'COMPLETED');
  await deps.manager.handleResult(result);
  const outcome = await deps.manager.handleResult({ ...result, attempt: 2 });
  assert.strictEqual(outcome.duplicate, true);
  const prospect = await deps.prisma.prospect.findUnique({ where: { id: job.prospectId } });
  assert.strictEqual(prospect.enrichmentSummary.v2[task.capability].appliedCount, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// US3 — multi-tenant: gating por plano, snapshot, cota mensal, cross-tenant
// ════════════════════════════════════════════════════════════════════════════

// Catálogo stub com capability premium HABILITADA para tornar o gating observável.
const okValidator = (schema) => (input) => {
  for (const [field, type] of Object.entries(schema)) {
    if (input && typeof input[field] === type) continue;
    return { ok: false, code: 'INVALID_INPUT', message: `${field} (${type}) obrigatório` };
  }
  return { ok: true };
};
const gatedCaps = {
  eligibleCapabilities: ({ plan = 'trial' } = {}) => (plan === 'premium' ? ['identity.cnpj.basic', 'company.profile.deep'] : ['identity.cnpj.basic']),
  getCapability: (name) => ({
    'identity.cnpj.basic': { capability: name, family: 'identity', tier: 'basic', enabled: true, entityType: ['prospect'], timeoutMs: 5000, maxAttempts: 2, priority: 1, providers: ['x'], inputSchema: { cnpj: 'string' }, validateInput: okValidator({ cnpj: 'string' }), expand: [] },
    'company.profile.deep': { capability: name, family: 'company', tier: 'premium', enabled: true, entityType: ['prospect'], timeoutMs: 5000, maxAttempts: 2, priority: 2, providers: ['x'], inputSchema: { companyName: 'string' }, validateInput: okValidator({ companyName: 'string' }), expand: [] },
  }[name]),
};

test('US3 gating: trial NÃO planeja capability premium; premium sim', async () => {
  const trial = makeDeps({ plan: 'trial', caps: gatedCaps });
  const pro = await seedProspect(trial.prisma);
  const { tasks: trialTasks } = await trial.manager.createJob({ orgId: 'org-1', prospectId: pro.id, trigger: 'manual' });
  assert.deepStrictEqual(trialTasks.map((t) => t.capability), ['identity.cnpj.basic']);

  const premium = makeDeps({ plan: 'premium', caps: gatedCaps });
  const pro2 = await seedProspect(premium.prisma);
  const { tasks: premiumTasks } = await premium.manager.createJob({ orgId: 'org-1', prospectId: pro2.id, trigger: 'manual' });
  assert.ok(premiumTasks.some((t) => t.capability === 'company.profile.deep'));
});

test('US3 snapshot: plano do job é o do momento da criação (mudança depois não altera)', async () => {
  let plan = 'trial';
  const deps = makeDeps({ caps: gatedCaps });
  deps.manager = createEnrichmentManager({
    prisma: deps.prisma, js: deps.js,
    getOrgPlan: async () => plan,
    capabilities: gatedCaps,
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  const pro = await seedProspect(deps.prisma);
  const { job } = await deps.manager.createJob({ orgId: 'org-1', prospectId: pro.id, trigger: 'manual' });
  assert.strictEqual(job.plan, 'trial');
  plan = 'premium'; // org fez upgrade no meio do job
  const still = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(still.plan, 'trial');
});

test('US3 cota: excedente lança ENRICHMENT_QUOTA_EXCEEDED e nenhuma task nasce', async () => {
  const deps = makeDeps({ caps: gatedCaps });
  const assertQuota = async () => {
    const err = new Error('cota mensal atingida');
    err.code = 'ENRICHMENT_QUOTA_EXCEEDED';
    throw err;
  };
  const manager = createEnrichmentManager({
    prisma: deps.prisma, js: deps.js, getOrgPlan: async () => 'trial',
    capabilities: gatedCaps, assertQuota,
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  const pro = await seedProspect(deps.prisma);
  await assert.rejects(
    () => manager.createJob({ orgId: 'org-1', prospectId: pro.id, trigger: 'manual' }),
    (e) => e.code === 'ENRICHMENT_QUOTA_EXCEEDED'
  );
  assert.strictEqual(deps.prisma.enrichmentTask.rows.length, 0);
});

test('US3 cross-tenant: getJobStatus/getProspectFacts de outra org retornam null', async () => {
  const deps = makeDeps();
  const { job } = await seedJob(deps);
  assert.strictEqual(await deps.manager.getJobStatus(job.id, 'org-OUTRO'), null);
  assert.strictEqual(await deps.manager.getProspectFacts(job.prospectId, 'org-OUTRO'), null);
  assert.ok(await deps.manager.getJobStatus(job.id, 'org-1'));
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 12 / T061 — consumidor durável do manager (boot real)
// ════════════════════════════════════════════════════════════════════════════

test('T061 startResultConsumer: consome do barramento, aplica resultado e acka', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];

  // Entrega fake no formato do JetStream (async iterable de 1 mensagem).
  const acked = [];
  const contracts2 = require('../enrichment-contracts');
  const delivery = {
    data: contracts2.serializePayload(mkResult(job, task, 'COMPLETED')),
    ack: async () => acked.push('ack'),
    nak: async () => acked.push('nak'),
    term: async () => acked.push('term'),
  };
  let fetchCalls = 0;
  const fakeConsumer = {
    async fetch() {
      fetchCalls += 1;
      if (fetchCalls === 1) return [delivery];
      return new Promise(() => {}); // loop fica esperando (comportamento do broker)
    },
  };

  await deps.manager.startResultConsumer({ consumer: fakeConsumer });
  // Aguarda o processamento assíncrono do ciclo.
  for (let i = 0; i < 50 && acked.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await deps.manager.stopResultConsumer();

  assert.deepStrictEqual(acked, ['ack']); // ack SOMENTE após aplicar
  const prospect = await deps.prisma.prospect.findUnique({ where: { id: job.prospectId } });
  assert.strictEqual(prospect.enrichmentSummary.v2[task.capability].status, 'COMPLETED');
});

test('T061 payload ilegível no consumer → term (poison), sem quebrar o loop', async () => {
  const deps = makeDeps();
  const acked = [];
  const delivery = {
    data: Buffer.from('não-json'),
    ack: async () => acked.push('ack'),
    nak: async () => acked.push('nak'),
    term: async () => acked.push('term'),
  };
  let fetchCalls = 0;
  const fakeConsumer = {
    async fetch() {
      fetchCalls += 1;
      if (fetchCalls === 1) return [delivery];
      return new Promise(() => {});
    },
  };
  await deps.manager.startResultConsumer({ consumer: fakeConsumer });
  for (let i = 0; i < 50 && acked.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await deps.manager.stopResultConsumer();
  assert.deepStrictEqual(acked, ['term']);
});

test('T061 erro de processamento → nak (reentrega), loop continua vivo', async () => {
  const deps = makeDeps();
  // handleResult que lança: prisma quebrado na hora do processamento.
  const breaking = createEnrichmentManager({
    prisma: deps.prisma,
    js: deps.js,
    getOrgPlan: async () => 'trial',
    capabilities,
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  const acked = [];
  let failFirst = true;
  const delivery = {
    data: require('../enrichment-contracts').serializePayload({
      version: '1', taskId: 'inexistente', taskKey: 'k', jobId: 'j', orgId: 'o', prospectId: 'p',
      entityKey: 'e', entityType: 'prospect', capability: 'c', provider: null, status: 'COMPLETED',
      data: {}, facts: [], error: null, durationMs: 1, workerVersion: 't', suggestedTasks: [],
      completedAt: new Date().toISOString(),
    }),
    ack: async () => acked.push('ack'),
    nak: async () => acked.push('nak'),
    term: async () => acked.push('term'),
  };
  let fetchCalls = 0;
  const fakeConsumer = {
    async fetch() {
      fetchCalls += 1;
      if (fetchCalls === 1) return [delivery];
      return new Promise(() => {});
    },
  };
  // handleResult de result com task inexistente é IGNORADO (não lança) → ack.
  await breaking.startResultConsumer({ consumer: fakeConsumer });
  for (let i = 0; i < 50 && acked.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await breaking.stopResultConsumer();
  assert.deepStrictEqual(acked, ['ack']);
});
