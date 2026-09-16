// =============================================================================
// qualification.js — qualificação DESACOPLADA do enriquecimento (spec US7,
// FR-030/031). Consumidor próprio de enrichment.result.v1 (durable separado
// do manager): recalcula o score do lead a partir dos fatos agregados, com
// debounce por prospect. Falha aqui NÃO afeta workers/tasks de enriquecimento
// — apenas log + métrica. `commercial_potential` do worker Python mantém
// precedência dentro do próprio recalcLeadScore (comportamento existente).
// =============================================================================

const contracts = require('./enrichment-contracts');

function createQualificationConsumer({
  prisma,
  js = null, // JetStream para start()/stop(); handleResult é testável sem ele
  recalcLeadScore, // async (prisma, prospectOrId) — injetável (default: opportunity-score)
  logger = console,
  debounceMs = parseInt(process.env.QUALIFICATION_DEBOUNCE_MS || '2000', 10),
  onMetric = () => {},
  now = () => new Date(),
} = {}) {
  const metrics = {
    total: 'b2base_enrichment_qualification_total',
    failures: 'b2base_enrichment_qualification_failures_total',
  };

  const recalc = recalcLeadScore || ((p, id) => require('./opportunity-score').recalcLeadScore(p, id));

  // Debounce/coalescing por prospect: múltiplos results em janela curta → 1 recálculo.
  const pending = new Map(); // prospectId → timeout
  let running = false;

  async function safeRecalc(orgId, prospectId) {
    pending.delete(prospectId);
    try {
      await recalc(prisma, prospectId);
      onMetric(metrics.total);
    } catch (err) {
      onMetric(metrics.failures);
      logger.error(`[qualification] recálculo falhou para prospect ${prospectId} (org ${orgId}): ${err.message}`);
    }
  }

  function schedule(orgId, prospectId) {
    if (pending.has(prospectId)) clearTimeout(pending.get(prospectId));
    const t = setTimeout(() => safeRecalc(orgId, prospectId), debounceMs);
    if (typeof t.unref === 'function') t.unref();
    pending.set(prospectId, t);
  }

  /** Result event → agenda recálculo (debounce). Falha transiente não pontua. */
  async function handleResult(result) {
    try {
      contracts.validateResultPayload(result);
    } catch (err) {
      logger.warn(`[qualification] result inválido ignorado: ${err.message}`);
      return { ignored: true };
    }
    if (result.status !== 'COMPLETED') return { skipped: true }; // falha/parcial não recalcula
    schedule(result.orgId, result.prospectId);
    return { scheduled: true };
  }

  /** Fim de job → recálculo final imediato (sem debounce). */
  async function handleJobCompleted(event) {
    try {
      contracts.validateJobCompletedPayload(event);
    } catch (err) {
      logger.warn(`[qualification] job.completed inválido ignorado: ${err.message}`);
      return { ignored: true };
    }
    await safeRecalc(event.orgId, event.prospectId);
    return { ok: true };
  }

  async function start() {
    if (!js) throw new Error('qualification: js é obrigatório para start()');
    running = true;
    const natsStream = require('./nats-stream');
    const nc = await natsStream.connectNats({ name: 'b2base-qualification' });
    const jsm = await nc.jetstreamManager();
    await natsStream.ensurePullConsumer(jsm, {
      durable: 'enrichment-qualification',
      filterSubject: contracts.RESULT_SUBJECT,
      ackWaitMs: 30000,
      maxDeliver: 5,
    });
    await natsStream.ensurePullConsumer(jsm, {
      durable: 'enrichment-qualification-jobs',
      filterSubject: contracts.JOB_COMPLETED_SUBJECT,
      ackWaitMs: 30000,
      maxDeliver: 5,
    });
    const stream = natsStream.NATS_STREAM;
    const consumer = js.consumers.get({ stream, durable: 'enrichment-qualification' });
    const jobConsumer = js.consumers.get({ stream, durable: 'enrichment-qualification-jobs' });

    (async function loop() {
      while (running) {
        try {
          const msgs = await consumer.fetch({ max_messages: 20, expires: 4000 });
          for await (const m of msgs) {
            try {
              const result = contracts.parsePayload(m.data);
              await handleResult(result);
              await m.ack();
            } catch (err) {
              logger.error(`[qualification] erro ao processar result: ${err.message}`);
              try { await m.nak(); } catch (_e) { /* ignora */ }
            }
          }
        } catch (err) {
          if (running && !String(err.message).match(/timeout|nothing/i)) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();

    (async function jobLoop() {
      while (running) {
        try {
          const msgs = await jobConsumer.fetch({ max_messages: 10, expires: 4000 });
          for await (const m of msgs) {
            try {
              const evt = contracts.parsePayload(m.data);
              await handleJobCompleted(evt);
              await m.ack();
            } catch (err) {
              logger.error(`[qualification] erro ao processar job.completed: ${err.message}`);
              try { await m.nak(); } catch (_e) { /* ignora */ }
            }
          }
        } catch (err) {
          if (running && !String(err.message).match(/timeout|nothing/i)) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();

    logger.info('[qualification] consumidor de resultados ativo (durable=enrichment-qualification)');
  }

  async function stop() {
    running = false;
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  }

  return { handleResult, handleJobCompleted, start, stop };
}

module.exports = { createQualificationConsumer };
