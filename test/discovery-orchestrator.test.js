const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createDiscoveryOrchestrator, deriveInput, buildQuery } = require('../discovery/orchestrator');
const contracts = require('../discovery/contracts');
const normalizer = require('../discovery/normalizer');

const COMPANY_CNPJ = '11222333000181';

function companyItem(provider = 'searxng', confidence = 0.72) {
  return {
    entityType: 'company',
    value: COMPANY_CNPJ,
    displayName: 'Empresa Exemplo',
    attributes: { legalName: 'Empresa Exemplo Ltda', city: 'São Paulo', state: 'SP', cnpjDigits: COMPANY_CNPJ },
    evidenceType: provider === 'cnpj-mcp' ? 'official_registry' : 'search',
    confidence,
    sourceProvider: provider,
    sourceUrl: null,
    sourceRef: `cnpj:${COMPANY_CNPJ}`,
    observedAt: null,
    related: [{ entityType: 'domain', value: 'exemplo.com.br', type: 'HAS_DOMAIN' }],
  };
}

function makeEngine({ providerMap, publish = null, sleep = async () => {} } = {}) {
  const prisma = createFakePrisma();
  let tick = 0;
  const orchestrator = createDiscoveryOrchestrator({
    prisma,
    publish,
    providerMap,
    sleep,
    now: () => new Date(1726900000000 + (tick += 500)),
    logger: { info() {}, warn() {}, error() {} },
  });
  return { prisma, orchestrator };
}

// ── US1: descoberta comercial com providers mistos ─────────────────────────

test('US1/T016: provider ok + provider com falha transitória terminal → job partial', async () => {
  let crtshAttempts = 0;
  const { prisma, orchestrator } = makeEngine({
    sleep: async () => {},
    providerMap: {
      'http-metadata': {
        name: 'http-metadata', isConfigured: () => true,
        execute: async () => ({
          items: [{
            entityType: 'domain', value: 'exemplo.com.br', displayName: 'exemplo.com.br',
            attributes: { title: 'Exemplo' }, evidenceType: 'http', confidence: 0.88,
            sourceProvider: 'http-metadata', sourceUrl: null, sourceRef: 'http:exemplo.com.br',
            observedAt: null, related: [],
          }],
          requests: 1, estimatedCost: 0,
        }),
      },
      crtsh: {
        name: 'crtsh', isConfigured: () => true,
        execute: async () => {
          crtshAttempts += 1;
          const e = new Error('crt.sh fora');
          e.code = 'PROVIDER_UNAVAILABLE';
          throw e;
        },
      },
    },
  });
  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api',
    seed: { domain: 'exemplo.com.br' },
    providers: ['http-metadata', 'crtsh'],
  });
  const result = await orchestrator.runJob(job.id, 'org-1');

  assert.strictEqual(result.status, 'partial'); // falha de provider NÃO falha o job
  assert.strictEqual(result.providersFailed, 1);
  assert.strictEqual(result.providersDone, 1);
  assert.strictEqual(crtshAttempts, 3); // 1 + 2 retries (transient)
  const status = await orchestrator.persistence.getJobStatus(job.id, 'org-1');
  assert.strictEqual(status.providers.length, 2);
});

test('US1: empresa descoberta vira candidato + evento candidate.upserted (T044)', async () => {
  const published = [];
  const { prisma, orchestrator } = makeEngine({
    publish: (msg) => published.push(msg),
    providerMap: {
      'cnpj-mcp': { name: 'cnpj-mcp', isConfigured: () => true, execute: async () => ({ items: [companyItem('cnpj-mcp', 0.98)], requests: 1, estimatedCost: 0 }) },
    },
  });
  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api', seed: { cnpj: normalizer.formatCnpj(COMPANY_CNPJ) },
    providers: ['cnpj-mcp'],
  });
  const result = await orchestrator.runJob(job.id, 'org-1');

  assert.strictEqual(result.status, 'completed');
  const candidates = await prisma.discoveryCandidate.findMany({});
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].cnpj, COMPANY_CNPJ);
  assert.strictEqual(candidates[0].dedupeKey, `cnpj:${COMPANY_CNPJ}`);

  const candidateEvents = published.filter((m) => m.subject === contracts.CANDIDATE_UPSERTED_SUBJECT);
  assert.strictEqual(candidateEvents.length, 1);
  assert.strictEqual(candidateEvents[0].headers['Nats-Msg-Id'], `discovery.candidate.upserted.v1:${candidates[0].id}`);
});

