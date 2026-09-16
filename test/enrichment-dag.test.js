const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma, createFakeJs } = require('./helpers/fake-prisma');
const contracts = require('../enrichment-contracts');
const capabilities = require('../enrichment-capabilities');
const { createEnrichmentManager } = require('../enrichment-manager');

function makeDeps({ plan = 'premium', caps = capabilities, config, onEvent } = {}) {
  const prisma = createFakePrisma();
  const js = createFakeJs();
  const events = [];
  const manager = createEnrichmentManager({
    prisma,
    js,
    getOrgPlan: async () => plan,
    capabilities: caps,
    config,
    onEvent: onEvent || ((type, data) => events.push({ type, data })),
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
  });
  return { prisma, js, manager, events };
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

async function seedJob(deps) {
  const prospect = await seedProspect(deps.prisma);
  const { job, tasks } = await deps.manager.createJob({ orgId: 'org-1', prospectId: prospect.id, trigger: 'manual' });
  return { prospect, job, tasks };
}

function mkResult(job, task, status, extra = {}) {
  return {
    version: '1', taskId: task.id, taskKey: task.taskKey, jobId: job.id,
    orgId: 'org-1', prospectId: job.prospectId, entityKey: task.entityKey, entityType: task.entityType,
    capability: task.capability, provider: null, status,
    data: status === 'COMPLETED' ? (extra.data || { ok: 1 }) : null,
    facts: extra.facts || [],
    error: status === 'COMPLETED' ? null : { type: 'INVALID_INPUT', message: 'x', retryable: false },
    durationMs: 5, workerVersion: 'test',
    suggestedTasks: extra.suggestedTasks || [],
    completedAt: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => !['data', 'facts', 'suggestedTasks'].includes(k))),
  };
}

const cnpjTaskOf = (tasks) => tasks.find((t) => t.capability === 'identity.cnpj.basic');

// ── Dependências (DAG mínimo) ───────────────────────────────────────────────

test('US5 task BLOCKED com dependsOn não é publicada', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const cnpjTask = cnpjTaskOf(tasks);
  const created = await deps.manager.createTask({
    job,
    capability: 'search.news',
    entityKey: cnpjTask.entityKey,
    entityType: cnpjTask.entityType,
    input: { companyName: 'Marispan Filial Ltda' },
    dependsOn: [cnpjTask.id],
  });
  assert.ok(created.created, `createTask deveria criar: ${JSON.stringify(created).slice(0, 120)}`);
  const dependent = created.task;
  assert.strictEqual(dependent.status, 'BLOCKED');
  const publishedSubjects = deps.js.published.map((m) => m.subject);
  // A task dependente (mesma capability, input próprio) não pode ter sido publicada.
  const dependentPublished = deps.js.published.some((m) => {
    if (!m.subject.includes('search.news')) return false;
    const p = contracts.parsePayload(m.data);
    return p.taskId === dependent.id;
  });
  assert.ok(!dependentPublished);
  assert.ok(publishedSubjects.length > 0); // as demais (QUEUED) foram
});

test('US5 dependências concluídas → desbloqueia, publica e enriquece input com fatos das deps', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const cnpjTask = cnpjTaskOf(tasks);
  const created = await deps.manager.createTask({
    job,
    capability: 'search.news',
    entityKey: cnpjTask.entityKey,
    entityType: cnpjTask.entityType,
    input: { companyName: 'Marispan Filial Ltda' },
    dependsOn: [cnpjTask.id],
  });
  const dependent = created.task;
  await deps.manager.handleResult(mkResult(job, cnpjTask, 'COMPLETED', {
    data: { cnpj: '45299583000131', legal_name: 'MARISPAN LTDA' },
  }));

  const row = await deps.prisma.enrichmentTask.findUnique({ where: { id: dependent.id } });
  assert.strictEqual(row.status, 'QUEUED');
  const published = deps.js.published.find((m) => {
    if (!m.subject.includes('search.news')) return false;
    return contracts.parsePayload(m.data).taskId === dependent.id;
  });
  assert.ok(published, 'dependente desbloqueado deve ser publicado');
  const payload = contracts.parsePayload(published.data);
  assert.strictEqual(payload.input.legal_name, 'MARISPAN LTDA'); // fatos da dep entram no input
  assert.strictEqual(payload.input.companyName, 'Marispan Filial Ltda'); // input original preservado
});

