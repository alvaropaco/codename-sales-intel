const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createRawStore } = require('../raw-store');

const CONFIG = {
  RAW_STORE_BACKEND: () => 'postgres',
  RAW_MAX_BYTES: () => 64,
  RAW_RETENTION_DAYS: () => 90,
};

function makeStore(over = {}) {
  const prisma = createFakePrisma();
  const store = createRawStore({ prisma, config: { ...CONFIG, ...over } });
  return { prisma, store };
}

test('US6 raw-store put/get: grava e devolve o bruto íntegro (backend postgres)', async () => {
  const { prisma, store } = makeStore();
  const ref = await store.put({
    orgId: 'org-1', capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj',
    contentType: 'application/json',
    body: JSON.stringify({ razao_social: 'MARISPAN LTDA', capital_social: 1000 }),
  });
  assert.ok(ref.rawRecordId);

  const record = await store.get(ref.rawRecordId);
  assert.strictEqual(record.contentType, 'application/json');
  const parsed = JSON.parse(record.body);
  assert.strictEqual(parsed.razao_social, 'MARISPAN LTDA');
  assert.strictEqual(record.truncated, false);

  const row = prisma.rawRecord.rows[0];
  assert.strictEqual(row.storageBackend, 'postgres');
  assert.ok(row.sizeBytes > 0);
});

test('US6 truncation: payload acima de RAW_MAX_BYTES é truncado com flag', async () => {
  const { store } = makeStore();
  const big = 'x'.repeat(200);
  const ref = await store.put({
    orgId: 'org-1', capability: 'search.news', provider: 'searxng',
    contentType: 'text/html', body: big,
  });
  const record = await store.get(ref.rawRecordId);
  assert.strictEqual(record.truncated, true);
  assert.ok(record.body.length <= 64);
  const stored = await store.get(ref.rawRecordId);
  assert.strictEqual(stored.body.length, 64);
});

test('US6 backend s3 sem configuração → erro claro NOT_IMPLEMENTED (guard R5)', async () => {
  const { store } = makeStore({ RAW_STORE_BACKEND: () => 's3' });
  await assert.rejects(
    () => store.put({ orgId: 'o', capability: 'c', provider: 'p', contentType: 'text/plain', body: 'x' }),
    (e) => e.code === 'NOT_IMPLEMENTED'
  );
});

test('US6 prune: remove apenas registros mais antigos que a retenção', async () => {
  const { prisma, store } = makeStore();
  const old = await store.put({ orgId: 'o', capability: 'c', provider: 'p', contentType: 'text/plain', body: 'velho' });
  // Envelhece artificialmente o primeiro registro.
  prisma.rawRecord.rows[0].createdAt = new Date(Date.now() - 91 * 24 * 3600 * 1000);
  await store.put({ orgId: 'o', capability: 'c', provider: 'p', contentType: 'text/plain', body: 'novo' });
  const removed = await store.prune(90);
  assert.strictEqual(removed, 1);
  const kept = await store.get(old.rawRecordId);
  assert.strictEqual(kept, null);
});