test('US2: seed de domínio executa providers digitais e cria relações', async () => {
  const { prisma, orchestrator } = makeEngine({
    providerMap: {
      crtsh: {
        name: 'crtsh', isConfigured: () => true,
        execute: async () => ({
          items: [{
            entityType: 'subdomain', value: 'api.exemplo.com.br', displayName: 'api.exemplo.com.br',
            attributes: { baseDomain: 'exemplo.com.br' }, evidenceType: 'ct_log', confidence: 0.92,
            sourceProvider: 'crtsh', sourceUrl: null, sourceRef: 'ct:api.exemplo.com.br', observedAt: null, related: [],
          }],
          requests: 1, estimatedCost: 0,
        }),
      },
      'http-metadata': {
        name: 'http-metadata', isConfigured: () => true,
        execute: async () => ({
          items: [{
            entityType: 'domain', value: 'exemplo.com.br', displayName: 'exemplo.com.br',
            attributes: { technologies: ['nginx', 'react'], title: 'Exemplo' },
            evidenceType: 'http', confidence: 0.88,
            sourceProvider: 'http-metadata', sourceUrl: 'https://exemplo.com.br', sourceRef: 'http:exemplo.com.br',
            observedAt: null,
            related: [
              { entityType: 'email', value: 'contato@exemplo.com.br', type: 'HAS_EMAIL' },
              { entityType: 'technology', value: 'nginx', type: 'USES_TECH' },
            ],
          }],
          requests: 1, estimatedCost: 0,
        }),
      },
    },
  });
  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api', seed: { domain: 'https://www.exemplo.com.br' },
    providers: ['crtsh', 'http-metadata'],
  });
  const result = await orchestrator.runJob(job.id, 'org-1');
  assert.strictEqual(result.status, 'completed');

  const entities = await prisma.discoveryEntity.findMany({});
  const types = Object.fromEntries(entities.map((e) => [e.type, (entities.filter((x) => x.type === e.type)).length]));
  assert.ok(types.domain >= 1);
  assert.ok(types.subdomain >= 1);
  assert.ok(types.email >= 1);
  assert.ok(types.technology >= 1);
  const relations = await prisma.discoveryRelationship.findMany({});
  assert.ok(relations.some((r) => r.type === 'HAS_EMAIL'));
  assert.ok(relations.some((r) => r.type === 'USES_TECH'));
});

// ── Idempotência (SC-005) ───────────────────────────────────────────────────

test('SC-005: replay do mesmo resultado não duplica entidade/evidência/candidato', async () => {
  const { prisma, orchestrator } = makeEngine({
    providerMap: {
      'cnpj-mcp': { name: 'cnpj-mcp', isConfigured: () => true, execute: async () => ({ items: [companyItem('cnpj-mcp')], requests: 1, estimatedCost: 0 }) },
    },
  });
  const job = await orchestrator.createJob({ orgId: 'org-1', trigger: 'api', seed: { cnpj: COMPANY_CNPJ }, providers: ['cnpj-mcp'] });
  await orchestrator.runJob(job.id, 'org-1');

  // Segundo job com o MESMO resultado (redelivery de fonte) — mesma org.
  const job2 = await orchestrator.createJob({ orgId: 'org-1', trigger: 'api', seed: { cnpj: COMPANY_CNPJ }, providers: ['cnpj-mcp'] });
  await orchestrator.runJob(job2.id, 'org-1');

  assert.strictEqual((await prisma.discoveryEntity.findMany({ where: { type: 'company' } })).length, 1);
  assert.strictEqual((await prisma.discoveryEvidence.findMany({})).length, 1);
  assert.strictEqual((await prisma.discoveryCandidate.findMany({})).length, 1);
  assert.strictEqual((await prisma.discoveryRelationship.findMany({ where: { type: 'HAS_DOMAIN' } })).length, 1);
});

test('idempotência: runJob em job já finalizado não re-executa providers', async () => {
  let calls = 0;
  const { orchestrator } = makeEngine({
    providerMap: {
      'cnpj-mcp': { name: 'cnpj-mcp', isConfigured: () => true, execute: async () => { calls += 1; return { items: [companyItem('cnpj-mcp')], requests: 1, estimatedCost: 0 }; } },
    },
  });
  const job = await orchestrator.createJob({ orgId: 'org-1', trigger: 'api', seed: { cnpj: COMPANY_CNPJ }, providers: ['cnpj-mcp'] });
  await orchestrator.runJob(job.id, 'org-1');
  await orchestrator.runJob(job.id, 'org-1');
  assert.strictEqual(calls, 1);
});

// ── US3: fallback com precedência self-hosted (T040) ────────────────────────

