const test = require('node:test');
const assert = require('node:assert');
const contracts = require('../enrichment-contracts');

// ── Subjects ────────────────────────────────────────────────────────────────

test('taskSubject: capability com pontos vira tokens do subject', () => {
  assert.strictEqual(
    contracts.taskSubject('identity.cnpj.resolve'),
    'enrichment.task.identity.cnpj.resolve.v1'
  );
});

test('subjects do motor fixos e versionados', () => {
  assert.strictEqual(contracts.RESULT_SUBJECT, 'enrichment.result.v1');
  assert.strictEqual(contracts.JOB_COMPLETED_SUBJECT, 'enrichment.job.completed.v1');
  assert.strictEqual(contracts.DLQ_SUBJECT, 'enrichment.task.dlq.v1');
});

// ── Payload de task ─────────────────────────────────────────────────────────

const TASK = {
  version: '1',
  taskId: 't-1',
  taskKey: 'key-1',
  jobId: 'job-1',
  orgId: 'org-1',
  prospectId: 'p-1',
  entityKey: 'prospect:p-1',
  entityType: 'prospect',
  capability: 'identity.domain.verify',
  provider: null,
  input: { domain: 'exemplo.com.br' },
  priority: 2,
  attempt: 1,
  maxAttempts: 3,
  timeoutMs: 15000,
  depth: 0,
  spawnedByTaskId: null,
  createdAt: '2026-09-16T12:00:00.000Z',
};

test('buildTaskMessage: headers obrigatórios e Nats-Msg-Id por tentativa', () => {
  const msg = contracts.buildTaskMessage({ ...TASK, traceparent: '00-abc-def-01' });
  assert.strictEqual(msg.subject, 'enrichment.task.identity.domain.verify.v1');
  assert.strictEqual(msg.headers['Nats-Msg-Id'], 't-1:1');
  assert.strictEqual(msg.headers['X-Org-Id'], 'org-1');
  assert.strictEqual(msg.headers['X-Job-Id'], 'job-1');
  assert.strictEqual(msg.headers['X-Task-Id'], 't-1');
  assert.strictEqual(msg.headers['X-Attempt'], '1');
  assert.strictEqual(msg.headers.traceparent, '00-abc-def-01');
});

test('buildTaskMessage: retry usa attempt no Nats-Msg-Id (dedup por tentativa)', () => {
  const msg = contracts.buildTaskMessage({ ...TASK, attempt: 2 });
  assert.strictEqual(msg.headers['Nats-Msg-Id'], 't-1:2');
});

test('payload de task: serializa/parseia e valida', () => {
  const buf = contracts.serializePayload(TASK);
  const parsed = contracts.parsePayload(buf);
  assert.strictEqual(parsed.capability, 'identity.domain.verify');
  assert.doesNotThrow(() => contracts.validateTaskPayload(parsed));
});

test('payload de task: rejeita version diferente de 1', () => {
  assert.throws(() => contracts.parsePayload(contracts.serializePayload({ ...TASK, version: '2' })), /version/);
  assert.throws(() => contracts.validateTaskPayload({ ...TASK, version: '9' }), /version/);
});

test('payload de task: rejeita campos obrigatórios ausentes', () => {
  for (const field of ['taskId', 'orgId', 'jobId', 'capability', 'entityKey', 'prospectId']) {
    const broken = { ...TASK };
    delete broken[field];
    assert.throws(() => contracts.validateTaskPayload(broken), new RegExp(field));
  }
  assert.throws(() => contracts.validateTaskPayload({ ...TASK, attempt: 0 }), /attempt/);
  assert.throws(() => contracts.validateTaskPayload({ ...TASK, input: 'não-objeto' }), /input/);
});

// ── Payload de resultado ────────────────────────────────────────────────────

const RESULT = {
  version: '1',
  taskId: 't-1',
  taskKey: 'key-1',
  jobId: 'job-1',
  orgId: 'org-1',
  prospectId: 'p-1',
  entityKey: 'prospect:p-1',
  entityType: 'prospect',
  capability: 'identity.domain.verify',
  provider: 'dns.direct',
  status: 'COMPLETED',
  data: { domain_active: true },
  facts: [
    { attribute: 'company.domain_active', value: true, confidence: 0.9,
      evidence: { sourceType: 'dns', retrievedAt: '2026-09-16T12:00:01.000Z' } },
  ],
  error: null,
  durationMs: 120,
  workerVersion: 'test',
  suggestedTasks: [],
  completedAt: '2026-09-16T12:00:01.000Z',
};

test('payload de resultado: valida e header Nats-Msg-Id por tentativa', () => {
  const headers = contracts.buildResultHeaders({ ...RESULT, attempt: 3 });
  assert.strictEqual(headers['Nats-Msg-Id'], 'result:t-1:3');
  assert.doesNotThrow(() => contracts.validateResultPayload(RESULT));
  assert.throws(() => contracts.validateResultPayload({ ...RESULT, status: 'MAYBE' }), /status/);
  assert.throws(() => contracts.validateResultPayload({ ...RESULT, version: '2' }), /version/);
});

// ── Job completed + DLQ ─────────────────────────────────────────────────────

test('payload de job.completed valida', () => {
  assert.doesNotThrow(() => contracts.validateJobCompletedPayload({
    version: '1', jobId: 'j', orgId: 'o', prospectId: 'p',
    status: 'PARTIAL', counts: { total: 2, completed: 1, failed: 1 },
    completionPct: 50, completedAt: '2026-09-16T12:00:00.000Z',
  }));
  assert.throws(() => contracts.validateJobCompletedPayload({ version: '1', jobId: 'j' }), /obrigat/);
});

test('payload de DLQ valida', () => {
  assert.doesNotThrow(() => contracts.validateDlqPayload({
    version: '1', taskId: 't', jobId: 'j', orgId: 'o', capability: 'x',
    reason: 'POISON_MESSAGE', lastError: { type: 'INVALID_INPUT', message: 'x' }, attempts: 3,
  }));
  assert.throws(() => contracts.validateDlqPayload({ version: '1' }), /obrigat/);
});

// ── Taxonomia de erro (FR-010) ──────────────────────────────────────────────

test('taxonomia: transientes e permanentes classificados', () => {
  for (const t of ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_CIRCUIT_OPEN', 'INTERNAL']) {
    assert.strictEqual(contracts.errorClass(t), 'TRANSIENT', t);
    assert.ok(contracts.isTransientError(t));
  }
  for (const t of ['INVALID_INPUT', 'NOT_FOUND', 'UNAUTHORIZED', 'INVALID_DATA', 'CAPABILITY_DISABLED']) {
    assert.strictEqual(contracts.errorClass(t), 'PERMANENT', t);
    assert.ok(contracts.isPermanentError(t));
  }
  assert.strictEqual(contracts.errorClass('QUALQUER_COISA'), null);
  assert.ok(!contracts.isTransientError('INVALID_INPUT'));
});

// ── traceparent W3C ─────────────────────────────────────────────────────────

test('makeTraceparent: formato W3C válido e único', () => {
  const tp = contracts.makeTraceparent();
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.notStrictEqual(tp, contracts.makeTraceparent());
});
