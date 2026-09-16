#!/usr/bin/env node
// =============================================================================
// scripts/load-enrichment.js — teste de carga do motor distribuído (spec US8,
// quickstart C8). Cria N prospects e dispara enriquecimento pelo manager,
// reportando throughput e pendência. Requer NATS + Postgres reais e workers
// rodando (`pnpm run worker:identity` etc.).
//
// Uso (escala de validação — research R8):
//   ENRICHMENT_ENGINE_V2=true node scripts/load-enrichment.js --prospects 200
// =============================================================================

const { PrismaClient } = require('@prisma/client');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(v) ? v : fallback;
}

async function main() {
  const prospects = arg('prospects', 50);
  const orgId = process.env.LOAD_ORG_ID;
  if (!orgId) {
    console.error('LOAD_ORG_ID é obrigatório (organização allowlistada no motor v2).');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const { getManager } = require('../enrichment-manager');
  const manager = getManager({ prisma });

  const companyNames = ['Marispan', 'Dedini', 'Guararapes', 'Randon', 'Weg', 'Embraer', 'Senai', 'Positivo'];
  console.log(`[load] criando ${prospects} prospects e disparando enriquecimento...`);
  const started = Date.now();
  let dispatched = 0;
  let failed = 0;

  const workers = Array.from({ length: Math.min(10, prospects) }, async (_, slot) => {
    for (let i = slot; i < prospects; i += Math.min(10, prospects)) {
      const companyName = `${companyNames[i % companyNames.length]} ${String(i).padStart(5, '0')} LTDA`;
      try {
        const prospect = await prisma.prospect.create({
          data: {
            orgId,
            companyName,
            status: 'lead',
            enrichmentStatus: 'pending',
            enrichmentSummary: {},
          },
        });
        await manager.dispatchForProspect(prospect, { trigger: 'api' });
        dispatched += 1;
      } catch (err) {
        failed += 1;
        console.error(`[load] falha no prospect ${i}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  const elapsedMs = Date.now() - started;
  console.log(JSON.stringify({
    ok: true,
    prospects,
    dispatched,
    failed,
    elapsedMs,
    dispatchPerSec: Math.round((dispatched / Math.max(elapsedMs, 1)) * 1000),
  }, null, 2));
  console.log('[load] acompanhe a drenagem da fila em: b2base_enrichment_tasks_pending (porta 9090)');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(`[load] falhou: ${err.message}`);
  process.exit(1);
});
