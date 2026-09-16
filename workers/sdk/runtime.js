// =============================================================================
// workers/sdk/runtime.js — runtime compartilhado dos workers de enrichment
// (spec FR-019). O worker novo contém APENAS executores de capability; toda
// preocupação de infraestrutura vive aqui:
//   parse/validate (contratos v1) → marca RUNNING → execute (timeout/abort)
//   → persist (EnrichmentResult) → publish (enrichment.result.v1) → ack.
//
// Garantias: ack SOMENTE após persist+publish; payload ilegível → poison
// (term); erro permanente → FAILED sem retry; transiente → FAILED retryable
// (o manager re-publica com attempt+1 e notBefore — backoff no nak, US2).
// Stateless: nada de estado em memória entre tasks além do semáforo local.
// =============================================================================

const contracts = require('../../enrichment-contracts');
const defaultConfig = require('../../enrichment-config');

function createWorkerRuntime({
  name,
  filterSubject = null,
  capabilities,
  deps,
  concurrency = defaultConfig.WORKER_CONCURRENCY(),
  fetchBatch = defaultConfig.WORKER_FETCH_BATCH(),
  fetchExpiresMs = defaultConfig.WORKER_FETCH_EXPIRES_MS(),
  drainTimeoutMs = 30000,
  stream = null,
  durable = null,
  workerVersion = process.env.GIT_SHA || 'dev',
  now = () => new Date(),
  publishResultTimeoutMs = 5000,
} = {}) {
  const {
    prisma,
    js = null, // JetStream real (start/stop); processMessage não depende dele
    publisher = null, // async (resultEvent) — injetável; default via makeResultPublisher
    logger: baseLogger = console,
    jsm = null, // jetstream manager para garantir o consumer durável
  } = deps;

  const executors = new Map(); // capability → async (task, ctx) => outcome
  const effectiveFilter = filterSubject || `enrichment.task.${name}.>`;
  const effectiveDurable = durable || `enrichment-engine-${name}`;
  const effectiveStream = stream || require('../../nats-stream').NATS_STREAM;

  let running = false;
  let inFlight = new Set();

  /** Registra executores de capability (usado pelos workers/*.js e testes). */
  function registerExecutors(map) {
    for (const [capability, fn] of Object.entries(map)) executors.set(capability, fn);
  }

  // ── Result events ─────────────────────────────────────────────────────────
  function buildResultEvent(task, { status, data, facts, error, durationMs, suggestedTasks, provider }) {
    return {
      version: contracts.VERSION,
      taskId: task.taskId,
      taskKey: task.taskKey,
      jobId: task.jobId,
      orgId: task.orgId,
      prospectId: task.prospectId,
      entityKey: task.entityKey,
      entityType: task.entityType,
      capability: task.capability,
      provider: provider || task.provider || null,
      attempt: task.attempt,
      status,
      data: data || {},
      facts: facts || [],
      error: error || null,
      durationMs,
      workerVersion,
      suggestedTasks: suggestedTasks || [],
      completedAt: now().toISOString(),
    };
  }

  async function defaultPublish(result) {
    if (!js) throw new Error('runtime sem js e sem publisher injetado');
    const hdr = require('../../nats-stream').headers();
    for (const [k, v] of Object.entries(contracts.buildResultHeaders(result))) hdr.set(k, v);
    await js.publish(contracts.RESULT_SUBJECT, contracts.serializePayload(result), {
      headers: hdr,
      timeout: publishResultTimeoutMs,
    });
  }

  async function publishResult(result) {
    const publish = publisher || defaultPublish;
    await publish(result);
  }

  async function publishFailureAndAck(msg, task, { type, message, retryable, durationMs, provider, persist = true }) {
    const event = buildResultEvent(task, {
      status: 'FAILED',
      error: { type, message: String(message || ''), retryable },
      durationMs,
      provider,
    });
    if (persist) await persistResult(event);
    await publishResult(event);
    await msg.ack();
    return { status: 'FAILED', type };
  }

  async function persistResult(event) {
    await prisma.enrichmentResult.upsert({
      where: { taskId: event.taskId },
      create: {
        orgId: event.orgId,
        taskId: event.taskId,
        jobId: event.jobId,
        prospectId: event.prospectId,
        entityKey: event.entityKey,
        entityType: event.entityType,
        capability: event.capability,
        provider: event.provider,
        status: event.status,
        data: event.data,
        confidence: (event.facts && event.facts[0] && event.facts[0].confidence) || null,
        durationMs: event.durationMs,
        workerVersion: event.workerVersion,
      },
      update: {
        status: event.status,
        data: event.data,
        durationMs: event.durationMs,
        provider: event.provider,
      },
    });
  }

  // ── Núcleo de processamento (unit-testável; msg = {data, ack, nak, term}) ──
  // O semáforo de concorrência vive AQUI (não no loop): qualquer caminho que
  // processe mensagens respeita o limite do processo.
  async function processMessage(msg) {
    await acquireSlot();
    try {
      return await _processMessageInner(msg);
    } finally {
      releaseSlot();
    }
  }

  async function _processMessageInner(msg) {
    let task;
    try {
      task = contracts.parsePayload(msg.data);
    } catch (_e) {
      await msg.term(); // payload ilegível/versão errada = poison
      return { status: 'POISON' };
    }

    let validationError = null;
    try {
      contracts.validateTaskPayload(task);
    } catch (err) {
      validationError = err;
    }
    if (validationError) {
      if (validationError.code === 'VERSION_MISMATCH' || !task.taskId) {
        await msg.term();
        return { status: 'POISON' };
      }
      return publishFailureAndAck(msg, task, {
        type: 'INVALID_INPUT', message: validationError.message, retryable: false, durationMs: 0, persist: false,
      });
    }

    const def = capabilities.getCapability(task.capability);
    const executor = executors.get(task.capability);
    if (!def || !executor) {
      return publishFailureAndAck(msg, task, {
        type: 'INVALID_INPUT',
        message: `capability sem executor neste worker: ${task.capability}`,
        retryable: false,
        durationMs: 0,
        persist: false,
      });
    }
    const inputCheck = def.validateInput(task.input);
    if (!inputCheck.ok) {
      return publishFailureAndAck(msg, task, {
        type: 'INVALID_INPUT', message: inputCheck.message, retryable: false, durationMs: 0, persist: false,
      });
    }

    // Idempotência sob redelivery (FR-008): resultado já persistido → não
    // reexecuta o provider; republisha o estado e ack.
    const existing = await prisma.enrichmentResult.findUnique({ where: { taskId: task.taskId } });
    if (existing && existing.status === 'COMPLETED') {
      await publishResult(buildResultEvent(task, {
        status: 'COMPLETED', data: existing.data || {}, facts: [],
        durationMs: existing.durationMs || 0, provider: existing.provider,
      }));
      await msg.ack();
      return { status: 'DUPLICATE' };
    }

    const log = baseLogger.child ? baseLogger.child({
      orgId: task.orgId, jobId: task.jobId, taskId: task.taskId, capability: task.capability,
    }) : baseLogger;

    // Marca início da execução (observabilidade de RUNNING). Write não-crítico:
    // falha aqui não pode derrubar a execução da task.
    try {
      await prisma.enrichmentTask.upsert({
        where: { id: task.taskId },
        create: {
          id: task.taskId,
          orgId: task.orgId,
          jobId: task.jobId,
          prospectId: task.prospectId,
          taskKey: task.taskKey,
          entityKey: task.entityKey,
          entityType: task.entityType,
          capability: task.capability,
          provider: task.provider || def.providers[0],
          input: task.input,
          inputHash: '',
          status: 'RUNNING',
          attempt: task.attempt,
          maxAttempts: task.maxAttempts,
          timeoutMs: task.timeoutMs,
          startedAt: now(),
        },
        update: { status: 'RUNNING', startedAt: now(), attempt: task.attempt, provider: task.provider || def.providers[0] },
      });
    } catch (err) {
      log.warn(`runtime: falha ao marcar RUNNING da task ${task.taskId}: ${err.message}`);
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), task.timeoutMs);
    try {
      const outcome = await executor(task, {
        signal: controller.signal,
        logger: log,
        deps: runtimeDeps,
      });
      const durationMs = Date.now() - startedAt;
      const status = outcome && outcome.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
      const event = buildResultEvent(task, {
        status,
        data: outcome ? outcome.data : {},
        facts: outcome ? outcome.facts : [],
        error: status === 'FAILED' ? {
          type: (outcome.error && outcome.error.type) || 'INTERNAL',
          message: (outcome.error && outcome.error.message) || '',
          retryable: outcome.error ? outcome.error.retryable !== false : false,
        } : null,
        durationMs,
        suggestedTasks: outcome ? outcome.suggestedTasks : [],
        provider: outcome ? outcome.provider : undefined,
      });
      await persistResult(event); // 1º persist
      await publishResult(event); // 2º publish
      await msg.ack(); // 3º ack — somente após persist+publish (FR-018)
      return { status };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const aborted = controller.signal.aborted;
      const type = aborted ? 'TIMEOUT' : contracts.isTransientError(err.code) ? err.code : 'INTERNAL';
      // Infra-falha ao publicar o result → nak para reentrega da MESMA msg
      // (a persistência é idempotente por taskId — reprocessar é seguro).
      return publishFailureAndAck(msg, task, {
        type,
        message: aborted ? `timeout após ${task.timeoutMs}ms` : (err && err.message) || String(err),
        retryable: true,
        durationMs,
        provider: task.provider,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Deps expostas aos executores (ctx.deps) — o worker injeta as suas.
  const runtimeDeps = { ...(deps.execDeps || {}), prisma };

  // ── Semáforo de concorrência ──────────────────────────────────────────────
  let active = 0;
  const waiters = [];
  async function acquireSlot() {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    active += 1;
  }
  function releaseSlot() {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  // ── Loop de consumo (produção) ────────────────────────────────────────────
  async function start() {
    if (!js) throw new Error(`worker ${name}: js é obrigatório para start()`);
    running = true;
    if (jsm) {
      const natsStream = require('../../nats-stream');
      await natsStream.ensureStream(jsm);
      const def = [...executors.keys()].map((k) => capabilities.getCapability(k)).filter(Boolean);
      const maxTimeout = def.reduce((acc, d) => Math.max(acc, d.timeoutMs), 30000);
      await natsStream.ensurePullConsumer(jsm, {
        stream: effectiveStream,
        durable: effectiveDurable,
        filterSubject: effectiveFilter,
        ackWaitMs: Math.round(maxTimeout * 1.3) + 5000,
        maxDeliver: 10,
      });
    }
    const consumer = js.consumers.get
      ? js.consumers.get({ stream: effectiveStream, durable: effectiveDurable })
      : js.consumers.getPullConsumerFor({ durable: effectiveDurable });
    baseLogger.info(`[worker:${name}] consumindo ${effectiveFilter} (durable=${effectiveDurable})`);

    (async function loop() {
      while (running) {
        try {
          const msgs = await consumer.fetch({ max_messages: fetchBatch, expires: fetchExpiresMs });
          for await (const m of msgs) {
            if (!running) break;
            const p = processMessage(m)
              .catch((err) => baseLogger.error(`[worker:${name}] erro no processamento: ${err.message}`));
            inFlight.add(p);
            p.finally(() => inFlight.delete(p));
          }
        } catch (err) {
          if (running && !(String(err.message).match(/timeout|nothing/i))) {
            baseLogger.error(`[worker:${name}] erro no loop: ${err.message}`);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();
  }

  /** Graceful drain: para o fetch, espera tasks em voo (até drainTimeoutMs). */
  async function stop() {
    running = false;
    const deadline = Date.now() + drainTimeoutMs;
    while (inFlight.size > 0 && Date.now() < deadline) {
      await Promise.race([Promise.all([...inFlight]), new Promise((r) => setTimeout(r, 100))]);
    }
  }

  return {
    start,
    stop,
    processMessage,
    registerExecutors,
    registerExecutorsForTest: registerExecutors,
    get isRunning() {
      return running;
    },
  };
}

module.exports = { createWorkerRuntime };
