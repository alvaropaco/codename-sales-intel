const test = require('node:test');
const assert = require('node:assert');
const contracts = require('../discovery/contracts');

// ── Subjects ────────────────────────────────────────────────────────────────

test('subjects discovery.*.v1 fixos e versionados (research.md)', () => {
  assert.strictEqual(contracts.JOB_REQUESTED_SUBJECT, 'discovery.job.requested.v1');
  assert.strictEqual(contracts.PROVIDER_REQUESTED_SUBJECT, 'discovery.provider.requested.v1');
  assert.strictEqual(contracts.PROVIDER_COMPLETED_SUBJECT, 'discovery.provider.completed.v1');
  assert.strictEqual(contracts.PROVIDER_FAILED_SUBJECT, 'discovery.provider.failed.v1');
  assert.strictEqual(contracts.CANDIDATE_UPSERTED_SUBJECT, 'discovery.candidate.upserted.v1');
});

// ── Catálogo e defaults (T002) ──────────────────────────────────────────────

test('catálogo: paid vs self-hosted e segredos só como REFERÊNCIA de env', () => {
  assert.strictEqual(contracts.PROVIDER_CATALOG.searxng.paid, false);
  assert.strictEqual(contracts.PROVIDER_CATALOG.serper.paid, true);
  assert.deepStrictEqual(contracts.PROVIDER_CATALOG.serper.secrets, ['SERPER_API_KEY']);
  // Segredo é nome de env, nunca valor.
  for (const [name, entry] of Object.entries(contracts.PROVIDER_CATALOG)) {
    for (const secret of entry.secrets) {
      assert.match(secret, /^[A-Z0-9_]+$/, `${name}: segredo deve ser referência de env`);
    }
  }
});

test('providerDefaults: collector tem timeout maior; overrides vencem', () => {
  const api = contracts.providerDefaults('cnpj-mcp');
  const collector = contracts.providerDefaults('crtsh');
  assert.strictEqual(api.timeoutMs, contracts.DEFAULTS.providerTimeoutMs);
  assert.strictEqual(collector.timeoutMs, contracts.DEFAULTS.collectorTimeoutMs);
  assert.strictEqual(contracts.providerDefaults('crtsh', { timeoutMs: 5000 }).timeoutMs, 5000);
  assert.strictEqual(contracts.providerDefaults('desconhecido'), null);
});

test('buildProviderConfig: habilita tudo por default; snapshot não tem segredo', () => {
  const config = contracts.buildProviderConfig(['searxng', 'cnpj-mcp']);
  assert.strictEqual(config.serper.enabled, false);
  assert.strictEqual(config.searxng.enabled, true);
  const serialized = JSON.stringify(config);
  assert.ok(!/sk-|token=|Bearer/i.test(serialized), 'snapshot não pode carregar segredo');
});

test('enabledProviders: self-hosted/free antes dos pagos (precedência do fallback)', () => {
  const order = contracts.enabledProviders({
    serper: { enabled: true },
    searxng: { enabled: true },
    exa: { enabled: true },
    'cnpj-mcp': { enabled: true },
  });
  assert.deepStrictEqual(order, ['cnpj-mcp', 'searxng', 'exa', 'serper']);
});

// ── Taxonomia de erro ───────────────────────────────────────────────────────

test('taxonomia: transitório faz retry; permanente e budget não', () => {
  assert.strictEqual(contracts.isTransientError('TIMEOUT'), true);
  assert.strictEqual(contracts.isTransientError('RATE_LIMIT'), true);
  assert.strictEqual(contracts.isPermanentError('NOT_CONFIGURED'), true);
  assert.strictEqual(contracts.isPermanentError('BUDGET_EXHAUSTED'), true);
  assert.strictEqual(contracts.errorClass('XXXXXXXX'), null);
});

// ── Mensagens e headers ─────────────────────────────────────────────────────

const JOB = {
  version: '1',
  jobId: 'job-1',
  orgId: 'org-1',
  trigger: 'api',
  criteria: { cnae: '6201', state: 'SP' },
  providers: { searxng: { enabled: true } },
  requestedAt: '2026-09-21T12:00:00.000Z',
};

const RUN = {
  version: '1',
  runId: 'run-1',
  jobId: 'job-1',
  orgId: 'org-1',
  provider: 'searxng',
  capability: 'web.search',
  input: { query: 'empresas São Paulo' },
  attempt: 1,
  requestedAt: '2026-09-21T12:00:00.000Z',
};

test('buildJobRequestedMessage: valida campos e carrega correlação', () => {
  const msg = contracts.buildJobRequestedMessage({ ...JOB, traceparent: '00-a-b-01' });
  assert.strictEqual(msg.subject, 'discovery.job.requested.v1');
  assert.strictEqual(msg.headers['X-Org-Id'], 'org-1');
  assert.strictEqual(msg.headers['X-Job-Id'], 'job-1');
  assert.ok(msg.headers['Nats-Msg-Id']);
});

test('buildProviderRequestedMessage: Nats-Msg-Id por tentativa (dedup JetStream)', () => {
  assert.strictEqual(
    contracts.buildProviderRequestedMessage({ ...RUN }).headers['Nats-Msg-Id'],
    'run-1:1'
  );
  assert.strictEqual(
    contracts.buildProviderRequestedMessage({ ...RUN, attempt: 2 }).headers['Nats-Msg-Id'],
    'run-1:2'
  );
});

test('buildProviderRequestedMessage: capability fora da taxonomia é rejeitada', () => {
  assert.throws(() => contracts.buildProviderRequestedMessage({ ...RUN, capability: 'hack.capacity' }), /capability/);
});

test('provider.completed: status só COMPLETED|PARTIAL; failed exige errorCode', () => {
  const done = contracts.buildProviderCompletedMessage({
    ...RUN, status: 'PARTIAL', counts: { items: 3 }, durationMs: 120, completedAt: '2026-09-21T12:00:01.000Z',
  });
  assert.strictEqual(done.subject, 'discovery.provider.completed.v1');
  assert.throws(() =>
    contracts.buildProviderCompletedMessage({ ...RUN, status: 'FAILED', durationMs: 1, completedAt: 'x' })
  );
  assert.throws(() =>
    contracts.buildProviderFailedMessage({ ...RUN, failedAt: 'x', durationMs: 1 })
  );
});

test('candidate.upserted: exige dedupeKey', () => {
  const msg = contracts.buildCandidateUpsertedMessage({
    version: '1', candidateId: 'c-1', jobId: 'job-1', orgId: 'org-1',
    dedupeKey: 'cnpj:11222333000181', upsertedAt: '2026-09-21T12:00:02.000Z',
  });
  assert.strictEqual(msg.headers['Nats-Msg-Id'], 'discovery.candidate.upserted.v1:c-1');
  assert.throws(() =>
    contracts.buildCandidateUpsertedMessage({
      version: '1', candidateId: 'c-2', jobId: 'job-1', orgId: 'org-1', upsertedAt: 'x',
    })
  );
});

test('serialize/parse: round-trip e guarda de versão', () => {
  const buf = contracts.serializePayload(RUN);
  assert.deepStrictEqual(contracts.parsePayload(buf), RUN);
  assert.throws(() => contracts.parsePayload(contracts.serializePayload({ ...RUN, version: '2' })), /version/);
});
