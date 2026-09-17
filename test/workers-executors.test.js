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
