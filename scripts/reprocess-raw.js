#!/usr/bin/env node
// =============================================================================
// scripts/reprocess-raw.js — reprocessamento de dado bruto retido (spec US6,
// FR-028/SC-011): deriva fatos novos de um RawRecord SEM reconsultar o
// provedor externo. O extractor é um parser — evoluí-lo não exige recaptura.
//
// Uso:
//   node scripts/reprocess-raw.js --rawRecordId <cuid> [--extractor ./meu-parser.js]
//
// O extractor (opcional) é um módulo: module.exports = (rawBody, meta) =>
//   ({ data, facts })  — default: JSON.parse do corpo (passthrough).
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const { createRawStore } = require('../raw-store');

/**
 * Reprocessa um RawRecord com o extractor informado e ATUALIZA o
 * EnrichmentResult correspondente (mesma task, rastreabilidade em
 * metadata.reprocessedFrom). Retorna o resumo do que fez.
 */
async function reprocessRaw({ prisma, rawStore, rawRecordId, extractor }) {
  const raw = await rawStore.get(rawRecordId);
  if (!raw) {
    const err = new Error(`RawRecord ${rawRecordId} não encontrado`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const extract = extractor || defaultExtractor;
  const { data, facts = [] } = (await extract(raw.body, {
    capability: raw.capability,
    provider: raw.provider,
    contentType: raw.contentType,
  })) || {};

  const result = await prisma.enrichmentResult.findFirst({
    where: { rawRecordId },
  });
  if (!result) {
    const err = new Error(`Nenhum EnrichmentResult referencia o RawRecord ${rawRecordId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const now = new Date();
  await prisma.enrichmentResult.update({
    where: { id: result.id },
    data: {
      data,
      metadata: { ...(result.metadata || {}), reprocessedFrom: rawRecordId, reprocessedAt: now.toISOString() },
    },
  });
  if (facts.length && prisma.enrichmentEvidence) {
    await prisma.enrichmentEvidence.createMany({
      data: facts.map((f) => ({
        orgId: result.orgId,
        resultId: result.id,
        attribute: f.attribute,
        value: f.value,
        sourceType: (f.evidence && f.evidence.sourceType) || 'reprocess',
        provider: (f.evidence && f.evidence.provider) || raw.provider,
        url: (f.evidence && f.evidence.url) || null,
        retrievedAt: (f.evidence && f.evidence.retrievedAt && new Date(f.evidence.retrievedAt)) || now,
        confidence: (f.evidence && f.evidence.confidence) != null ? f.evidence.confidence : (f.confidence ?? null),
        rawRecordId,
      })),
    });
  }

  return { updated: true, resultId: result.id, rawRecordId, facts: facts.length };
}

/** Extractor default: JSON passthrough (o corpo vira o data do resultado). */
async function defaultExtractor(rawBody) {
  try {
    return { data: JSON.parse(rawBody) };
  } catch (_e) {
    return { data: { raw: String(rawBody) } };
  }
}

module.exports = { reprocessRaw, defaultExtractor };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const rawRecordId = get('rawRecordId');
  if (!rawRecordId) {
    console.error('uso: node scripts/reprocess-raw.js --rawRecordId <cuid> [--extractor ./parser.js]');
    process.exit(1);
  }
  (async () => {
    const prisma = new PrismaClient();
    const rawStore = createRawStore({ prisma });
    let extractor;
    const extractorPath = get('extractor');
    if (extractorPath) extractor = require(require('path').resolve(extractorPath));
    const outcome = await reprocessRaw({ prisma, rawStore, rawRecordId, extractor });
    console.log(JSON.stringify({ ok: true, ...outcome }));
    await prisma.$disconnect();
  })().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  });
}
