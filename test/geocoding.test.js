const test = require('node:test');
const assert = require('node:assert');
const geocoding = require('../geocoding');

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeFakePrisma({ cached = null } = {}) {
  const store = new Map();
  if (cached) store.set(cached.normalizedKey, cached);
  const calls = { findUnique: 0, upsert: 0 };
  const prisma = {
    geocodeCache: {
      async findUnique({ where: { normalizedKey } }) {
        calls.findUnique += 1;
        return store.get(normalizedKey) || null;
      },
      async upsert({ where: { normalizedKey }, create, update }) {
        calls.upsert += 1;
        const row = { ...create, ...update, normalizedKey };
        store.set(normalizedKey, row);
        return row;
      },
    },
    _store: store,
    _calls: calls,
  };
  return prisma;
}

/** fetchImpl fake: registra URLs e responde por roteador simples. */
function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const [match, respond] of routes) {
      if (url.includes(match)) {
        const body = typeof respond === 'function' ? respond(url) : respond;
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const FAILING_FETCH = makeFetch([]);

const BRASILAPI_PAULISTA = {
  cep: '01310930',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Bela Vista',
  street: 'Avenida Paulista',
  location: {
    coordinates: { latitude: '-23.561414', longitude: '-46.655881' },
    city: { coordinates: { latitude: '-23.5505', longitude: '-46.6333' } },
  },
};

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

// ── Normalização / dedup ────────────────────────────────────────────────────

test('normalizeKey é estável entre formatações diferentes do mesmo endereço', () => {
  const a = geocoding.normalizeKey('Rua das Flores, 123 — Centro, São Paulo/SP');
  const b = geocoding.normalizeKey('  rua das   flores 123 CENTRO sao paulo SP ');
  assert.strictEqual(a, b);
  assert.ok(a.includes('flores'));
  assert.ok(!/[,-/]/.test(a), 'sem pontuação: ' + a);
});

test('hashKey é determinístico e curto', () => {
  assert.strictEqual(geocoding.hashKey('abc def'), geocoding.hashKey('abc def'));
  assert.match(geocoding.hashKey('abc'), /^[0-9a-f]{8}$/);
});

test('extractLeadAddresses produz sede (cnpjRawData) + resumo comercial (city/UF)', () => {
  const rows = geocoding.extractLeadAddresses(prospectBase());
  const kinds = rows.map((r) => r.kind).sort();
  assert.deepStrictEqual(kinds, ['city', 'headquarters']);
  const hq = rows.find((r) => r.kind === 'headquarters');
  assert.ok(hq.fullText.includes('Rua das Flores, 123'));
  assert.ok(hq.fullText.includes('São Paulo/SP'));
  assert.ok(hq.fullText.includes('01310-100'));
  const city = rows.find((r) => r.kind === 'city');
  assert.strictEqual(city.fullText, 'São Paulo, SP');
});

test('extractLeadAddresses sem cnpjRawData produz apenas o resumo comercial', () => {
  const rows = geocoding.extractLeadAddresses(prospectBase({ cnpjRawData: null }));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, 'city');
});

// ── Geocodificação externa ──────────────────────────────────────────────────

test('geocode resolve por BrasilAPI (CEP → coordenadas, precisão zip)', async () => {
  const fetchImpl = makeFetch([['brasilapi.com.br', BRASILAPI_PAULISTA]]);
  const result = await geocoding.geocode({ cep: '01310100', kind: 'headquarters' }, { fetchImpl });
  assert.deepStrictEqual(result, {
    lat: -23.561414,
    lng: -46.655881,
    precision: 'zip',
    source: 'brasilapi',
  });
});

test('geocode cai para Nominatim quando o CEP não resolve', async () => {
  const fetchImpl = makeFetch([
    ['brasilapi.com.br', { cep: '00000000', state: 'SP', city: 'X', location: null }],
    ['nominatim.openstreetmap.org', [{ lat: '-23.56', lon: '-46.65' }]],
  ]);
  const result = await geocoding.geocode(
    { cep: '00000000', fullText: 'Rua Y, 1 — São Paulo/SP', kind: 'headquarters' },
    { fetchImpl }
  );
  assert.deepStrictEqual(result, { lat: -23.56, lng: -46.65, precision: 'street', source: 'nominatim' });
});

test('geocode retorna null quando todas as fontes falham (sem throw)', async () => {
  const result = await geocoding.geocode(
    { cep: '00000000', fullText: 'Rua Y, 1 — São Paulo/SP', kind: 'headquarters' },
    { fetchImpl: FAILING_FETCH }
  );
  assert.strictEqual(result, null);
});

// ── Cache e limites ─────────────────────────────────────────────────────────

function freshCacheRow(over = {}) {
  return {
    normalizedKey: 'rua das flores 123 centro sao paulo sp',
    lat: -23.5,
    lng: -46.6,
    precision: 'zip',
    source: 'brasilapi',
    fetchedAt: new Date(),
    ...over,
  };
}

test('cache fresco é usado sem chamada externa', async () => {
  const prisma = makeFakePrisma();
  for (const row of geocoding.extractLeadAddresses(prospectBase())) {
    await prisma.geocodeCache.upsert({
      where: { normalizedKey: row.normalizedKey },
      create: { normalizedKey: row.normalizedKey, lat: -23.5, lng: -46.6, precision: 'zip', source: 'brasilapi', fetchedAt: new Date() },
      update: {},
    });
  }
  prisma._calls.upsert = 0; // o seeding usa upsert; o teste mede só o collect
  const fetchImpl = makeFetch([['brasilapi.com.br', BRASILAPI_PAULISTA]]);
  const body = await geocoding.collectLeadAddresses({
    prospect: prospectBase(),
    plan: 'premium',
    prisma,
    fetchImpl,
  });
  assert.strictEqual(fetchImpl.calls.length, 0);
  assert.strictEqual(prisma._calls.upsert, 0);
  const hq = body.addresses.find((a) => a.kind === 'headquarters');
  assert.deepStrictEqual(hq.location, { lat: -23.5, lng: -46.6, precision: 'zip' });
});

test('cache expirado (TTL 90d) revalida com a fonte externa', async () => {
  const stale = freshCacheRow({ fetchedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) });
  const prisma = makeFakePrisma({ cached: stale });
  const fetchImpl = makeFetch([['brasilapi.com.br', BRASILAPI_PAULISTA]]);
  await geocoding.collectLeadAddresses({ prospect: prospectBase(), plan: 'premium', prisma, fetchImpl });
  assert.ok(fetchImpl.calls.length >= 1, 'deve re-geocodificar');
  assert.strictEqual(prisma._calls.upsert, 1);
});

