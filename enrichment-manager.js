// =============================================================================
// enrichment-manager.js — ciclo de vida do job de enriquecimento (spec US1+).
//
// Responsabilidades (único escritor do estado de job/task):
//   1. createJob: cria o job com snapshot do plano e planeja as tasks
//      (entidade × capability elegível) — gating por plano via catálogo.
//   2. publish: despacha tasks QUEUED no barramento (contratos v1, headers de
//      correlação, Nats-Msg-Id por tentativa).
//   3. handleResult: consome enrichment.result.v1 — atualiza task, aplica fatos
//      no Prospect (merge idempotente por capability) e conclui o job
//      (COMPLETED | PARTIAL | FAILED) publicando enrichment.job.completed.v1.
//   4. Retry: falha transiente → task RETRY → re-publicação com attempt+1 e
//      `notBefore` (backoff crescente — FR-010); permanente → FAILED.
//
// Workers NUNCA chamam o manager: toda a comunicação é pelo barramento.
// Todos os métodos recebem deps injetáveis (prisma/js fake nos testes).
// =============================================================================

const { randomUUID } = require('crypto');
const contracts = require('./enrichment-contracts');
const idempotency = require('./workers/sdk/idempotency');
const defaultConfig = require('./enrichment-config');
const defaultCapabilities = require('./enrichment-capabilities');

// Status em que a task ainda pode receber eventos (não-terminal).
const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'RETRY', 'TIMEOUT', 'BLOCKED'];

function nowIso() {
  return new Date().toISOString();
}

/** Input base da task por capability, derivado do prospect (v1: entidade raiz). */
function buildCapabilityInput(capability, prospect) {
  const domain = prospect.domain || null;
  const cnpj = prospect.cnpj || null;
  switch (capability) {
    case 'identity.cnpj.basic':
    case 'company.deepgraph':
      return cnpj ? { cnpj } : null;
    case 'identity.cnpj.resolve':
      return prospect.companyName
        ? { companyName: prospect.companyName, city: prospect.city || undefined, state: prospect.state || undefined }
        : null;
    case 'identity.domain.verify':
    case 'company.logo':
      return domain ? { domain } : null;
    case 'company.profile.deep':
      return prospect.companyName
        ? { companyName: prospect.companyName, domain: domain || undefined }
        : null;
    case 'search.news':
    case 'search.legal':
      return prospect.companyName ? { companyName: prospect.companyName } : null;
    default:
      return null;
  }
}

