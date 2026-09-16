// =============================================================================
// enrichment-contracts.js — contratos v1 do motor de enriquecimento distribuído
// (specs/001-distributed-enrichment/contracts/nats-enrichment-engine-v1.md).
//
// Ponto único de: subjects, serialização/validação de payloads, headers de
// correlação e taxonomia de erro. Módulo puro (sem require do nats) para ser
// testável e reutilizável por manager, runtime e qualification.
// =============================================================================

const { randomBytes } = require('crypto');

const VERSION = '1';

const RESULT_SUBJECT = 'enrichment.result.v1';
const JOB_COMPLETED_SUBJECT = 'enrichment.job.completed.v1';
const DLQ_SUBJECT = 'enrichment.task.dlq.v1';

/** `identity.cnpj.resolve` → `enrichment.task.identity.cnpj.resolve.v1` */
function taskSubject(capability) {
  return `enrichment.task.${String(capability).trim()}.v1`;
}

// ── Taxonomia de erro (FR-010) ──────────────────────────────────────────────

const ERROR_TAXONOMY = {
  TRANSIENT: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_CIRCUIT_OPEN', 'INTERNAL'],
  PERMANENT: ['INVALID_INPUT', 'NOT_FOUND', 'UNAUTHORIZED', 'INVALID_DATA', 'CAPABILITY_DISABLED'],
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

// ── Validação de payloads ───────────────────────────────────────────────────

function requireFields(payload, fields, label) {
  const missing = fields.filter((f) => {
    const v = payload[f];
    if (v === undefined || v === null || v === '') return true;
    // Arrays vazios (dependsOn/suggestedTasks) e {} são válidos.
    if (Array.isArray(v) && v.length === 0) return false;
    return false;
  });
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

function validateTaskPayload(p) {
  assertVersion(p, 'task');
  requireFields(p, ['taskId', 'taskKey', 'jobId', 'orgId', 'prospectId', 'entityKey', 'entityType', 'capability'], 'task');
  if (!p.input || typeof p.input !== 'object' || Array.isArray(p.input)) {
    const err = new Error('task: input deve ser objeto');
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  if (!Number.isInteger(p.attempt) || p.attempt < 1) {
    const err = new Error('task: attempt deve ser inteiro >= 1');
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  return p;
}

function validateResultPayload(p) {
  assertVersion(p, 'result');
  requireFields(p, ['taskId', 'taskKey', 'jobId', 'orgId', 'prospectId', 'entityKey', 'entityType', 'capability', 'durationMs', 'workerVersion', 'completedAt'], 'result');
  if (!['COMPLETED', 'FAILED'].includes(p.status)) {
    const err = new Error('result: status deve ser COMPLETED ou FAILED');
    err.code = 'INVALID_CONTRACT';
    throw err;
  }
  return p;
}

function validateJobCompletedPayload(p) {
  assertVersion(p, 'job.completed');
  requireFields(p, ['jobId', 'orgId', 'prospectId', 'status', 'counts', 'completionPct', 'completedAt'], 'job.completed');
  return p;
}

function validateDlqPayload(p) {
  assertVersion(p, 'dlq');
  requireFields(p, ['taskId', 'jobId', 'orgId', 'capability', 'reason', 'attempts'], 'dlq');
  return p;
}

// ── Headers de correlação (FR-036) ──────────────────────────────────────────

function correlationHeaders({ orgId, jobId, taskId, attempt, traceparent }) {
  return {
    'X-Org-Id': String(orgId || ''),
    'X-Job-Id': String(jobId || ''),
    'X-Task-Id': String(taskId || ''),
    'X-Attempt': String(attempt || 1),
    ...(traceparent ? { traceparent } : {}),
  };
}

/** Nats-Msg-Id por tentativa: dedup do JetStream não engole o retry. */
function buildTaskHeaders(task) {
  return {
    'Nats-Msg-Id': `${task.taskId}:${task.attempt}`,
    ...correlationHeaders(task),
  };
}

function buildResultHeaders(result) {
  return {
    'Nats-Msg-Id': `result:${result.taskId}:${result.attempt || 1}`,
    ...correlationHeaders(result),
  };
}

/**
 * Monta a mensagem completa de despacho de task (subject + payload + headers).
 * `traceparent` (W3C) é gerado pelo manager e propagado verbatim (FR-036).
 */
function buildTaskMessage(task) {
  validateTaskPayload(task);
  return {
    subject: taskSubject(task.capability),
    payload: task,
    headers: buildTaskHeaders(task),
  };
}

// ── traceparent W3C ─────────────────────────────────────────────────────────

function makeTraceparent() {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

module.exports = {
  VERSION,
  RESULT_SUBJECT,
  JOB_COMPLETED_SUBJECT,
  DLQ_SUBJECT,
  taskSubject,
  ERROR_TAXONOMY,
  errorClass,
  isTransientError,
  isPermanentError,
  serializePayload,
  parsePayload,
  validateTaskPayload,
  validateResultPayload,
  validateJobCompletedPayload,
  validateDlqPayload,
  correlationHeaders,
  buildTaskHeaders,
  buildResultHeaders,
  buildTaskMessage,
  makeTraceparent,
};
