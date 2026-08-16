// =============================================================================
// enrichment-graph.js
// Leitura read-only do grafo de enriquecimento (schema company_enrichment).
//
// O pipeline de enriquecimento persiste o grafo completo (entidades, fatos,
// relacionamentos e perfil agregado) no PostgreSQL do worker. A view
// `company_enrichment.v_company_graph` denormaliza o perfil mais recente por
// empresa para consumo direto pela API.
//
// Configuração (Coolify / produção):
//   ENRICHMENT_DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/legal_mcp
//
// Sem essa variável o endpoint degrada graciosamente (retorna `available:false`),
// sem quebrar o restante do produto.
// =============================================================================

const { Pool } = require('pg');

let _pool = null;
let _configured = undefined;

function normalizeCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function isConfigured() {
  if (_configured === undefined) {
    _configured = Boolean(process.env.ENRICHMENT_DATABASE_URL);
  }
  return _configured;
}

function pool() {
  if (!isConfigured()) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.ENRICHMENT_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Somente leitura por segurança: a API nunca deve gravar no grafo.
      options: '-c default_transaction_read_only=on',
    });
    _pool.on('error', (err) => {
      console.error('[enrichment-graph] erro no pool read-only:', err.message);
    });
  }
  return _pool;
}

function confidenceLabel(confidence) {
  if (confidence == null) return null;
  if (confidence >= 0.85) return 'alta';
  if (confidence >= 0.65) return 'média';
  return 'baixa';
}

/**
 * Busca o grafo de enriquecimento mais recente de uma empresa pelo CNPJ.
 * Retorna `{ available, data }`. `data` é nulo quando indisponível.
 */
async function fetchCompanyGraph(cnpj) {
  if (!isConfigured()) {
    return { available: false, data: null };
  }
  const digits = normalizeCnpj(cnpj);
  if (digits.length !== 14) {
    return { available: true, data: null, error: 'CNPJ inválido' };
  }
  const client = await pool().connect();
  try {
    const result = await client.query(
      `SELECT
         company_id,
         cnpj,
         enrichment_version,
         status,
         enriched_at,
         profile,
         summary,
         company_entity_id,
         company_label,
         nodes,
         edges,
         facts
       FROM company_enrichment.v_company_graph
       WHERE cnpj = $1
         OR cnpj = $2
       ORDER BY enriched_at DESC NULLS LAST
       LIMIT 1`,
      [digits, cnpj],
    );
    if (result.rows.length === 0) {
      return { available: true, data: null };
    }
    const row = result.rows[0];
    return {
      available: true,
      data: {
        companyId: row.company_id,
        cnpj: row.cnpj,
        enrichmentVersion: row.enrichment_version,
        status: row.status,
        enrichedAt: row.enriched_at,
        profile: row.profile || {},
        summary: row.summary || {},
        companyLabel: row.company_label,
        nodes: row.nodes || [],
        edges: row.edges || [],
        facts: (row.facts || []).map((f) => ({
          ...f,
          confidence_label: confidenceLabel(f.confidence),
        })),
      },
    };
  } finally {
    client.release();
  }
}

async function shutdown() {
  if (_pool) {
    try { await _pool.end(); } catch (_e) { /* ignore */ }
    _pool = null;
  }
}

module.exports = {
  fetchCompanyGraph,
  isConfigured,
  normalizeCnpj,
  shutdown,
};
