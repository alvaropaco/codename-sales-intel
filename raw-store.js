// =============================================================================
// raw-store.js — retenção do dado bruto separado do normalizado (spec US6,
// FR-027/028). Backend inicial: Postgres (tabela RawRecord) com limite de
// tamanho e flag de truncamento. O backend S3/MinIO entra depois SEM mudar
// consumidores desta interface (research R5 — desvio justificado no plan).
// =============================================================================

function createRawStore({ prisma, config, now = () => new Date() } = {}) {
  if (!prisma) throw new Error('raw-store: prisma é obrigatório');
  const cfg = config || require('./enrichment-config');

  async function put({ orgId, capability, provider, contentType = 'application/json', body }) {
    const backend = cfg.RAW_STORE_BACKEND();
    if (backend !== 'postgres') {
      const err = new Error(`raw-store: backend "${backend}" ainda não implementado (configure RAW_STORE_BACKEND=postgres)`);
      err.code = 'NOT_IMPLEMENTED';
      throw err;
    }
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const sizeBytes = Buffer.byteLength(text, 'utf8');
    const max = cfg.RAW_MAX_BYTES();
    const truncated = sizeBytes > max;
    const row = await prisma.rawRecord.create({
      data: {
        orgId,
        capability,
        provider,
        contentType,
        sizeBytes,
        payload: truncated ? Buffer.from(text, 'utf8').slice(0, max).toString('utf8') : text,
        storageBackend: 'postgres',
        truncated,
      },
    });
    return { rawRecordId: row.id, truncated };
  }

  async function get(rawRecordId) {
    const row = await prisma.rawRecord.findUnique({ where: { id: rawRecordId } });
    if (!row) return null;
    return {
      contentType: row.contentType,
      body: row.payload,
      truncated: row.truncated,
      sizeBytes: row.sizeBytes,
      storageBackend: row.storageBackend,
      capability: row.capability,
      provider: row.provider,
    };
  }

  /** Remove brutos mais antigos que `days` (política de retenção — FR-027). */
  async function prune(days = cfg.RAW_RETENTION_DAYS()) {
    const cutoff = new Date(now().getTime() - days * 24 * 3600 * 1000);
    const result = await prisma.rawRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return result && typeof result.count === 'number' ? result.count : 0;
  }

  return { put, get, prune };
}

module.exports = { createRawStore };