test('T040: serper sem credenciais → skipped e fallback para searxng', async () => {
  let searxCalls = 0;
  const { prisma, orchestrator } = makeEngine({
    providerMap: {
      serper: { name: 'serper', isConfigured: () => false, execute: async () => { throw new Error('não deveria executar'); } },
      searxng: { name: 'searxng', isConfigured: () => true, execute: async () => { searxCalls += 1; return { items: [companyItem()], requests: 1, estimatedCost: 0 }; } },
    },
  });
  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api', criteria: { legalNameContains: 'Empresa Exemplo', state: 'SP' },
    providers: ['serper', 'searxng'],
  });
  const result = await orchestrator.runJob(job.id, 'org-1');
  assert.strictEqual(result.status, 'completed'); // fallback cobriu
  assert.strictEqual(searxCalls, 1);
  const status = await orchestrator.persistence.getJobStatus(job.id, 'org-1');
  const serperRun = status.providers.find((r) => r.provider === 'serper');
  assert.strictEqual(serperRun.status, 'skipped');
  assert.strictEqual(serperRun.errorCode, 'NOT_CONFIGURED');
});

// ── US3: budget (T042) ──────────────────────────────────────────────────────

test('T042: maxRequests estourado → BUDGET_EXHAUSTED e fallback', async () => {
  let braveCalls = 0;
  const { prisma, orchestrator } = makeEngine({
    providerMap: {
      searxng: {
        name: 'searxng', isConfigured: () => true,
        execute: async () => { throw Object.assign(new Error('fora'), { code: 'TIMEOUT' }); },
      },
      brave: { name: 'brave', isConfigured: () => true, execute: async () => { braveCalls += 1; return { items: [], requests: 1, estimatedCost: 0.3 }; } },
    },
  });
  const job = await orchestrator.createJob({
    orgId: 'org-1', trigger: 'api', criteria: { legalNameContains: 'Empresa Exemplo', state: 'SP' },
    providers: ['searxng', 'brave'],
    providerOverrides: { searxng: { maxRequests: 0 } }, // budget zero → já nasce exausto
  });
  const result = await orchestrator.runJob(job.id, 'org-1');
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(braveCalls, 1);
  const status = await orchestrator.persistence.getJobStatus(job.id, 'org-1');
  const searxRun = status.providers.find((r) => r.provider === 'searxng');
  assert.strictEqual(searxRun.errorCode, 'BUDGET_EXHAUSTED');
  assert.ok(status.job.estimatedCost > 0); // custo do fallback registrado
});

// ── Derivação de semente (fan-out dirigido) ─────────────────────────────────

test('deriveInput: cada provider recebe a semente certa', () => {
  const criteriaCtx = { criteria: { cnae: '6201', state: 'SP', legalNameContains: 'Sistema' }, seed: null };
  const domainCtx = { criteria: null, seed: { domain: 'exemplo.com.br' } };
  assert.deepStrictEqual(deriveInput('crtsh', domainCtx), { domain: 'exemplo.com.br' });
  assert.deepStrictEqual(deriveInput('dns-rdap', domainCtx), { domain: 'exemplo.com.br' });
  assert.strictEqual(deriveInput('cnpj-mcp', criteriaCtx).criteria.cnae, '6201');
  assert.strictEqual(deriveInput('searxng', criteriaCtx).query, 'Sistema 6201 SP');

  const cnpjCtx = { criteria: null, seed: { cnpj: COMPANY_CNPJ } };
  assert.deepStrictEqual(deriveInput('cnpj-mcp', cnpjCtx), { cnpj: COMPANY_CNPJ });
  assert.deepStrictEqual(deriveInput('jusbrasil', cnpjCtx), { cnpj: COMPANY_CNPJ });
  assert.deepStrictEqual(deriveInput('funding', cnpjCtx), { cnpj: COMPANY_CNPJ });

  // Sem semente aplicável → skipped
  assert.strictEqual(deriveInput('crtsh', { criteria: { state: 'SP' }, seed: null }), null);
  assert.strictEqual(deriveInput('searxng', { criteria: { state: 'SP' }, seed: null }), null);
  // Seed de domínio NÃO vira busca web (fontes distintas, sem correlação grátis)
  assert.strictEqual(deriveInput('searxng', domainCtx), null);
});

test('buildQuery: só arma query com elementos suficientes (evita busca lixo)', () => {
  assert.strictEqual(buildQuery({ criteria: { legalNameContains: 'Sistema', state: 'SP' } }), 'Sistema SP');
  assert.strictEqual(buildQuery({ criteria: { state: 'SP' } }), null);
  assert.strictEqual(buildQuery({ seed: { query: 'empresas de software' }, criteria: null }), 'empresas de software');
});
