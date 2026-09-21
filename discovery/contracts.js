// =============================================================================
// discovery/contracts.js — contratos v1 do Discovery Engine
// (specs/006-discovery-engine/contracts + research.md).
//
// Ponto único de: subjects NATS, catálogo de providers/capabilities, defaults
// operacionais (timeout/retry/concurrency), taxonomia de erro, serialização/
// validação de payloads e headers de correlação. Módulo puro (sem I/O) para
// ser testável e reutilizável por API, orchestrator e worker.
// Segredos NUNCA entram nos payloads — só referências (nomes de env).
// =============================================================================

const { randomBytes } = require('crypto');

const VERSION = '1';

// ── Subjects (research.md — versionados, evolução via .v2) ──────────────────
const JOB_REQUESTED_SUBJECT = 'discovery.job.requested.v1';
const PROVIDER_REQUESTED_SUBJECT = 'discovery.provider.requested.v1';
const PROVIDER_COMPLETED_SUBJECT = 'discovery.provider.completed.v1';
const PROVIDER_FAILED_SUBJECT = 'discovery.provider.failed.v1';
const CANDIDATE_UPSERTED_SUBJECT = 'discovery.candidate.upserted.v1';

// ── Taxonomia de capabilities (plan.md) ─────────────────────────────────────
const CAPABILITIES = [
  'corporate.identity',
  'corporate.registration',
  'corporate.classification',
  'corporate.ownership',
  'financial.profile',
  'financial.funding',
  'financial.events',
  'legal.cases',
  'legal.documents',
  'digital.domains',
  'digital.infrastructure',
  'digital.contacts',
  'web.search',
];

// ── Defaults operacionais (research.md) ─────────────────────────────────────
const DEFAULTS = {
  providerTimeoutMs: 20 * 1000, // API providers
  collectorTimeoutMs: 45 * 1000, // coletores (crt.sh, projectdiscovery, http-metadata)
  retries: 2,
  concurrency: 2,
  maxProvidersPerJob: 12,
  maxCandidates: 200,
};

// ── Catálogo de providers (T002) ────────────────────────────────────────────
// `paid` → requer budget/quota; self-hosted/free têm precedência no fallback
// (T040). `secrets` são REFERÊNCIAS (nomes de env) — nunca valores.
const PROVIDER_CATALOG = {
  'cnpj-mcp': { capabilities: ['corporate.identity'], paid: false, kind: 'api', secrets: ['CNPJ_MCP_TOKEN'] },
  searxng: { capabilities: ['web.search'], paid: false, kind: 'api', secrets: [] },
  serper: { capabilities: ['web.search'], paid: true, kind: 'api', secrets: ['SERPER_API_KEY'] },
  brave: { capabilities: ['web.search'], paid: true, kind: 'api', secrets: ['BRAVE_API_KEY'] },
  exa: { capabilities: ['web.search'], paid: true, kind: 'api', secrets: ['EXA_API_KEY'] },
  crtsh: { capabilities: ['digital.domains'], paid: false, kind: 'collector', secrets: [] },
  'dns-rdap': { capabilities: ['digital.infrastructure'], paid: false, kind: 'collector', secrets: [] },
  projectdiscovery: { capabilities: ['digital.domains'], paid: false, kind: 'collector', secrets: ['PROJECTDISCOVERY_API_KEY'] },
  'http-metadata': { capabilities: ['digital.contacts', 'digital.infrastructure'], paid: false, kind: 'collector', secrets: [] },
  jusbrasil: { capabilities: ['legal.cases', 'legal.documents'], paid: true, kind: 'api', secrets: ['JUSBRASIL_TOKEN'] },
  escavador: { capabilities: ['legal.cases', 'legal.documents'], paid: true, kind: 'api', secrets: ['ESCAVADOR_TOKEN'] },
  cvm: { capabilities: ['financial.profile'], paid: false, kind: 'api', secrets: [] },
  funding: { capabilities: ['financial.funding'], paid: true, kind: 'api', secrets: ['FUNDING_API_KEY'] },
  spiderfoot: { capabilities: ['digital.infrastructure'], paid: false, kind: 'collector', secrets: ['SPIDERFOOT_URL'] },
};

