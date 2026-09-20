'use strict';

/**
 * enrichment-sweeper.js — sweeper de tasks PARKED (feature 006,
 * specs/006-enrichment-resilience). Erro transiente NUNCA termina FAILED:
 * o sweeper re-publica tasks parked vencidas pelos subjects atuais, com
 * taxa limitada por provedor (token bucket em Redis) e lock de líder
 * (R2/R3). Park que estoura a janela (`ENRICHMENT_PARK_WINDOW_HOURS`)
 * vira falha real e notifica (FR-006) — sem loop infinito.
 *
 * DI (prisma/republishTask/redis/notifier) — testável sem rede (R2).
 */

const { randomUUID } = require('crypto');

const LEADER_KEY = 'enrichment:sweeper:leader';

function createEnrichmentSweeper({
  prisma,
  republishTask,
  redis,
  notifier = {},
  logger = console,
  now = () => new Date(),
  onMetric = () => {},
  config = {},
} = {}) {
  if (!prisma || !republishTask || !redis) {
    throw new Error('enrichment-sweeper: prisma, republishTask e redis são obrigatórios');
  }

  const parkWindowHours = config.parkWindowHours ?? (Number(process.env.ENRICHMENT_PARK_WINDOW_HOURS) || 72);
  const ratePerMin = config.providerRatePerMin ?? (Number(process.env.ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN) || 6);
  const leaderTtlMs = config.leaderTtlMs ?? 65000;
  const holder = `sweeper:${randomUUID()}`;

  async function acquireLeadership() {
    const ok = await redis.set(LEADER_KEY, holder, 'PX', leaderTtlMs, 'NX');
    return ok === 'OK';
  }
  async function releaseLeadership() {
    const current = await redis.get(LEADER_KEY);
    if (current === holder) await redis.del(LEADER_KEY);
  }

  /** Token bucket por provedor: máx. `ratePerMin` re-publicações por minuto. */
  async function underRate(provider, nowDate) {
    const bucket = Math.floor(nowDate.getTime() / 60000);
    const key = `enrichment:sweeper:rate:${provider}:${bucket}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 120);
    return n <= ratePerMin;
  }

  /**
   * Um ciclo do sweeper: re-publica tasks PARKED vencidas.
   * @returns {{ skipped?: string, scanned: number, republished: number, expired: number, deferred: number }}
   */
  async function runOnce({ limit = Number(process.env.ENRICHMENT_SWEEPER_BATCH) || 100 } = {}) {
    if (!(await acquireLeadership())) {
      return { skipped: 'leader', scanned: 0, republished: 0, expired: 0, deferred: 0 };
    }
    try {
      const nowRaw = now();
      const nowDate = nowRaw instanceof Date ? nowRaw : new Date(nowRaw);
      const windowMs = parkWindowHours * 3600e3;
      const due = await prisma.enrichmentTask.findMany({
        where: { status: 'PARKED', nextAttemptAt: { lte: nowDate } },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      });

      let republished = 0;
      let expired = 0;
      let deferred = 0;

      for (const task of due) {
        const provider = (task.lastError && task.lastError.provider) || 'unknown';
        const parkedForMs = task.parkedAt ? nowDate - new Date(task.parkedAt) : 0;

        // Janela expirada → falha REAL (notificável) — FR-006.
        if (task.parkedAt && parkedForMs > windowMs) {
          await prisma.enrichmentTask.update({
            where: { id: task.id },
            data: {
              status: 'FAILED',
              completedAt: nowDate,
              lastError: {
                type: 'PARK_WINDOW_EXPIRED',
                message: `sem sucesso após ${parkWindowHours}h em PARKED`,
                provider,
                attempt: task.attempt,
              },
            },
          });
          expired += 1;
          onMetric('park_expired', { capability: task.capability });
          if (typeof notifier.notifyParkExpired === 'function') {
            try {
              await notifier.notifyParkExpired({
                taskId: task.id, orgId: task.orgId, capability: task.capability,
                provider, parkedForHours: Math.round(parkedForMs / 3600e3),
              });
            } catch (_e) { /* notificação nunca afeta o sweeper (FR-017) */ }
          }
          continue;
        }

        // Token bucket por provedor (FR-003): sem cota → fica para o próximo ciclo.
        if (!(await underRate(provider, nowDate))) {
          deferred += 1;
          continue;
        }

        try {
          await republishTask(task, { attempt: (task.attempt || 0) + 1 });
          await prisma.enrichmentTask.update({
            where: { id: task.id },
            data: { status: 'QUEUED', attempt: (task.attempt || 0) + 1 },
          });
          await prisma.enrichmentTaskRetryEvent.updateMany({
            where: { taskId: task.id, publishedAt: null },
            data: { publishedAt: nowDate },
          });
          republished += 1;
          onMetric('republished', { provider });
        } catch (err) {
          deferred += 1;
          logger.warn(`[sweeper] falha ao re-publicar task ${task.id}: ${err.message}`);
        }
      }

      return { scanned: due.length, republished, expired, deferred };
    } finally {
      await releaseLeadership();
    }
  }

  /** Loop periódico (server-prod). Retorna stop(). */
  function startLoop({ intervalMs = Number(process.env.ENRICHMENT_SWEEPER_INTERVAL_MS) || 60000 } = {}) {
    let timer = null;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await runOnce();
      } catch (err) {
        logger.error(`[sweeper] ciclo falhou: ${err.message}`);
      } finally {
        running = false;
      }
    };
    timer = setInterval(tick, intervalMs);
    if (timer.unref) timer.unref();
    return () => clearInterval(timer);
  }

  return { runOnce, startLoop, acquireLeadership };
}

module.exports = { createEnrichmentSweeper, LEADER_KEY };
