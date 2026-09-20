'use strict';

/**
 * Backfill do hotfix 005 (2026-09-20): avança todo lead parado em "Em
 * Qualificação" cujo enriquecimento JÁ CONCLUIU — heala os cards retidos
 * pelo bug do call site de `statusAfterEnrichment` (status pré-update) e
 * pela ausência de avanço no caminho PDL (lead-enrichment.js).
 *
 * Regras (as mesmas da esteira): premium → "Análise profunda" (deep_analysis)
 * com análise de IA enfileirada; demais planos → "Prontas para contato"
 * (qualified). Leads com enriquecimento pendente NÃO são tocados.
 * Idempotente: quem sai de 'prospect' não é revisitado.
 *
 * Uso:
 *   node scripts/backfill-qualification-advance.js [--dry] [--limit 500] [--concurrency 5]
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

const pipelineTransitions = require('../pipeline-transitions');

/**
 * @param {object} prisma cliente Prisma (ou fake em testes)
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.dry]
 * @param {(orgId: string) => Promise<string>} [opts.planFor] injetável (default: plan.getOrgPlan)
 * @param {(prospect: object) => Promise<void>} [opts.enqueueAnalysis] injetável —
 *   chamada para leads que pousam em deep_analysis (default: runner compartilhado)
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ scanned: number, advanced: number, queued: number }>}
 */
async function backfillQualificationAdvance(prisma, opts = {}) {
  const limit = opts.limit != null ? Number(opts.limit) : 500;
  const dry = Boolean(opts.dry);
  const planFor = opts.planFor || ((orgId) => require('../plan').getOrgPlan(prisma, orgId));
  const log = opts.log || ((msg) => console.log(msg));

  const rows = await prisma.prospect.findMany({
    where: { status: 'prospect' },
    take: limit,
  });

  // Só concluídos: pendente/null seguem devendo para a esteira normal.
  const concluded = rows.filter((r) => r.enrichmentStatus && r.enrichmentStatus !== 'pending');

  let advanced = 0;
  let queued = 0;
  const analysisQueue = [];

  for (const row of concluded) {
    const plan = await planFor(row.orgId);
    const next = pipelineTransitions.statusAfterEnrichment(row, plan);
    if (!next) continue;

    if (!dry) {
      await prisma.prospect.update({
        where: { id: row.id },
        data: {
          status: next,
          ...(next === 'deep_analysis' ? { analysisStatus: 'not_started' } : {}),
        },
      });
    }
    advanced += 1;
    if (next === 'deep_analysis' && !dry) {
      if (typeof opts.enqueueAnalysis === 'function') {
        analysisQueue.push(() => opts.enqueueAnalysis({ ...row, status: next, analysisStatus: 'not_started' }));
      } else {
        analysisQueue.push(async () => {
          const fresh = await prisma.prospect.findUnique({ where: { id: row.id } });
          if (!fresh) return;
          const runner = require('../deep-analysis').getSharedRunner(prisma);
          const enqueued = await runner.enqueue(fresh, { trigger: 'auto' });
          if (enqueued.started) await enqueued.done.catch(() => {});
        });
      }
      queued += 1;
    }
  }

  if (!dry && analysisQueue.length > 0) {
    const concurrency = Math.max(1, Number(opts.concurrency) || 5);
    log(`[backfill-advance] ${analysisQueue.length} análises a enfileirar (concorrência ${concurrency})`);
    let index = 0;
    const worker = async () => {
      while (index < analysisQueue.length) {
        const job = analysisQueue[index++];
        try {
          await job();
        } catch (err) {
          log(`[backfill-advance] análise falhou (seguirá como reexecução manual): ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, analysisQueue.length) }, worker));
  }

  return { scanned: rows.length, advanced, queued };
}

module.exports = { backfillQualificationAdvance };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;
  const concIdx = args.indexOf('--concurrency');
  const concurrency = concIdx !== -1 ? Number(args[concIdx + 1]) : 5;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  backfillQualificationAdvance(prisma, { dry, limit, concurrency })
    .then((summary) => {
      console.log(
        `[backfill-advance] ${dry ? '[dry] ' : ''}escaneados: ${summary.scanned}; ` +
        `avançados: ${summary.advanced}; análises enfileiradas/concluídas: ${summary.queued}`
      );
    })
    .catch((err) => {
      console.error('[backfill-advance] falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
