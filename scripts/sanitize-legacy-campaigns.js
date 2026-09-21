#!/usr/bin/env node
/**
 * scripts/sanitize-legacy-campaigns.js — saneamento idempotente das campanhas
 * IA legadas (feature 007 — FR-008).
 *
 * Identifica campanhas cujos templates foram sintetizados com texto interno
 * (objective/público-alvo ecoados no corpo — ver ai-campaign.js), retém as
 * ativas (PAUSED + needsReview) e sinaliza para revalidação do tenant.
 * NUNCA altera campanhas manuais/[auto] e NUNCA corrige silenciosamente.
 *
 * Execução: `node scripts/sanitize-legacy-campaigns.js`
 * (a rotina também roda automaticamente no boot da API, pós-migração).
 */
const { PrismaClient } = require('@prisma/client');
const aiCampaign = require('../ai-campaign');

async function main() {
  const prisma = new PrismaClient();
  try {
    const stats = await aiCampaign.sanitizeLegacyCampaigns(prisma);
    console.log(
      `[sanitize-legacy] concluído: ${stats.scanned} campanha(s) IA varrida(s), ` +
      `${stats.retained} retida(s) para revalidação do tenant`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sanitize-legacy] falhou:', err.message);
  process.exit(1);
});