test('US5 dependência falhada permanentemente → dependente CANCELLED com causa', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const cnpjTask = cnpjTaskOf(tasks);
  const created = await deps.manager.createTask({
    job,
    capability: 'search.news',
    entityKey: cnpjTask.entityKey,
    entityType: cnpjTask.entityType,
    input: { companyName: 'Marispan Filial Ltda' },
    dependsOn: [cnpjTask.id],
  });
  const dependent = created.task;
  await deps.manager.handleResult(mkResult(job, cnpjTask, 'FAILED'));

  const row = await deps.prisma.enrichmentTask.findUnique({ where: { id: dependent.id } });
  assert.strictEqual(row.status, 'CANCELLED');
  assert.strictEqual(row.lastError.type, 'DEPENDENCY_FAILED');
  // Job pode concluir: cancelled é terminal.
  for (const t of tasks) {
    if (t.id === cnpjTask.id) continue;
    await deps.manager.handleResult(mkResult(job, t, 'COMPLETED'));
  }
  const finalJob = await deps.prisma.enrichmentJob.findUnique({ where: { id: job.id } });
  assert.ok(['PARTIAL', 'COMPLETED'].includes(finalJob.status));
});

// ── Expansão dinâmica (regras declarativas do catálogo) ─────────────────────

test('US5 expansão: fato company.domain de cnpj.basic gera nova task de domínio', async () => {
  const deps = makeDeps();
  const { job, tasks } = await seedJob(deps);
  const cnpjTask = cnpjTaskOf(tasks);
  await deps.manager.handleResult(mkResult(job, cnpjTask, 'COMPLETED', {
    data: { cnpj: '45299583000131', domain: 'descoberta.com.br' },
    facts: [{ attribute: 'company.domain', value: 'descoberta.com.br', confidence: 0.9,
      evidence: { sourceType: 'brasilapi', retrievedAt: new Date().toISOString() } }],
  }));

  const spawned = await deps.prisma.enrichmentTask.findMany({ where: { jobId: job.id, capability: 'identity.domain.verify' } });
  const spawnedNew = spawned.find((t) => t.input.domain === 'descoberta.com.br');
  assert.ok(spawnedNew, 'nova task de domínio deveria existir');
  assert.strictEqual(spawnedNew.spawnedByTaskId, cnpjTask.id);
  assert.strictEqual(spawnedNew.depth, 1);
  assert.strictEqual(spawnedNew.status, 'QUEUED');
  const published = deps.js.published.find((m) => {
    if (!m.subject.includes('identity.domain.verify')) return false;
    return contracts.parsePayload(m.data).input.domain === 'descoberta.com.br';
  });
  assert.ok(published, 'task expandida deve ser publicada');
});

test('US5 suggestedTasks: válida cria; desconhecida e fora do plano recusam com registro', async () => {
  const deps = makeDeps({ plan: 'trial' });
  const { job, tasks } = await seedJob(deps);
  const task = tasks[0];
  await deps.manager.handleResult(mkResult(job, task, 'COMPLETED', {
    suggestedTasks: [
      { capability: 'search.news', entityType: 'person', entityKey: 'person:sócio-1', input: { companyName: 'Sócio Marispan' } },
      { capability: 'capability.fantasma', entityType: 'prospect', entityKey: task.entityKey, input: {} },
      { capability: 'company.deepgraph', entityType: 'prospect', entityKey: task.entityKey, input: { cnpj: '45299583000131' } }, // premium em trial
    ],
  }));

  const rows = await deps.prisma.enrichmentTask.findMany({ where: { jobId: job.id } });
  const spawned = rows.filter((t) => t.spawnedByTaskId === task.id);
  assert.strictEqual(spawned.length, 1);
  assert.strictEqual(spawned[0].capability, 'search.news');
  assert.strictEqual(spawned[0].entityKey, 'person:sócio-1');
  const refusals = deps.events.filter((e) => e.type === 'task.expansion_refused');
  assert.strictEqual(refusals.length, 2); // desconhecida + premium em trial
});

test('US5 limites: MAX_DEPTH e MAX_TASKS_PER_JOB recusam expansão com registro', async () => {
  const tightConfig = { MAX_DEPTH: () => 0, MAX_TASKS_PER_JOB: () => 3, backoffDelayMs: () => 1000, monthlyQuota: () => 9999 };
  const deps = makeDeps({ plan: 'premium', config: tightConfig });
  const { job, tasks } = await seedJob(deps);
  const cnpjTask = cnpjTaskOf(tasks);
  await deps.manager.handleResult(mkResult(job, cnpjTask, 'COMPLETED', {
    data: { domain: 'descoberta.com.br' },
    facts: [{ attribute: 'company.domain', value: 'descoberta.com.br', confidence: 0.9,
      evidence: { sourceType: 'brasilapi', retrievedAt: new Date().toISOString() } }],
  }));
  // depth do spawn seria 1 > MAX_DEPTH 0 → recusado.
  const spawned = await deps.prisma.enrichmentTask.findMany({ where: { jobId: job.id, capability: 'identity.domain.verify' } });
  assert.ok(!spawned.some((t) => t.input.domain === 'descoberta.com.br'));
  assert.ok(deps.events.some((e) => e.type === 'task.expansion_refused'));
});
