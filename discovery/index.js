// =============================================================================
// discovery/index.js — ponto de entrada do Discovery Engine (T001/T007).
//
// Monta orchestrator + persistence + publisher NATS. Dois modos de execução:
//   - in-process (API): createJob → setImmediate(runJob)
//   - worker (workers/discovery.js): consome discovery.job.requested.v1
// O consumidor é IDEMPOTENTE (constituição II): runJob ignora job
// running/terminal; persistência deduplica por chaves canônicas (SC-005).
// =============================================================================

const natsStream = require('../nats-stream');
const contracts = require('./contracts');
const { createDiscoveryOrchestrator } = require('./orchestrator');

/**
 * Publisher JetStream com ack explícito: falha de stream NUNCA derruba a
 * execução do job — evento é observabilidade, não caminho crítico.
 */
function makeNatsPublisher(js, { logger = console } = {}) {
  return async function publish(message) {
    try {
      await js.publish(message.subject, contracts.serializePayload(message.payload), {
        headers: message.headers,
        timeout: 5000,
      });
    } catch (err) {
      logger.warn && logger.warn(`[discovery] publish ${message.subject} falhou: ${err.message}`);
    }
  };
}

function createDiscoveryEngine({ prisma, publish = null, registry = null, logger = console, now = () => new Date(), providerMap = null } = {}) {
  const orchestrator = createDiscoveryOrchestrator({ prisma, publish, registry, logger, now, providerMap });
  return {
    orchestrator,
    persistence: orchestrator.persistence,
    createJob: orchestrator.createJob,
    runJob: orchestrator.runJob,
    contracts,
  };
}

/**
 * Worker do job.requested: pull consumer durável de UM subject. Roda o job
 * inteiro em-process (fan-out local). Idempotência: runJob é no-op para job
 * já running/terminal — redelivery ack sem efeito colateral.
 */
async function startJobWorker({ engine, js = null, jsm = null, logger = console, pollExpiresMs = 5000, durable = 'discovery-job-worker' } = {}) {
  if (!js || !jsm) throw new Error('startJobWorker exige js/jsm do JetStream');
  await natsStream.ensureStream(jsm, { subjects: ['enrichment.>', 'discovery.>'] });
  await natsStream.ensurePullConsumer(jsm, {
    durable,
    filterSubject: contracts.JOB_REQUESTED_SUBJECT,
    maxDeliver: 3,
    ackWaitMs: 30000,
  });
  logger.info(`[discovery-worker] aguardando ${contracts.JOB_REQUESTED_SUBJECT}`);

  let stopping = false;
  async function tick() {
    const batch = await js.fetch({ durable, max_messages: 1, expires: pollExpiresMs });
    for await (const msg of batch) {
      try {
        const payload = contracts.parsePayload(msg.data);
        contracts.validateJobRequested(payload);
        logger.info(`[discovery-worker] job ${payload.jobId} (org=${payload.orgId})`);
        await engine.orchestrator.runJob(payload.jobId, payload.orgId);
        msg.ack();
      } catch (err) {
        if (err && (err.code === 'VERSION_MISMATCH' || err.code === 'INVALID_CONTRACT')) {
          logger.error(`[discovery-worker] payload inválido (poison): ${err.message}`);
          msg.term();
          continue;
        }
        // Falha transitória (rede/DB): nak reencolhe; max_deliver protege loop.
        logger.warn(`[discovery-worker] job falhou, reencolhendo: ${err.message}`);
        msg.nak();
      }
    }
  }

  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      if (stopping) break;
      logger.warn(`[discovery-worker] ciclo falhou: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return { stop: () => { stopping = true; } };
}

/** Bootstrap de produção (workers/discovery.js): NATS + Prisma + worker. */
async function bootstrapWorker({ prisma, logger = console } = {}) {
  const nc = await natsStream.connectNats({ name: 'b2base-discovery-worker' });
  const js = nc.jetstream();
  const jsm = nc.jetstreamManager();
  const engine = createDiscoveryEngine({ prisma, publish: makeNatsPublisher(js, { logger }), logger });
  return startJobWorker({ engine, js, jsm, logger });
}

module.exports = { createDiscoveryEngine, makeNatsPublisher, startJobWorker, bootstrapWorker };
