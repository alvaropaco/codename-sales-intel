'use strict';

/**
 * Backfill de resolução de CNPJ (feature 005): leads importados de planilha
 * ficaram sem identificador e sem como ser enriquecidos pela esteira oficial.
 * Para cada lead de org premium sem CNPJ, roda o resolveCnpj (que agora tem
 * estágio assistido por IA — cnpj-ai-resolver.js) e, quando resolve, grava o
 * CNPJ e dispara o re-enriquecimento completo por plano.
 *
 * O lead NÃO muda de estágio do pipeline — só ganha o dado e os dados ricos.
 * Idempotente: quem já tem CNPJ não é revisitado.
 *
 * Uso:
 *   node scripts/backfill-resolve-cnpj.js [--dry] [--limit 100] [--concurrency 2]
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

const { getOrgPlan } = require('../plan');

/**
 * @param {object} prisma cliente Prisma (ou fake em testes)
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.dry]
 * @param {(orgId: string) => Promise<string>} [opts.planFor] injetável
 * @param {(lead: object) => Promise<object|null>} [opts.resolve] injetável (default: resolveCnpj)
 * @param {(prospect: object) => Promise<object>} [opts.dispatch] injetável —
 *   re-enriquecimento por plano (default: NATS premium / BrasilAPI)
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ scanned: number, resolved: number }>}
 */
async function backfillResolveCnpj(prisma, opts = {}) {
  const limit = opts.limit != null ? Number(opts.limit) : 100;
  const dry = Boolean(opts.dry);
  const planFor = opts.planFor || ((orgId) => getOrgPlan(prisma, orgId));
  const log = opts.log || ((msg) => console.log(msg));

  const resolve = opts.resolve || ((lead) => require('../lead-enrichment').resolveCnpj(lead));
  const dispatch =
    opts.dispatch ||
    (async (prospect) => {
      const plan = await getOrgPlan(prisma, prospect.orgId);
      if (plan === 'premium' && require('../nats-enrichment').isNatsEnabled()) {
        return require('../nats-enrichment').requestEnrichment(prisma, prospect);
      }
      return require('../cnpj-enrichment').enrichProspectWithCnpj(prisma, prospect);
    });

  // Seleção: orgs premium com lead sem CNPJ (triage por org para não varrer
  // trial — o gating de capacidade de análise é premium).
  const orgs = await prisma.organization.findMany({ where: { plan: 'premium' }, select: { id: true } });
  const premiumIds = orgs.map((o) => o.id);

  const rows = [];
  for (const orgId of premiumIds) {
    if (rows.length >= limit) break;
    const batch = await prisma.prospect.findMany({
      where: { orgId, cnpj: null },
      take: limit - rows.length,
    });
    rows.push(...batch);
  }

  let resolved = 0;
  for (const row of rows) {
    const lead = {
      companyName: row.companyName,
      city: row.city,
      state: row.state,
    };
    const found = await resolve(lead);
    if (!found || !found.cnpj) {
      log(`[backfill-cnpj] sem match: ${row.companyName.slice(0, 50)}`);
      continue;
    }
    if (!dry) {
      await prisma.prospect.update({
        where: { id: row.id },
        data: {
          cnpj: found.cnpj,
          taxIdType: 'br_cnpj',
          enrichmentSource: `cnpj-resolver:${found.source}`,
          enrichmentError: null,
        },
      });
      const fresh = await prisma.prospect.findUnique({ where: { id: row.id } });
      await dispatch(fresh).catch((err) =>
        log(`[backfill-cnpj] re-enriquecimento falhou (${found.cnpj}): ${err.message}`)
      );
    }
    resolved += 1;
    log(
      `[backfill-cnpj] resolvido: ${row.companyName.slice(0, 50)} → ${found.cnpj} ` +
      `(${found.source}, conf ${found.confidence})`
    );
  }

  return { scanned: rows.length, resolved };
}

module.exports = { backfillResolveCnpj };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const num = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? Number(args[i + 1]) : undefined;
  };

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  backfillResolveCnpj(prisma, { dry, limit: num('--limit'), concurrency: num('--concurrency') })
    .then((summary) => {
      console.log(
        `[backfill-cnpj] ${dry ? '[dry] ' : ''}escaneados: ${summary.scanned}; resolvidos: ${summary.resolved}`
      );
    })
    .catch((err) => {
      console.error('[backfill-cnpj] falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