/** Defaults resolvidos de um provider (limites do catálogo × overrides do job). */
function providerDefaults(name, overrides = {}) {
  const entry = PROVIDER_CATALOG[name];
  if (!entry) return null;
  const base = entry.kind === 'collector' ? DEFAULTS.collectorTimeoutMs : DEFAULTS.providerTimeoutMs;
  return {
    enabled: true,
    paid: entry.paid,
    capabilities: entry.capabilities,
    timeoutMs: overrides.timeoutMs || base,
    maxRequests: overrides.maxRequests || (entry.paid ? 25 : 100),
    concurrency: overrides.concurrency || DEFAULTS.concurrency,
    retries: overrides.retries != null ? overrides.retries : DEFAULTS.retries,
    dailyBudget: overrides.dailyBudget != null ? overrides.dailyBudget : null, // centavos
    secrets: entry.secrets,
  };
}

/** Catálogo + defaults para um job (snapshot persistido em DiscoveryJob.providerConfig). */
function buildProviderConfig(enabledProviders = [], overrides = {}) {
  const config = {};
  for (const name of Object.keys(PROVIDER_CATALOG)) {
    const enabled = enabledProviders.length === 0 ? true : enabledProviders.includes(name);
    config[name] = { ...providerDefaults(name), enabled };
  }
  for (const [name, patch] of Object.entries(overrides || {})) {
    if (config[name]) config[name] = { ...config[name], ...patch };
  }
  return config;
}

/** Providers habilitados de um snapshot, com precedência self-hosted/free. */
function enabledProviders(providerConfig) {
  return Object.entries(providerConfig || {})
    .filter(([, c]) => c && c.enabled)
    .map(([name]) => name)
    .sort((a, b) => {
      const pa = (PROVIDER_CATALOG[a] || {}).paid ? 1 : 0;
      const pb = (PROVIDER_CATALOG[b] || {}).paid ? 1 : 0;
      return pa - pb || a.localeCompare(b);
    });
}

// ── Taxonomia de erro ───────────────────────────────────────────────────────
// TRANSIENT → retry com backoff; PERMANENT → run falha sem retry (o job segue
// com os demais providers — SC-001). BUDGET_EXHAUSTED é permanente para o run
// e dispara fallback para alternativas configuradas (T042).
const ERROR_TAXONOMY = {
  TRANSIENT: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_CIRCUIT_OPEN', 'INTERNAL'],
  PERMANENT: ['INVALID_INPUT', 'NOT_CONFIGURED', 'UNAUTHORIZED', 'INVALID_DATA', 'NOT_FOUND', 'PROVIDER_DISABLED', 'BUDGET_EXHAUSTED'],
};

function errorClass(type) {
  if (ERROR_TAXONOMY.TRANSIENT.includes(type)) return 'TRANSIENT';
  if (ERROR_TAXONOMY.PERMANENT.includes(type)) return 'PERMANENT';
  return null;
}

const isTransientError = (type) => errorClass(type) === 'TRANSIENT';
const isPermanentError = (type) => errorClass(type) === 'PERMANENT';

// ── Serialização ────────────────────────────────────────────────────────────
function serializePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/** Parse + guarda de versão: contratos quebrados nunca entram silenciosamente. */
function parsePayload(data) {
  const payload = typeof data === 'string' ? JSON.parse(data) : JSON.parse(Buffer.from(data).toString('utf8'));
  if (payload.version !== VERSION) {
    const err = new Error(`payload version incompatível: esperado "${VERSION}", recebido "${payload.version}"`);
    err.code = 'VERSION_MISMATCH';
    throw err;
  }
  return payload;
}

function requireFields(payload, fields, label) {
  const missing = fields.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
  if (missing.length) {
    const err = new Error(`${label}: campos obrigatórios ausentes: ${missing.join(', ')}`);
    err.code = 'INVALID_CONTRACT';
    err.missing = missing;
    throw err;
  }
}

function assertVersion(payload, label) {
  if (payload.version !== VERSION) {
    const err = new Error(`${label}: version incompatível (esperado "${VERSION}")`);
    err.code = 'VERSION_MISMATCH';
    throw err;
  }
}

