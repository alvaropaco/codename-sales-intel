const test = require('node:test');
const assert = require('node:assert');
const { computeTaskKey, hashInput, uuidv5 } = require('../workers/sdk/idempotency');

test('uuidv5 segue RFC 4122 (versão 5, variante RFC) e é determinístico', () => {
  const a = uuidv5('marispan', '6f4c1a2e-9b7d-4e3a-8c5f-1d2e3a4b5c6d');
  const b = uuidv5('marispan', '6f4c1a2e-9b7d-4e3a-8c5f-1d2e3a4b5c6d');
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notStrictEqual(a, uuidv5('outra', '6f4c1a2e-9b7d-4e3a-8c5f-1d2e3a4b5c6d'));
});

test('hashInput: ordem das chaves não muda o hash', () => {
  assert.strictEqual(hashInput({ a: 1, b: { c: 2, d: 3 } }), hashInput({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notStrictEqual(hashInput({ a: 1 }), hashInput({ a: 2 }));
});

test('computeTaskKey: determinístico e sensível a cada dimensão', () => {
  const base = () => computeTaskKey({
    orgId: 'org-1', jobId: 'job-1', entityKey: 'prospect:p-1',
    capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj',
    input: { cnpj: '45299583000131' },
  });
  const k1 = base();
  const k2 = base();
  assert.strictEqual(k1, k2);
  assert.match(k1, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const variants = [
    { orgId: 'org-2' }, { jobId: 'job-2' }, { entityKey: 'prospect:p-2' },
    { capability: 'search.news' }, { provider: 'searxng' }, { input: { cnpj: '11222333000181' } },
  ];
  for (const v of variants) {
    assert.notStrictEqual(k1, computeTaskKey({ ...{ orgId: 'org-1', jobId: 'job-1', entityKey: 'prospect:p-1', capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj', input: { cnpj: '45299583000131' } }, ...v }), JSON.stringify(v));
  }
  // Ordem das chaves do input não muda a chave (mesma task lógica).
  assert.strictEqual(
    computeTaskKey({ orgId: 'o', jobId: 'j', entityKey: 'e', capability: 'c', provider: null, input: { a: 1, b: 2 } }),
    computeTaskKey({ orgId: 'o', jobId: 'j', entityKey: 'e', capability: 'c', provider: null, input: { b: 2, a: 1 } })
  );
});
