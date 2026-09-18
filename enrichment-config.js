// =============================================================================
// enrichment-config.js — configuração do motor de enriquecimento distribuído
// (specs/001-distributed-enrichment). Módulo puro: lê env no momento da
// chamada para facilitar testes, sem efeitos colaterais no require.
// =============================================================================

/** Lista de env separada por vírgula → array de strings aparadas. */
function envList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Motor v2 ligado? (default: desligado — rollout gradual, research R11) */
function isEngineV2Enabled() {
  return String(process.env.ENRICHMENT_ENGINE_V2 || 'false') === 'true';
}

/** Allowlist de organizações para o motor v2 (vazio = todas as orgs). */
function engineV2Orgs() {
  return envList('ENRICHMENT_ENGINE_V2_ORGS');
}

function isEnabledForOrg(orgId) {
  if (!isEngineV2Enabled()) return false;
  const allow = engineV2Orgs();
  return allow.length === 0 || allow.includes(String(orgId || ''));
}

// ── Limites do grafo de expansão (research R7) ──────────────────────────────
const MAX_TASKS_PER_JOB = () => envInt('MAX_TASKS_PER_JOB', 200);
const MAX_DEPTH = () => envInt('MAX_DEPTH', 3);

// ── Dado bruto (research R5) ────────────────────────────────────────────────
const RAW_MAX_BYTES = () => envInt('RAW_MAX_BYTES', 262144); // 256 KB
const RAW_STORE_BACKEND = () => String(process.env.RAW_STORE_BACKEND || 'postgres');
const RAW_RETENTION_DAYS = () => envInt('RAW_RETENTION_DAYS', 90);

// ── Retry: espera crescente entre tentativas (ms) + jitter (FR-010) ────────
const RETRY_DELAYS_MS = () => {
  const raw = String(process.env.RETRY_DELAYS_MS || '5000,15000,60000,300000');
  const parsed = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
  return parsed.length ? parsed : [5000, 15000, 60000, 300000];
};
const RETRY_JITTER_MS = () => envInt('RETRY_JITTER_MS', 1000);

/**
 * Espera da tentativa `attempt` (1-based): último degrau repete nas finais.
 * Jitter evita sincronização de retentativas entre tasks (FR-010).
 */
function backoffDelayMs(attempt, { jitter = true, random = Math.random } = {}) {
  const delays = RETRY_DELAYS_MS();
  const base = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];
  if (!jitter) return base;
  return base + Math.floor(random() * RETRY_JITTER_MS());
}

// ── Cota mensal de enriquecimento por organização (FR-031) ─────────────────
const MONTHLY_QUOTA_TRIAL = () => envInt('ENRICHMENT_MONTHLY_QUOTA_TRIAL', 50);
const MONTHLY_QUOTA_PREMIUM = () => envInt('ENRICHMENT_MONTHLY_QUOTA_PREMIUM', 1000);

function monthlyQuota(plan) {
  return plan === 'premium' ? MONTHLY_QUOTA_PREMIUM() : MONTHLY_QUOTA_TRIAL();
}

// ── Runtime dos workers ─────────────────────────────────────────────────────
const WORKER_CONCURRENCY = () => envInt('ENRICHMENT_WORKER_CONCURRENCY', 8);
const WORKER_FETCH_BATCH = () => envInt('ENRICHMENT_WORKER_FETCH_BATCH', 10);
const WORKER_FETCH_EXPIRES_MS = () => envInt('ENRICHMENT_WORKER_FETCH_EXPIRES_MS', 5000);

// ── Recuperação de tasks órfãs (worker morreu entre RUNNING e result, ou
// publish falhou no meio do lote) ────────────────────────────────────────────
// Precisa cobrir o maior backoff de retry (RETRY_DELAYS_MS) + tempo de
// execução, para não roubar task de worker vivo.
const STALE_TASK_MS = () => envInt('ENRICHMENT_STALE_TASK_MS', 10 * 60 * 1000);
const RESYNC_INTERVAL_MS = () => envInt('ENRICHMENT_RESYNC_INTERVAL_MS', 60 * 1000);

module.exports = {
  envList,
  envInt,
  isEngineV2Enabled,
  engineV2Orgs,
  isEnabledForOrg,
  MAX_TASKS_PER_JOB,
  MAX_DEPTH,
  RAW_MAX_BYTES,
  RAW_STORE_BACKEND,
  RAW_RETENTION_DAYS,
  RETRY_DELAYS_MS,
  RETRY_JITTER_MS,
  backoffDelayMs,
  monthlyQuota,
  WORKER_CONCURRENCY,
  WORKER_FETCH_BATCH,
  WORKER_FETCH_EXPIRES_MS,
  STALE_TASK_MS,
  RESYNC_INTERVAL_MS,
};