function createEnrichmentManager(deps = {}) {
  const {
    prisma,
    js = null, // adapter de publicação: publish(subject, dataBuffer, {headers planos})
    getOrgPlan,
    capabilities = defaultCapabilities,
    contracts: c = contracts,
    config = defaultConfig,
    logger = console,
    now = () => new Date(),
    onEvent = () => {}, // gancho de métricas (US8)
  } = deps;

  // ── Publicação ────────────────────────────────────────────────────────────
  async function publishTaskMessage(task, { attempt, notBefore = null } = {}) {
    if (!js) return false;
    const def = capabilities.getCapability(task.capability);
    const message = {
      version: c.VERSION,
      taskId: task.id,
      taskKey: task.taskKey,
      jobId: task.jobId,
      orgId: task.orgId,
      prospectId: task.prospectId,
      entityKey: task.entityKey,
      entityType: task.entityType,
      capability: task.capability,
      provider: task.provider || null,
      input: task.input,
      priority: task.priority,
      attempt,
      maxAttempts: task.maxAttempts,
      timeoutMs: task.timeoutMs,
      depth: task.depth,
      spawnedByTaskId: task.spawnedByTaskId || null,
      notBefore,
      createdAt: nowIso(),
      traceparent: c.makeTraceparent(),
    };
    c.validateTaskPayload(message);
    await js.publish(c.taskSubject(task.capability), c.serializePayload(message), {
      headers: c.buildTaskHeaders({ ...message }),
      timeout: 5000,
    });
    onEvent('task.published', { capability: task.capability, attempt });
    return true;
  }

  /** Publica todas as tasks QUEUED do job (ordem de prioridade — planejamento em lote). */
  async function publishQueuedTasks(jobId) {
    const tasks = await prisma.enrichmentTask.findMany({ where: { jobId, status: 'QUEUED' } });
    tasks.sort((a, b) => a.priority - b.priority || a.capability.localeCompare(b.capability));
    for (const task of tasks) {
      const attempt = task.attempt + 1;
      await publishTaskMessage(task, { attempt });
      await prisma.enrichmentTask.update({ where: { id: task.id }, data: { attempt } });
    }
    return tasks.length;
  }

  // ── Planejamento ──────────────────────────────────────────────────────────
  async function planTasks(job, prospect) {
    const eligible = capabilities.eligibleCapabilities({ plan: job.plan });
    // v1: entidade raiz única (prospect). Entidades derivadas (pessoas,
    // domínios) nascem da expansão dinâmica (US5) via suggestedTasks.
    const entities = [{ entityKey: `prospect:${prospect.id}`, entityType: 'prospect' }];
    const created = [];
    for (const entity of entities) {
      for (const capabilityName of eligible) {
        const def = capabilities.getCapability(capabilityName);
        const input = buildCapabilityInput(capabilityName, prospect);
        // Sem input mínimo viável, a capability não é planejada para este lead
        // (ex.: sem CNPJ → identity.cnpj.basic não nasce).
        if (!input || !def.validateInput(input).ok) continue;
        const taskKey = idempotency.computeTaskKey({
          orgId: job.orgId,
          jobId: job.id,
          entityKey: entity.entityKey,
          capability: capabilityName,
          provider: null,
          input,
        });
        const task = await prisma.enrichmentTask.upsert({
          where: { taskKey },
          create: {
            orgId: job.orgId,
            jobId: job.id,
            prospectId: job.prospectId,
            taskKey,
            entityKey: entity.entityKey,
            entityType: entity.entityType,
            capability: capabilityName,
            provider: null,
            input,
            inputHash: idempotency.hashInput(input),
            status: 'QUEUED',
            priority: def.priority,
            maxAttempts: def.maxAttempts,
            timeoutMs: def.timeoutMs,
            attempt: 0,
            depth: 0,
            dependsOn: [],
          },
          update: {}, // idempotente: replanejar não duplica nem reseta (FR-008)
        });
        created.push(task);
      }
    }
    created.sort((a, b) => a.priority - b.priority || a.capability.localeCompare(b.capability));
    return created;
  }

  // ── Conclusão do job ──────────────────────────────────────────────────────
  async function computeCounts(jobId) {
    const tasks = await prisma.enrichmentTask.findMany({ where: { jobId } });
    const counts = {
      total: tasks.length, completed: 0, failed: 0, cancelled: 0,
      pending: 0, queued: 0, running: 0, retry: 0, timeout: 0, blocked: 0, skipped: 0,
    };
    for (const t of tasks) {
      const key = t.status.toLowerCase();
      if (counts[key] === undefined) counts.pending += 1;
      else counts[key] += 1;
    }
    return { tasks, counts };
  }

  async function maybeFinalizeJob(jobId) {
    const { tasks, counts } = await computeCounts(jobId);
    const active = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status));
    if (active.length > 0) return null;

    const completed = counts.completed;
    const failed = counts.failed;
    let status;
    if (completed > 0 && failed === 0) status = 'COMPLETED';
    else if (completed === 0 && failed > 0) status = 'FAILED';
    else status = 'PARTIAL'; // sucessos + falhas, ou só canceladas/skipped
    const completionPct = counts.total ? Math.round((completed / counts.total) * 1000) / 10 : 0;

    const job = await prisma.enrichmentJob.update({
      where: { id: jobId },
      data: {
        status,
        completedAt: now(),
        lastError: status === 'FAILED' ? { type: 'JOB_FAILED', message: 'todas as tasks falharam' } : null,
      },
    });
    if (js) {
      await js.publish(
        c.JOB_COMPLETED_SUBJECT,
        c.serializePayload({
          version: c.VERSION,
          jobId: job.id,
          orgId: job.orgId,
          prospectId: job.prospectId,
          status,
          counts,
          completionPct,
          completedAt: nowIso(),
        }),
        { headers: { 'X-Org-Id': job.orgId, 'X-Job-Id': job.id }, timeout: 5000 }
      );
    }
    onEvent('job.completed', { capability: '*', status });
    return job;
  }

  // ── Criação do job ────────────────────────────────────────────────────────
  async function createJob({ orgId, prospectId, trigger = 'api' }) {
    const plan = await getOrgPlan(prisma, orgId);
    const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
    if (!prospect || prospect.orgId !== orgId) {
      const err = new Error('prospect não encontrado nesta organização');
      err.code = 'PROSPECT_NOT_FOUND';
      throw err;
    }
    // Gancho de cota (implementado na US3 — default: sem verificação).
    if (typeof assertQuota === 'function') await assertQuota({ orgId, plan });

    const job = await prisma.enrichmentJob.create({
      data: { orgId, prospectId, status: 'PENDING', trigger, plan, engine: 'v2' },
    });
    const tasks = await planTasks(job, prospect);

    if (tasks.length === 0) {
      // Edge case da spec: nada aplicável → concluído-sem-resultados, nunca pendente.
      const emptyJob = await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          startedAt: now(),
          completedAt: now(),
          lastError: { type: 'NO_TASKS', message: 'nenhuma capability elegível com os dados do lead' },
        },
      });
      if (js) {
        await js.publish(
          c.JOB_COMPLETED_SUBJECT,
          c.serializePayload({
            version: c.VERSION, jobId: emptyJob.id, orgId, prospectId,
            status: 'COMPLETED', counts: { total: 0, completed: 0, failed: 0 },
            completionPct: 0, completedAt: nowIso(),
          }),
          { headers: { 'X-Org-Id': orgId, 'X-Job-Id': emptyJob.id }, timeout: 5000 }
        );
      }
      return { job: emptyJob, tasks: [] };
    }

    const runningJob = await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: now() },
    });
    await publishQueuedTasks(job.id);
    return { job: runningJob, tasks };
  }

  // ── Consumo de resultados ─────────────────────────────────────────────────
  async function handleResult(result) {
    try {
      c.validateResultPayload(result);
    } catch (err) {
      logger.warn(`[enrichment-manager] result inválido ignorado: ${err.message}`);
      return { ignored: true };
    }
    const task = await prisma.enrichmentTask.findUnique({ where: { id: result.taskId } });
    // Guardas de integridade: task existente, mesmo org e mesmo job (cross-tenant → ignora).
    if (!task || task.orgId !== result.orgId || task.jobId !== result.jobId || task.taskKey !== result.taskKey) {
      logger.warn(`[enrichment-manager] result sem task correspondente (taskId=${result.taskId} orgId=${result.orgId})`);
      return { ignored: true };
    }
    if (!ACTIVE_STATUSES.includes(task.status)) {
      // Redelivery de result para task já terminal: idempotência — nada a fazer.
      return { duplicate: true };
    }

    if (result.status === 'COMPLETED') {
      await applyCompleted(task, result);
    } else {
      await applyFailure(task, result);
    }
    const finalized = await maybeFinalizeJob(task.jobId);
    return { ok: true, jobFinalized: finalized ? finalized.status : null };
  }

  async function applyCompleted(task, result) {
    await prisma.enrichmentTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        completedAt: now(),
        provider: result.provider || task.provider,
        lastError: null,
      },
    });
    // Merge idempotente no perfil: mesma task já aplicada → não reaplica.
    const prospect = await prisma.prospect.findUnique({ where: { id: task.prospectId } });
    if (!prospect || prospect.orgId !== task.orgId) return;
    const summary = prospect.enrichmentSummary || {};
    const v2 = summary.v2 || {};
    const previous = v2[result.capability];
    if (previous && previous.taskId === result.taskId && previous.status === 'COMPLETED') return;

    v2[result.capability] = {
      entityKey: task.entityKey,
      status: 'COMPLETED',
      provider: result.provider || null,
      taskId: result.taskId,
      attempt: result.attempt || task.attempt,
      data: result.data || {},
      facts: (result.facts || []).map((f) => ({
        attribute: f.attribute,
        value: f.value,
        confidence: f.confidence ?? null,
        sourceType: f.evidence ? f.evidence.sourceType : null,
      })),
      appliedCount: (previous && previous.appliedCount ? previous.appliedCount : 0) + 1,
      updatedAt: nowIso(),
    };
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { enrichmentSummary: { ...summary, v2 } },
    });
    onEvent('task.completed', { capability: result.capability });
  }

  async function applyFailure(task, result) {
    const error = result.error || {};
    const type = error.type || 'INTERNAL';
    const retryable = error.retryable !== undefined
      ? Boolean(error.retryable)
      : c.isTransientError(type);

    if (retryable && task.attempt < task.maxAttempts) {
      const status = type === 'TIMEOUT' ? 'TIMEOUT' : 'RETRY';
      await prisma.enrichmentTask.update({
        where: { id: task.id },
        data: { status, lastError: { type, message: error.message || '', provider: result.provider || null, attempt: task.attempt } },
      });
      // Re-publicação com attempt+1 e notBefore (backoff crescente — FR-010).
      const nextAttempt = task.attempt + 1;
      const delay = config.backoffDelayMs(task.attempt);
      await publishTaskMessage(task, { attempt: nextAttempt, notBefore: new Date(now().getTime() + delay).toISOString() });
      await prisma.enrichmentTask.update({
        where: { id: task.id },
        data: { status: 'QUEUED', attempt: nextAttempt },
      });
      onEvent('task.retry', { capability: task.capability });
      return;
    }

    await prisma.enrichmentTask.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        completedAt: now(),
        lastError: { type, message: error.message || '', provider: result.provider || null, attempt: task.attempt },
      },
    });
    onEvent('task.failed', { capability: task.capability });
  }

  // ── Consultas (endpoints) ─────────────────────────────────────────────────
  async function getJobStatus(jobId, orgId) {
    const job = await prisma.enrichmentJob.findFirst({ where: { id: jobId, orgId } });
    if (!job) return null;
    const { counts } = await computeCounts(jobId);
    const tasks = await prisma.enrichmentTask.findMany({ where: { jobId } });
    const active = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
    const completionPct = counts.total ? Math.round((counts.completed / counts.total) * 1000) / 10 : 0;
    return {
      jobId: job.id,
      status: job.status,
      trigger: job.trigger,
      plan: job.plan,
      counts,
      completionPct,
      activeTasks: active,
      tasks: tasks.map((t) => ({
        taskId: t.id,
        capability: t.capability,
        entityType: t.entityType,
        entityKey: t.entityKey,
        status: t.status,
        attempt: t.attempt,
        provider: t.provider,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        error: t.lastError,
      })),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  async function getProspectFacts(prospectId, orgId) {
    const prospect = await prisma.prospect.findFirst({ where: { id: prospectId, orgId } });
    if (!prospect) return null;
    const v2 = (prospect.enrichmentSummary || {}).v2 || {};
    const entities = new Map();
    for (const [capability, entry] of Object.entries(v2)) {
      if (!entities.has(entry.entityKey)) {
        entities.set(entry.entityKey, { entityKey: entry.entityKey, entityType: entry.entityKey.split(':')[0], capabilities: {} });
      }
      entities.get(entry.entityKey).capabilities[capability] = entry;
    }
    return { prospectId, entities: [...entities.values()] };
  }

  // ── Fachada para o server-prod ────────────────────────────────────────────
  async function dispatchForProspect(prospect, { trigger = 'api' } = {}) {
    const { job } = await createJob({ orgId: prospect.orgId, prospectId: prospect.id, trigger });
    return job.id;
  }

  // Declarado antes do uso em createJob (hoisting de function declaration).
  // eslint-disable-next-line no-unused-vars
  function assertQuota() { /* US3: implementado via deps.assertQuota */ }

  return {
    createJob,
    planTasks,
    publishQueuedTasks,
    handleResult,
    getJobStatus,
    getProspectFacts,
    dispatchForProspect,
  };
}

// ── Singleton para o server-prod (lazy — não conecta no require) ───────────
let _default = null;

/** Adapter de publicação: converte headers planos para MsgHdrs do nats. */
function makeRealJsAdapter() {
  const natsStream = require('./nats-stream');
  return {
    async publish(subject, data, opts = {}) {
      const nc = await natsStream.connectNats({ name: 'b2base-enrichment-manager' });
      const js = nc.jetstream();
      const hdr = natsStream.headers();
      for (const [k, v] of Object.entries(opts.headers || {})) hdr.set(k, v);
      await js.publish(subject, data, { headers: hdr, timeout: opts.timeout || 5000 });
      return { seq: 0 };
    },
  };
}

function getManager({ prisma } = {}) {
  if (!_default) {
    const { getOrgPlan } = require('./plan');
    const { createLogger } = require('./logger');
    _default = createEnrichmentManager({
      prisma,
      js: natsStream_enabled() ? makeRealJsAdapter() : null,
      getOrgPlan,
      logger: createLogger({ component: 'enrichment-manager' }),
    });
  }
  return _default;
}

function natsStream_enabled() {
  try {
    return require('./nats-stream').isNatsEnabled();
  } catch (_e) {
    return false;
  }
}

module.exports = { createEnrichmentManager, getManager, buildCapabilityInput, ACTIVE_STATUSES, randomUUID };
