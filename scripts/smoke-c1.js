// Smoke C1 (quickstart) — validação ponta a ponta com infra local real:
// org + prospect reais no Postgres local, workers reais consumindo JetStream.
// Uso: source .env antes de rodar; ENRICHMENT_ENGINE_V2 é ligado aqui.
process.env.ENRICHMENT_ENGINE_V2 = 'true';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Org allowlistada (id resolvido após criação e injetado na allowlist).
  const org = await prisma.organization.create({ data: { name: `Smoke Org ${Date.now()}`, plan: 'trial' } });
  process.env.ENRICHMENT_ENGINE_V2_ORGS = org.id;

  const { getManager } = require('../enrichment-manager');
  const manager = getManager({ prisma });

  const prospect = await prisma.prospect.create({
    data: {
      orgId: org.id,
      companyName: 'Nubank',
      cnpj: '18236120000103',
      domain: 'nubank.com.br',
      status: 'lead',
      enrichmentStatus: 'pending',
      enrichmentSummary: {},
    },
  });

  const t0 = Date.now();
  const jobId = await manager.dispatchForProspect(prospect, { trigger: 'api' });
  console.log(`[smoke] job ${jobId} criado (${Date.now() - t0}ms)`);
  // Como no server real (T061): consumidor de resultados do manager.
  manager.startResultConsumer().catch((err) => { console.error('consumer:', err.message); process.exit(1); });

  let firstPartialAt = null;
  let final = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await manager.getJobStatus(jobId, org.id);
    const p = await prisma.prospect.findUnique({ where: { id: prospect.id } });
    const capsApplied = Object.keys((p.enrichmentSummary || {}).v2 || {});
    if (!firstPartialAt && capsApplied.length > 0) {
      firstPartialAt = Date.now() - t0;
      console.log(`[smoke] PRIMEIRO PARCIAL em ${firstPartialAt}ms: ${capsApplied.join(', ')} (SC-001)`);
    }
    if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(status.status)) {
      final = status;
      break;
    }
  }

  if (!final) {
    console.error('[smoke] TIMEOUT: job não concluiu em 90s');
    process.exit(1);
  }
  const summary = {
    status: final.status,
    counts: final.counts,
    completionPct: final.completionPct,
    primeiroParcialMs: firstPartialAt,
    duracaoTotalMs: Date.now() - t0,
    capabilities: (await prisma.enrichmentResult.findMany({ where: { jobId } })).map((r) => `${r.capability}:${r.status}`),
  };
  console.log('[smoke] RESULTADO:', JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
  process.exit(summary.final === 'FAILED' ? 1 : 0);
})().catch((err) => {
  console.error('[smoke] FALHOU:', err.message);
  process.exit(1);
});
