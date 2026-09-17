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

  const jobs = [];
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
        const jobId = await manager.dispatchForProspect(prospect, { trigger: 'api' });
        jobs.push(jobId);
        dispatched += 1;
      } catch (err) {
        failed += 1;
        console.error(`[load] falha no prospect ${i}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  const dispatchMs = Date.now() - started;
  console.log(`[load] ${dispatched} jobs criados em ${dispatchMs}ms — aguardando drenagem...`);

  // Consumidor de resultados (como no server real).
  await manager.startResultConsumer();

  // Aguarda todos os jobs alcançarem estado terminal (timeout 10 min).
  const deadline = Date.now() + 10 * 60 * 1000;
  let terminal = 0;
  let drainedMs = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    terminal = 0;
    for (const jobId of jobs) {
      const job = await prisma.enrichmentJob.findUnique({ where: { id: jobId } });
      if (job && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(job.status)) terminal += 1;
    }
    if (terminal === jobs.length) {
      drainedMs = Date.now() - started;
      break;
    }
    process.stdout.write(`[load] drenados ${terminal}/${jobs.length}…\r`);
  }

  const elapsedMs = Date.now() - started;
  const result = {
    ok: drainedMs != null,
    prospects,
    dispatched,
    failed,
    jobsDrained: terminal,
    dispatchMs,
    drainMs: drainedMs,
    tasksPerSec: drainedMs ? Math.round((terminal * 3 / (drainedMs / 1000)) * 10) / 10 : null,
  };
  console.log('\n' + JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(drainedMs != null ? 0 : 1);
}

main().catch((err) => {
  console.error(`[load] falhou: ${err.message}`);
  process.exit(1);
});
