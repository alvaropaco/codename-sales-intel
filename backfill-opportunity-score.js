/**
 * Backfill do opportunityScore: recalcula o score (0–100) dos leads já
 * enriquecidos pelo fallback BrasilAPI usando o módulo opportunity-score.
 *
 * Só toca em leads que a esteira NATS NÃO pontuou (enrichmentSource ≠
 * 'nats.enrichment') e que estão 'enriched' com cnpjRawData persistido.
 * Leads nunca enriquecidos continuam com o score-semente até passarem pela
 * esteira de enriquecimento.
 *
 * Uso:
 *   node backfill-opportunity-score.js [--dry] [--limit 200] [--org <orgId>]
 */

const fs = require('fs');
const path = require('path');

// Minimal .env loader (idêntico ao server-prod.js; nunca sobrescreve env já setada)
(function loadEnvFile() {
  for (const file of ['.env', '.env.local']) {
    const envPath = path.join(__dirname, file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] == null) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
})();

const { PrismaClient } = require('@prisma/client');
const { computeOpportunityScore } = require('./opportunity-score');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) || Infinity : Infinity;
const orgIdx = args.indexOf('--org');
const orgFilter = orgIdx !== -1 ? args[orgIdx + 1] : null;

const prisma = new PrismaClient();

async function main() {
  const prospects = await prisma.prospect.findMany({
    where: {
      enrichmentStatus: 'enriched',
      enrichmentSource: { not: 'nats.enrichment' },
      ...(orgFilter ? { orgId: orgFilter } : {}),
    },
    select: {
      id: true, cnpj: true, orgId: true, opportunityScore: true,
      companyName: true, tradeName: true,
      city: true, state: true, industry: true, cnpjOpenedAt: true,
      cnpjEmail: true, cnpjPhones: true, cnpjPartners: true,
      enrichmentSummary: true, cnpjRawData: true,
    },
    ...(Number.isFinite(limit) ? { take: limit } : {}),
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Leads elegíveis para recálculo: ${prospects.length}${dry ? ' (dry run)' : ''}`);

  const profiles = new Map();
  let updated = 0;
  let skipped = 0;
  let noRaw = 0;
  const scoreSumBefore = { sum: 0, n: 0 };
  const scoreSumAfter = { sum: 0, n: 0 };

  for (const prospect of prospects) {
    const cnpjData = prospect.cnpjRawData && typeof prospect.cnpjRawData === 'object'
      ? prospect.cnpjRawData
      : null;
    if (!cnpjData) { noRaw += 1; continue; }

    if (!profiles.has(prospect.orgId)) {
      profiles.set(prospect.orgId, await prisma.commercialSettings
        .findUnique({ where: { orgId: prospect.orgId } })
        .catch(() => null));
    }

    const { score } = computeOpportunityScore({
      cnpjData,
      prospect,
      profile: profiles.get(prospect.orgId),
    });

    scoreSumBefore.sum += prospect.opportunityScore || 0;
    scoreSumBefore.n += 1;
    scoreSumAfter.sum += score;
    scoreSumAfter.n += 1;

    if (score === (prospect.opportunityScore || 0)) { skipped += 1; continue; }

    console.log(`  ${prospect.cnpj} ${prospect.opportunityScore ?? '—'} → ${score}`);
    if (!dry) {
      await prisma.prospect.update({ where: { id: prospect.id }, data: { opportunityScore: score } });
    }
    updated += 1;
  }

  const avg = (s) => (s.n ? (s.sum / s.n).toFixed(1) : '—');
  console.log('---');
  console.log(`Atualizados: ${updated} · inalterados: ${skipped} · sem cnpjRawData: ${noRaw}`);
  console.log(`Score médio antes: ${avg(scoreSumBefore)} · depois: ${avg(scoreSumAfter)}`);
}

main()
  .catch((err) => { console.error('Backfill falhou:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
