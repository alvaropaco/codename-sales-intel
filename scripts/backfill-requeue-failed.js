'use strict';

/**
 * Backfill do backlog de enriquecimento (feature 006, US2/FR-008):
 * re-enfileira tasks FAILED cujo último erro foi TRANSIENTE (timeout, rate
 * limit, circuito aberto, provedor indisponível, rede, interno). Elas voltam
 * como PARKED com agendamento escalonado — o sweeper (enrichment-sweeper.js)
 * drena com taxa limitada por provedor. Falhas reais (não-transientes)
 * permanecem de fora e são reportadas.
 *
 * Idempotente: task re-enfileirada vira PARKED (não FAILED) → 2ª passada não
 * acha. Nenhuma task duplicada (o re-publicar reusa o ciclo vigente).
 *
 * Uso:
 *   node scripts/backfill-requeue-failed.js [--dry] [--limit 500] [--org <orgId>]
 */

const fs = require('fs');
const path = require('path');

// Minimal .env loader (idêntico ao server-prod.js; nunca sobrescreve env já setada)
(function loadEnvFile() {
  for (const file of ['.env', '.env.local']) {
    const envPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] == null) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
})();

const { isTransientError } = require('../enrichment-contracts');

/**
 * @param {object} prisma cliente Prisma (ou fake em testes)
 * @param {object} [opts]
 * @param {number} [opts.limit=500]
 * @param {boolean} [opts.dry]
 * @param {string} [opts.org] restringe a uma organização
 * @param {(task: object, scheduledFor: Date) => Promise<void>} [opts.requeue] injetável
 *   (default: PARKED + retry event; o sweeper real publica depois)
 * @param {number} [opts.staggerStepMs] degrau do escalonamento (default 60s)
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ scanned: number, requeued: number, skippedRealFailures: number }>}
 */
async function backfillRequeueFailed(prisma, opts = {}) {
  const limit = opts.limit != null ? Number(opts.limit) : 500;
  const dry = Boolean(opts.dry);
  const staggerStepMs = opts.staggerStepMs != null ? Number(opts.staggerStepMs) : 60000;
  const log = opts.log || ((msg) => console.log(msg));

  // Requeue injetável (testes) ou default: PARKED + retry event cycle 1 —
  // o sweeper assume a partir daí (mesmo caminho do US1).
  const requeueDefault = async (task, scheduledFor) => {
    const parkCycles = (task.parkCycles || 0) + 1;
    await prisma.enrichmentTask.update({
      where: { id: task.id },
      data: {
        status: 'PARKED',
        parkedAt: new Date(),
        parkCycles,
        nextAttemptAt: scheduledFor,
      },
    });
    await prisma.enrichmentTaskRetryEvent.create({
      data: {
        taskId: task.id,
        orgId: task.orgId,
        cycle: parkCycles,
        errorType: (task.lastError && task.lastError.type) || 'UNKNOWN',
        provider: (task.lastError && task.lastError.provider) || null,
        message: String((task.lastError && task.lastError.message) || '').slice(0, 300),
        scheduledFor,
      },
    });
  };
  const requeue = opts.requeue || requeueDefault;

  const now = new Date();
  const where = { status: 'FAILED' };
  if (opts.org) where.orgId = opts.org;
  const rows = await prisma.enrichmentTask.findMany({ where, take: limit });

  let requeued = 0;
  let skippedRealFailures = 0;
  const queue = [];

  for (const task of rows) {
    const lastError = (task.lastError && typeof task.lastError === 'object') ? task.lastError : {};
    const errorType = lastError.type || 'UNKNOWN';
    if (!isTransientError(errorType)) {
      skippedRealFailures += 1;
      continue;
    }
    const scheduledFor = new Date(now.getTime() + requeued * staggerStepMs);
    queue.push({ task, scheduledFor });
    requeued += 1;
  }

  if (!dry) {
    for (const { task, scheduledFor } of queue) {
      await requeue(task, scheduledFor);
      log(`[backfill-requeue] ${task.id} re-enfileirada (scheduled ${scheduledFor.toISOString()})`);
    }
  }

  return { scanned: rows.length, requeued, skippedRealFailures };
}

module.exports = { backfillRequeueFailed };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;
  const orgIdx = args.indexOf('--org');
  const org = orgIdx !== -1 ? args[orgIdx + 1] : undefined;
  const staggerIdx = args.indexOf('--stagger-step-ms');
  const staggerStepMs = staggerIdx !== -1 ? Number(args[staggerIdx + 1]) : undefined;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  backfillRequeueFailed(prisma, { dry, limit, org, staggerStepMs })
    .then((summary) => {
      console.log(
        `[backfill-requeue] ${dry ? '[dry] ' : ''}escaneadas: ${summary.scanned}; ` +
        `re-enfileiradas: ${summary.requeued}; falhas reais mantidas: ${summary.skippedRealFailures}`
      );
    })
    .catch((err) => {
      console.error('[backfill-requeue] falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
