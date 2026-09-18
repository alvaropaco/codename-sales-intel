const test = require('node:test');
const assert = require('node:assert');
const { executors } = require('../workers/identity');

// T067 — o fetch do cnpj.basic deve observar o signal da task (abort no timeout)
test('T067 identity.cnpj.basic propaga ctx.signal ao fetch', async () => {
  const seen = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    seen.push({ url, signal: opts.signal });
    return { ok: true, status: 200, json: async () => ({ razao_social: 'X', cnpj: '45299583000131' }) };
  };
  try {
    const controller = new AbortController();
    const task = {
      input: { cnpj: '45299583000131' },
      orgId: 'o', jobId: 'j', prospectId: 'p', entityKey: 'prospect:p', entityType: 'prospect',
      capability: 'identity.cnpj.basic', taskId: 't', taskKey: 'k', attempt: 1, timeoutMs: 1000,
    };
    const out = await executors['identity.cnpj.basic'](task, {
      signal: controller.signal,
      logger: { info() {}, warn() {}, error() {}, child() { return this; } },
    });
    assert.strictEqual(out.status, 'COMPLETED');
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].signal, controller.signal);
  } finally {
    global.fetch = origFetch;
  }
});

// ── Resiliência CNPJ: BrasilAPI 403/429 (Cloudflare) → espelho minhareceita ─

function mockFetchSequence(responses) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, signal: opts.signal });
    const next = responses.shift();
    if (!next) throw new Error('mockFetch: sem resposta programada');
    if (next.throw) throw next.throw;
    return next;
  };
  return {
    calls,
    restore() { global.fetch = orig; },
  };
}

const BASIC_TASK = {
  input: { cnpj: '45299583000131' },
  orgId: 'o', jobId: 'j', prospectId: 'p', entityKey: 'prospect:p', entityType: 'prospect',
  capability: 'identity.cnpj.basic', taskId: 't', taskKey: 'k', attempt: 1, timeoutMs: 1000,
};
const LOGGER = { info() {}, warn() {}, error() {}, child() { return this; } };

test('cnpj.basic: BrasilAPI 403 → fallback minhareceita COMPLETED', async () => {
  const mock = mockFetchSequence([
    { ok: false, status: 403 },
    { ok: true, status: 200, json: async () => ({ cnpj: '45299583000131', razao_social: 'MARISPAN', capital_social: 12000000 }) },
  ]);
  try {
    const out = await executors['identity.cnpj.basic'](BASIC_TASK, { signal: null, logger: LOGGER });
    assert.strictEqual(out.status, 'COMPLETED');
    assert.strictEqual(out.provider, 'minhareceita.cnpj');
    assert.strictEqual(out.data.legal_name, 'MARISPAN');
    assert.strictEqual(mock.calls.length, 2);
    assert.ok(mock.calls[1].url.includes('minhareceita.org'));
  } finally {
    mock.restore();
  }
});

test('cnpj.basic: BrasilAPI e espelho fora → PROVIDER_UNAVAILABLE (transiente)', async () => {
  const mock = mockFetchSequence([
    { ok: false, status: 503 },
    { ok: false, status: 500 },
  ]);
  try {
    // Executor LANÇA PROVIDER_UNAVAILABLE; o runtime publica como transiente.
    await assert.rejects(
      executors['identity.cnpj.basic'](BASIC_TASK, { signal: null, logger: LOGGER }),
      (err) => err.code === 'PROVIDER_UNAVAILABLE'
    );
  } finally {
    mock.restore();
  }
});

test('cnpj.basic: 404 na BrasilAPI é NOT_FOUND permanente, sem fallback', async () => {
  const mock = mockFetchSequence([{ ok: false, status: 404 }]);
  try {
    // Executor LANÇA NOT_FOUND; o runtime classifica como permanente (retryable=false).
    await assert.rejects(
      executors['identity.cnpj.basic'](BASIC_TASK, { signal: null, logger: LOGGER }),
      (err) => err.code === 'NOT_FOUND'
    );
    assert.strictEqual(mock.calls.length, 1); // sem chamada ao espelho
  } finally {
    mock.restore();
  }
});
