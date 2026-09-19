'use strict';

/**
 * Backfill de migração da feature 005 (spec: specs/005-deep-lead-analysis):
 * o estágio "Novas oportunidades" (status 'lead') foi REMOVIDO do pipeline.
 * Todo lead que ainda estiver em 'lead' é movido para 'prospect' ("Em
 * Qualificação"), de onde o enriquecimento pode ser disparado normalmente.
 *
 * Idempotente (FR-003): só toca em prospects com status='lead' — rodar de
 * novo é no-op. Nenhum outro campo é alterado.
 *
 * Uso:
 *   node scripts/backfill-lead-status.js [--dry] [--limit 200]
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

/**
 * Migra leads do estágio removido 'lead' para 'prospect'.
 * @param {object} prisma cliente Prisma (ou fake em testes)
 * @param {{ limit?: number, dry?: boolean }} [opts]
 * @returns {Promise<{ scanned: number, migrated: number }>}
 */
async function backfillLeadStatus(prisma, opts = {}) {
  const limit = opts.limit != null ? Number(opts.limit) : Number(process.env.BACKFILL_LEAD_STATUS_LIMIT) || 1000;
  const dry = Boolean(opts.dry);

  const legacy = await prisma.prospect.findMany({
    where: { status: 'lead' },
    select: { id: true },
    take: limit,
  });

  let migrated = 0;
  for (const { id } of legacy) {
    if (dry) {
      migrated += 1;
      continue;
    }
    await prisma.prospect.update({ where: { id }, data: { status: 'prospect' } });
    migrated += 1;
  }

  return { scanned: legacy.length, migrated };
}

module.exports = { backfillLeadStatus };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  backfillLeadStatus(prisma, { dry, limit })
    .then((summary) => {
      console.log(
        `[backfill-lead-status] ${dry ? '[dry] ' : ''}encontrados: ${summary.scanned}; ` +
        `migrados 'lead' → 'prospect': ${summary.migrated}`
      );
    })
    .catch((err) => {
      console.error('[backfill-lead-status] falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