test('sem cache: geocodifica e persiste (upsert)', async () => {
  const prisma = makeFakePrisma();
  const fetchImpl = makeFetch([['brasilapi.com.br', BRASILAPI_PAULISTA]]);
  const body = await geocoding.collectLeadAddresses({ prospect: prospectBase(), plan: 'premium', prisma, fetchImpl });
  assert.strictEqual(prisma._calls.upsert, 1);
  const hq = body.addresses.find((a) => a.kind === 'headquarters');
  assert.ok(hq.location);
  assert.strictEqual(hq.location.precision, 'zip');
  const stored = prisma._store.values().next().value;
  assert.ok(stored, 'cache persistido');
  assert.strictEqual(stored.source, 'brasilapi');
});

test('falha da fonte externa degrada com location null (nunca quebra a resposta)', async () => {
  const prisma = makeFakePrisma();
  const body = await geocoding.collectLeadAddresses({
    prospect: prospectBase(),
    plan: 'premium',
    prisma,
    fetchImpl: FAILING_FETCH,
  });
  const hq = body.addresses.find((a) => a.kind === 'headquarters');
  assert.strictEqual(hq.location, null);
  assert.ok(hq.fullText.includes('Rua das Flores'));
});

test('limite de 1 geocodificação nova por request (protege Nominatim)', async () => {
  const prisma = makeFakePrisma();
  const fetchImpl = makeFetch([['brasilapi.com.br', BRASILAPI_PAULISTA]]);
  const prospect = prospectBase({
    cnpjRawData: {
      logradouro: 'Rua A', numero: '1', bairro: 'B', municipio: 'São Paulo', uf: 'SP', cep: '01310-100',
    },
  });
  const graphAddressLabels = ['Rua B, 2 — São Paulo/SP', 'Rua C, 3 — São Paulo/SP'];
  const body = await geocoding.collectLeadAddresses({
    prospect, plan: 'premium', prisma, fetchImpl, graphAddressLabels,
  });
  const located = body.addresses.filter((a) => a.location);
  const unlocated = body.addresses.filter((a) => !a.location);
  assert.strictEqual(located.length, 1, 'só 1 geocode novo');
  assert.ok(unlocated.length >= 2);
  assert.strictEqual(fetchImpl.calls.length, 1);
});
