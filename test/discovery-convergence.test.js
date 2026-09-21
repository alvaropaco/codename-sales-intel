const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const cnpjProvider = require('../discovery/providers/cnpj-mcp');
const { caseObservation } = require('../discovery/providers/jusbrasil');
const { relationTypeForRole, ownershipObservations } = require('../discovery/enrichers/ownership');
const { scoreIcp } = require('../discovery/icp');
const { createDiscoveryOrchestrator } = require('../discovery/orchestrator');
const normalizer = require('../discovery/normalizer');

const CNPJ = '11222333000181';

// ── T058: role matching por substring (qualificações compostas do QSA) ──────

test('T058: qualificações compostas do QSA mapeiam para a relação mais forte', () => {
  assert.strictEqual(relationTypeForRole('Sócio-Administrador'), 'HAS_DIRECTOR');
  assert.strictEqual(relationTypeForRole('Representante Legal'), 'HAS_REPRESENTATIVE');
  assert.strictEqual(relationTypeForRole('Sócio'), 'HAS_PARTNER');
  assert.strictEqual(relationTypeForRole('Não informado'), 'RELATED_TO');
});

// ── T058: provider cnpj-mcp ingere ownership via QSA (BrasilAPI) ────────────

test('T058: execute({cnpj}) emite observações de sócios com relações tipadas', async () => {
  const fakeMcp = {
    getCompanyByCnpj: async () => ({
      cnpj: normalizer.formatCnpj(CNPJ),
      legalName: 'Empresa Exemplo Ltda',
      status: 'active',
      isActive: true,
    }),
  };
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({
      cnpj: CNPJ,
      qsa: [
        { nome_socio: 'José da Silva', qualificacao_socio: 'Sócio-Administrador', data_entrada_sociedade: '2015-03-10' },
        { nome_socio: 'Maria Souza', qualificacao_socio: 'Sócio', data_entrada_sociedade: '2015-03-10' },
      ],
    }),
  });

  const result = await cnpjProvider.execute(
    { cnpj: CNPJ },
    { client: fakeMcp, fetchImpl: fakeFetch }
  );

  const personItems = result.items.filter((i) => i.entityType === 'person');
  assert.strictEqual(personItems.length, 2);
  const jose = personItems.find((i) => i.displayName === 'José da Silva');
  assert.strictEqual(jose.related.length, 1);
  assert.strictEqual(jose.related[0].type, 'HAS_DIRECTOR'); // composto → mais forte
  assert.strictEqual(jose.related[0].rel.effectiveDate, '2015-03-10');
  assert.strictEqual(jose.evidenceType, 'official_registry');
  assert.strictEqual(jose.sourceProvider, 'cnpj-mcp');

  // ownershipObservations: pessoa com múltiplos papais vira 1 obs, N relações
  const multi = ownershipObservations([
    { name: 'Ana', role: 'Sócio' },
    { name: 'Ana', role: 'Administrador' },
  ]);
  assert.strictEqual(multi.length, 1);
  assert.strictEqual(multi[0].related.length, 2);
});

test('T058: QSA indisponível não derruba o provider (items de empresa seguem)', async () => {
  const fakeMcp = { getCompanyByCnpj: async () => ({ cnpj: CNPJ, legalName: 'X', isActive: true }) };
  const failingFetch = async () => { throw new Error('boom'); };
  const result = await cnpjProvider.execute({ cnpj: CNPJ }, { client: fakeMcp, fetchImpl: failingFetch });
  assert.strictEqual(result.items.length, 1); // só a company
  assert.strictEqual(result.items[0].entityType, 'company');
});

// ── T059: movimentações e documentos viram entidades legais dedicadas ───────

