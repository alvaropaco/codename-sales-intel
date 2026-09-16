const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createRawStore } = require('../raw-store');
const { reprocessRaw } = require('../scripts/reprocess-raw');

const CONFIG = {
  RAW_STORE_BACKEND: () => 'postgres',
  RAW_MAX_BYTES: () => 1024,
  RAW_RETENTION_DAYS: () => 90,
};

async function seed(prisma) {
  const store = createRawStore({ prisma, config: CONFIG });
  const ref = await store.put({
    orgId: 'org-1', capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj',
    contentType: 'application/json',
    body: JSON.stringify({ razao_social: 'MARISPAN LTDA', capital_social: 250000 }),
  });
  const task = await prisma.enrichmentTask.create({
    data: { orgId: 'org-1', jobId: 'j-1', prospectId: 'p-1', taskKey: 'k-1', entityKey: 'prospect:p-1', entityType: 'prospect', capability: 'identity.cnpj.basic', input: { cnpj: '45299583000131' }, inputHash: 'x', status: 'COMPLETED' },
  });
  const result = await prisma.enrichmentResult.create({
    data: { orgId: 'org-1', taskId: task.id, jobId: 'j-1', prospectId: 'p-1', entityKey: task.entityKey, entityType: 'prospect', capability: 'identity.cnpj.basic', provider: 'brasilapi.cnpj', status: 'COMPLETED', data: { legal_name: 'valor antigo' }, durationMs: 100, workerVersion: 'old', rawRecordId: ref.rawRecordId },
  });
  return { store, ref, task, result };
}

test('US6 reprocess: extrai novo fato do bruto retido SEM nenhuma chamada externa', async () => {
  const prisma = createFakePrisma();
  const { store, ref, result } = await seed(prisma);
  let externalCalls = 0;
  const fetchSpy = async () => { externalCalls += 1; throw new Error('não deveria chamar rede'); };

  const extractor = (rawBody) => {
    const parsed = JSON.parse(rawBody);
    return {
      data: { legal_name: parsed.razao_social, capital: parsed.capital_social },
      facts: [
        { attribute: 'company.legal_name', value: parsed.razao_social, confidence: 0.99,
          evidence: { sourceType: 'rfb.replay', retrievedAt: new Date().toISOString() } },
      ],
    };
  };

  const outcome = await reprocessRaw({
    prisma,
    rawStore: store,
    rawRecordId: ref.rawRecordId,
    extractor,
    fetchSpy,
  });

  assert.strictEqual(externalCalls, 0); // ZERO chamadas externas (SC-011)
  assert.strictEqual(outcome.updated, true);
  const row = await prisma.enrichmentResult.findUnique({ where: { id: result.id } });
  assert.strictEqual(row.data.legal_name, 'MARISPAN LTDA'); // fato novo do mesmo bruto
  assert.strictEqual(row.data.capital, 250000);
  assert.strictEqual(row.metadata.reprocessedFrom, ref.rawRecordId); // rastreabilidade
  const evidence = await prisma.enrichmentEvidence.findMany({ where: { resultId: result.id } });
  assert.strictEqual(evidence.length, 1);
  assert.strictEqual(evidence[0].attribute, 'company.legal_name');
});

test('US6 reprocess: rawRecord inexistente → erro claro', async () => {
  const prisma = createFakePrisma();
  const store = createRawStore({ prisma, config: CONFIG });
  await assert.rejects(
    () => reprocessRaw({ prisma, rawStore: store, rawRecordId: 'inexistente', extractor: () => ({ data: {} }) }),
    /não encontrado/
  );
});
