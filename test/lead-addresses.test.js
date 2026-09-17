const test = require('node:test');
const assert = require('node:assert');
const geocoding = require('../geocoding');

// Composição da resposta de GET /api/prospects/:id/addresses (contracts/api.md):
// escopo por organização e masking por plano acontecem na rota (findFirst
// {id, orgId} + plano) — aqui validamos a montagem do corpo por plano,
// ordenação, dedup e degradação, no nível de módulo (padrão do repo).

function makeFakePrisma() {
  return {
    geocodeCache: {
      async findUnique() {
        return null;
      },
      async upsert({ where: { normalizedKey }, create }) {
        return { ...create, normalizedKey };
      },
    },
  };
}

const OK_FETCH = makeOkFetch();

function makeOkFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      cep: '01310930',
      state: 'SP',
      city: 'São Paulo',
      location: {
        coordinates: { latitude: '-23.56', longitude: '-46.65' },
        city: { coordinates: { latitude: '-23.55', longitude: '-46.63' } },
      },
    }),
  });
}

function prospectBase(over = {}) {
  return {
    id: 'p-1',
    orgId: 'org-1',
    companyName: 'Marispan Ltda',
    city: 'São Paulo',
    state: 'SP',
    cnpjRawData: {
      logradouro: 'Rua das Flores',
      numero: '123',
      bairro: 'Centro',
      municipio: 'São Paulo',
      uf: 'SP',
      cep: '01310-100',
    },
    ...over,
  };
}

test('premium: corpo completo com sede capturada e resumo, na ordem do contrato', async () => {
  const body = await geocoding.collectLeadAddresses({
    prospect: prospectBase(),
    plan: 'premium',
    prisma: makeFakePrisma(),
    fetchImpl: OK_FETCH,
    graphAddressLabels: ['Av Paulista, 1000 — São Paulo/SP'],
  });
  assert.strictEqual(body.prospectId, 'p-1');
  assert.strictEqual(body.dataRestricted, false);
  const kinds = body.addresses.map((a) => a.kind);
  assert.deepStrictEqual(kinds, ['headquarters', 'captured', 'city']);
  for (const address of body.addresses) {
    assert.match(address.id, /^[0-9a-f]{8}$/);
    assert.ok(address.fullText && address.fullText !== '—');
  }
});

test('trial: NENHUM endereço de rua é entregue — apenas resumo coarse da cidade', async () => {
  const body = await geocoding.collectLeadAddresses({
    // mesmo que o masking do prospect falhe e o raw chegue, o plano retém
    prospect: prospectBase(),
    plan: 'trial',
    prisma: makeFakePrisma(),
    fetchImpl: OK_FETCH,
    graphAddressLabels: ['Av Paulista, 1000 — São Paulo/SP'],
  });
  assert.strictEqual(body.dataRestricted, true);
  assert.strictEqual(body.addresses.length, 1);
  assert.strictEqual(body.addresses[0].kind, 'city');
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('Flores'), 'logradouro vaza no trial');
  assert.ok(!serialized.includes('Paulista'), 'endereço capturado vaza no trial');
});

test('endereço capturado idêntico ao resumo comercial é deduplicado (mantém o melhor)', async () => {
  const body = await geocoding.collectLeadAddresses({
    prospect: prospectBase({ cnpjRawData: null }),
    plan: 'premium',
    prisma: makeFakePrisma(),
    fetchImpl: OK_FETCH,
    graphAddressLabels: ['São Paulo, SP'],
  });
  const keys = body.addresses.map((a) => a.fullText);
  assert.strictEqual(keys.length, 1, 'um único pino: ' + JSON.stringify(keys));
  assert.strictEqual(body.addresses[0].kind, 'captured');
});

test('degradação: fonte externa fora → resposta 200-equivalente com location null', async () => {
  const body = await geocoding.collectLeadAddresses({
    prospect: prospectBase(),
    plan: 'premium',
    prisma: makeFakePrisma(),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.strictEqual(body.addresses.length, 2); // sede + resumo, sem pino
  for (const address of body.addresses) {
    assert.strictEqual(address.location, null);
  }
});