test('T059: caseObservation mapeia movimentos → legal_event e docs → legal_document', () => {
  const obs = caseObservation({
    number: '0001234-55.2026.8.26.0100',
    title: 'Cobrança',
    court: 'TJSP',
    parties: [{ name: 'Empresa Exemplo', document: CNPJ, role: 'Autor' }],
    movements: [
      { date: '2026-09-01', description: 'Juntada de petição' },
      { date: '2026-09-10', description: 'Despacho proferido' },
      { date: '2026-09-11' }, // sem descrição → ignorado
    ],
    documents: [
      { name: 'Petição inicial', url: 'https://doc/1' },
      { url: 'https://doc/2' }, // sem nome e url existe → mantém
    ],
  }, 'jusbrasil');

  const events = obs.related.filter((r) => r.entityType === 'legal_event');
  const documents = obs.related.filter((r) => r.entityType === 'legal_document');
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'HAS_EVENT');
  assert.strictEqual(events[0].rel.date, '2026-09-01');
  assert.strictEqual(documents.length, 2);
  assert.strictEqual(documents[0].type, 'HAS_DOCUMENT');
  assert.strictEqual(documents[0].rel.url, 'https://doc/1');

  // Chaves canônicas novas são estáveis (dedup de replay)
  assert.strictEqual(
    normalizer.canonicalKey('legal_event', events[0].value),
    normalizer.canonicalKey('legal_event', events[0].value)
  );
  assert.ok(normalizer.canonicalKey('legal_document', documents[0].value).startsWith('doc:'));
});

// ── T060: pontuação ICP determinística + filtro na listagem ─────────────────

test('T060: scoreIcp — UF 0.4 + cidade 0.3 + CNAE 0.3; sem criteria → null', () => {
  const attrs = { state: 'SP', city: 'Campinas', industry: 'Desenvolvimento de software', cnaes: ['6201-5/00'] };
  const criteria = { state: 'SP', city: 'campinas', cnae: '6201' };
  assert.strictEqual(scoreIcp(attrs, criteria), 1); // match total (case-insensitive)
  assert.strictEqual(scoreIcp({ ...attrs, city: 'Sorocaba' }, criteria), 0.7);
  assert.strictEqual(scoreIcp({ state: 'RJ' }, criteria), 0);
  assert.strictEqual(scoreIcp(attrs, null), null); // sem ICP não pune
  assert.strictEqual(scoreIcp(attrs, {}), null); // criteria sem campos comparáveis
  assert.strictEqual(scoreIcp(attrs, { state: 'SP' }), 0.4);
});

test('T060: orquestrador grava icpScore no candidato e listCandidates filtra', async () => {
  const prisma = createFakePrisma();
  const orchestrator = createDiscoveryOrchestrator({
    prisma,
    providerMap: {
      'cnpj-mcp': {
        name: 'cnpj-mcp', isConfigured: () => true,
        execute: async () => ({
          items: [
            {
              entityType: 'company', value: CNPJ, displayName: 'Dentro do ICP',
              attributes: { state: 'SP', city: 'Campinas', industry: 'Desenvolvimento de software', cnaes: ['6201-5/00'], cnpjDigits: CNPJ },
              evidenceType: 'official_registry', confidence: 0.98,
              sourceProvider: 'cnpj-mcp', sourceUrl: null, sourceRef: `cnpj:${CNPJ}`, observedAt: null, related: [],
            },
            {
              entityType: 'company', value: '27865757000102', displayName: 'Fora do ICP',
              attributes: { state: 'RJ', city: 'Niterói', industry: 'restaurantes' },
              evidenceType: 'official_registry', confidence: 0.9,
              sourceProvider: 'cnpj-mcp', sourceUrl: null, sourceRef: 'cnpj:27865757000102', observedAt: null, related: [],
            },
          ],
          requests: 1, estimatedCost: 0,
        }),
      },
    },
    now: (() => { let i = 0; return () => new Date(1726900000000 + (i += 500)); })(),
    logger: { info() {}, warn() {}, error() {} },
  });

  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api',
    criteria: { state: 'SP', city: 'Campinas', cnae: '6201' },
    providers: ['cnpj-mcp'],
  });
  await orchestrator.runJob(job.id, 'org-1');

  const all = await prisma.discoveryCandidate.findMany({});
  assert.strictEqual(all.length, 2);
  const inside = all.find((c) => c.name === 'Dentro do ICP');
  const outside = all.find((c) => c.name === 'Fora do ICP');
  assert.strictEqual(inside.location.icpScore, 1);
  assert.strictEqual(outside.location.icpScore, 0);

  // Filtro na listagem: só quem passa no ICP mínimo.
  const filtered = await orchestrator.persistence.listCandidates({ orgId: 'org-1', minIcp: 0.5 });
  assert.strictEqual(filtered.total, 1);
  assert.strictEqual(filtered.items[0].name, 'Dentro do ICP');
  // Sem filtro: todos.
  const unfiltered = await orchestrator.persistence.listCandidates({ orgId: 'org-1' });
  assert.strictEqual(unfiltered.total, 2);
});