// ── Validação de payloads ───────────────────────────────────────────────────
function validateJobRequested(p) {
  assertVersion(p, 'job.requested');
  requireFields(p, ['jobId', 'orgId', 'trigger', 'providers', 'requestedAt'], 'job.requested');
  if (!p.criteria && !p.seed) {
    const err = new Error('job.requested: criteria ou seed obrigatório');
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  return p;
}

function validateProviderRequested(p) {
  assertVersion(p, 'provider.requested');
  requireFields(p, ['runId', 'jobId', 'orgId', 'provider', 'capability', 'attempt', 'requestedAt'], 'provider.requested');
  if (!CAPABILITIES.includes(p.capability)) {
    const err = new Error(`provider.requested: capability desconhecida "${p.capability}"`);
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  return p;
}

function validateProviderCompleted(p) {
  assertVersion(p, 'provider.completed');
  requireFields(p, ['runId', 'jobId', 'orgId', 'provider', 'capability', 'durationMs', 'completedAt'], 'provider.completed');
  if (!['COMPLETED', 'PARTIAL'].includes(p.status)) {
    const err = new Error('provider.completed: status deve ser COMPLETED ou PARTIAL');
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  return p;
}

function validateProviderFailed(p) {
  assertVersion(p, 'provider.failed');
  requireFields(p, ['runId', 'jobId', 'orgId', 'provider', 'capability', 'errorCode', 'attempt', 'failedAt'], 'provider.failed');
  return p;
}

function validateCandidateUpserted(p) {
  assertVersion(p, 'candidate.upserted');
  requireFields(p, ['candidateId', 'jobId', 'orgId', 'dedupeKey', 'upsertedAt'], 'candidate.upserted');
  return p;
}

// ── Headers de correlação (padrão enrichment-contracts) ─────────────────────
function correlationHeaders({ orgId, jobId, runId, attempt, traceparent }) {
  return {
    'X-Org-Id': String(orgId || ''),
    'X-Job-Id': String(jobId || ''),
    'X-Run-Id': String(runId || ''),
    'X-Attempt': String(attempt || 1),
    ...(traceparent ? { traceparent } : {}),
  };
}

function buildMessage(subject, payload, { msgId } = {}) {
  return {
    subject,
    payload,
    headers: {
      'Nats-Msg-Id': msgId || `${subject}:${payload.runId || payload.candidateId || payload.jobId}`,
      ...correlationHeaders(payload),
    },
  };
}

const buildJobRequestedMessage = (p) => buildMessage(JOB_REQUESTED_SUBJECT, validateJobRequested(p));
const buildProviderRequestedMessage = (p) =>
  buildMessage(PROVIDER_REQUESTED_SUBJECT, validateProviderRequested(p), { msgId: `${p.runId}:${p.attempt}` });
const buildProviderCompletedMessage = (p) =>
  buildMessage(PROVIDER_COMPLETED_SUBJECT, validateProviderCompleted(p), { msgId: `done:${p.runId}:${p.attempt || 1}` });
const buildProviderFailedMessage = (p) =>
  buildMessage(PROVIDER_FAILED_SUBJECT, validateProviderFailed(p), { msgId: `fail:${p.runId}:${p.attempt}` });
const buildCandidateUpsertedMessage = (p) => buildMessage(CANDIDATE_UPSERTED_SUBJECT, validateCandidateUpserted(p));

function makeTraceparent() {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

module.exports = {
  VERSION,
  JOB_REQUESTED_SUBJECT,
  PROVIDER_REQUESTED_SUBJECT,
  PROVIDER_COMPLETED_SUBJECT,
  PROVIDER_FAILED_SUBJECT,
  CANDIDATE_UPSERTED_SUBJECT,
  CAPABILITIES,
  DEFAULTS,
  PROVIDER_CATALOG,
  providerDefaults,
  buildProviderConfig,
  enabledProviders,
  ERROR_TAXONOMY,
  errorClass,
  isTransientError,
  isPermanentError,
  serializePayload,
  parsePayload,
  validateJobRequested,
  validateProviderRequested,
  validateProviderCompleted,
  validateProviderFailed,
  validateCandidateUpserted,
  buildJobRequestedMessage,
  buildProviderRequestedMessage,
  buildProviderCompletedMessage,
  buildProviderFailedMessage,
  buildCandidateUpsertedMessage,
  makeTraceparent,
};
