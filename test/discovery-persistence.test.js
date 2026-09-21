const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createDiscoveryPersistence, stableHash } = require('../discovery/persistence');
const normalizer = require('../discovery/normalizer');

function makePersistence() {
  const prisma = createFakePrisma();
  let tick = 0;
  const persistence = createDiscoveryPersistence({
    prisma,
    now: () => new Date(1726900000000 + (tick += 1000)),
  });
  return { prisma, persistence };
}

// ── Job lifecycle (SC-001) ──────────────────────────────────────────────────

test('job: falha de provider NÃO falha o job — vira partial (SC-001)', async () => {
  const { persistence } = makePersistence();
  const job = await persistence.createJob({
    orgId: 'org-1',
    trigger: 'api',
    criteria: { cnae: '6201' },
    providerConfig: { searxng: { enabled: true }, crtsh: { enabled: true } },
  });
  await persistence.startJob(job.id, 'org-1');
  await persistence.startRun({ orgId: 'org-1', jobId: job.id, provider: 'searxng', capability: 'web.search' });
  await persistence.startRun({ orgId: 'org-1', jobId: job.id, provider: 'crtsh', capability: 'digital.domains' });

  await persistence.finishRun({ orgId: 'org-1', jobId: job.id, provider: 'searxng', status: 'completed', items: 5 });
  await persistence.finishRun({
    orgId: 'org-1', jobId: job.id, provider: 'crtsh', status: 'failed',
    errorCode: 'TIMEOUT', errorMessage: 'crt.sh não respondeu',
  });

  const status = await persistence.getJobStatus(job.id, 'org-1');
  assert.strictEqual(status.job.status, 'partial');
  assert.strictEqual(status.job.providersDone, 1);
  assert.strictEqual(status.job.providersFailed, 1);
  assert.strictEqual(status.job.itemsFound, 5);
  assert.strictEqual(status.providers.length, 2);
});

test('job: todos os providers completam → completed', async () => {
  const { persistence } = makePersistence();
  const job = await persistence.createJob({
    orgId: 'org-1', trigger: 'api',
    criteria: { seed: { domain: 'exemplo.com.br' } },
    providerConfig: { 'dns-rdap': { enabled: true } },
  });
  await persistence.startJob(job.id, 'org-1');
  await persistence.startRun({ orgId: 'org-1', jobId: job.id, provider: 'dns-rdap', capability: 'digital.infrastructure' });
  await persistence.finishRun({ orgId: 'org-1', jobId: job.id, provider: 'dns-rdap', status: 'completed', items: 2 });
  const status = await persistence.getJobStatus(job.id, 'org-1');
  assert.strictEqual(status.job.status, 'completed');
});

test('job: reconfigurar provider não duplica run (unique jobId+provider)', async () => {
  const { persistence } = makePersistence();
  const job = await persistence.createJob({
    orgId: 'org-1', trigger: 'api', criteria: {},
    providerConfig: { searxng: { enabled: true } },
  });
  await persistence.startRun({ orgId: 'org-1', jobId: job.id, provider: 'searxng', capability: 'web.search' });
  await persistence.startRun({ orgId: 'org-1', jobId: job.id, provider: 'searxng', capability: 'web.search' });
  const status = await persistence.getJobStatus(job.id, 'org-1');
  assert.strictEqual(status.providers.length, 1);
  assert.strictEqual(status.providers[0].attempt, 2);
});

// ── Isolamento por organização ──────────────────────────────────────────────

test('tenant isolation: job de outra org é invisível', async () => {
  const { persistence } = makePersistence();
  const job = await persistence.createJob({
    orgId: 'org-a', trigger: 'api', criteria: {}, providerConfig: {},
  });
  assert.strictEqual(await persistence.getJob(job.id, 'org-b'), null);
  assert.strictEqual(await persistence.getJobStatus(job.id, 'org-b'), null);
});

// ── Entidade canônica (SC-002/SC-005) ───────────────────────────────────────

test('entity: mesma canonicalKey consolida; atributos fundem; confiança = máx', async () => {
  const { prisma, persistence } = makePersistence();
  const key = normalizer.canonicalKey('company', '11.222.333/0001-81');
  const first = await persistence.upsertEntity({
    orgId: 'org-1', type: 'company', canonicalKey: key,
    displayName: 'Empresa Exemplo', attributes: { cnae: '6201' }, confidence: 0.98,
  });
  const second = await persistence.upsertEntity({
    orgId: 'org-1', type: 'company', canonicalKey: key,
    attributes: { porte: 'DEMAIS' }, confidence: 0.72,
  });
  assert.strictEqual(first.id, second.id);
  assert.strictEqual(second.attributes.cnae, '6201');
  assert.strictEqual(second.attributes.porte, 'DEMAIS');
  assert.strictEqual(second.confidence, 0.98);
  assert.strictEqual(prisma.discoveryEntity.rows.length, 1);
});

test('entity: tipos diferentes com mesmo valor NÃO colidem', async () => {
  const { prisma, persistence } = makePersistence();
  const key = 'host:exemplo.com.br';
  await persistence.upsertEntity({ orgId: 'org-1', type: 'domain', canonicalKey: key });
  await persistence.upsertEntity({ orgId: 'org-1', type: 'subdomain', canonicalKey: key });
  assert.strictEqual(prisma.discoveryEntity.rows.length, 2);
});

// ── Evidência imutável (SC-005) ─────────────────────────────────────────────

test('evidence: redelivery da mesma observação não duplica (rawHash)', async () => {
  const { prisma, persistence } = makePersistence();
  const observation = {
    orgId: 'org-1', evidenceType: 'official_registry', sourceProvider: 'cnpj-mcp',
    observedValue: { capitalSocial: 100000 }, sourceRef: 'cnpj:11222333000181',
    confidence: 0.98,
  };
  const first = await persistence.addEvidence(observation);
  const replay = await persistence.addEvidence(observation);
  assert.strictEqual(first.duplicated, false);
  assert.strictEqual(replay.duplicated, true);
  assert.strictEqual(first.evidence.id, replay.evidence.id);
  assert.strictEqual(prisma.discoveryEvidence.rows.length, 1);
  assert.strictEqual(prisma.discoveryEvidence.rows[0].rawHash, stableHash({
    sourceProvider: 'cnpj-mcp', evidenceType: 'official_registry',
    observedValue: { capitalSocial: 100000 }, sourceRef: 'cnpj:11222333000181',
  }));
});

test('evidence: observações CONFLITANTES coexistem (FR-025)', async () => {
  const { prisma, persistence } = makePersistence();
  await persistence.addEvidence({
    orgId: 'org-1', evidenceType: 'estimated', sourceProvider: 'funding',
    observedValue: { revenue: '10-50M' }, confidence: 0.6,
  });
  await persistence.addEvidence({
    orgId: 'org-1', evidenceType: 'reported', sourceProvider: 'cnpj-mcp',
    observedValue: { revenue: '10-50M' }, confidence: 0.98,
  });
  assert.strictEqual(prisma.discoveryEvidence.rows.length, 2);
});

// ── Relação ─────────────────────────────────────────────────────────────────

test('relationship: dedup por (org, from, to, type); confiança = máx', async () => {
  const { prisma, persistence } = makePersistence();
  await persistence.upsertEntity({ orgId: 'org-1', type: 'company', canonicalKey: 'cnpj:11222333000181' });
  await persistence.upsertEntity({ orgId: 'org-1', type: 'domain', canonicalKey: 'host:exemplo.com.br' });
  const [company, domain] = prisma.discoveryEntity.rows;

  await persistence.upsertRelationship({
    orgId: 'org-1', fromEntityId: company.id, toEntityId: domain.id,
    type: 'HAS_DOMAIN', confidence: 0.72,
  });
  await persistence.upsertRelationship({
    orgId: 'org-1', fromEntityId: company.id, toEntityId: domain.id,
    type: 'HAS_DOMAIN', confidence: 0.9,
  });
  assert.strictEqual(prisma.discoveryRelationship.rows.length, 1);
  assert.strictEqual(prisma.discoveryRelationship.rows[0].confidence, 0.9);
  // self-loop é rejeitado
  assert.strictEqual(
    await persistence.upsertRelationship({ orgId: 'org-1', fromEntityId: company.id, toEntityId: company.id, type: 'X' }),
    null
  );
});

// ── Candidato (T044 parcial) ────────────────────────────────────────────────

test('candidate: dedup por dedupeKey e import idempotente', async () => {
  const { prisma, persistence } = makePersistence();
  const job = await persistence.createJob({ orgId: 'org-1', trigger: 'api', criteria: {}, providerConfig: {} });
  const key = normalizer.canonicalKey('company', '11222333000181');
  const first = await persistence.upsertCandidate({
    orgId: 'org-1', jobId: job.id, cnpj: '11222333000181', name: 'Empresa Exemplo',
    confidence: 0.9, dedupeKey: key, evidenceCount: 3,
  });
  const again = await persistence.upsertCandidate({
    orgId: 'org-1', jobId: 'outro-job', domain: 'exemplo.com.br',
    confidence: 0.7, dedupeKey: key, evidenceCount: 1,
  });
  assert.strictEqual(first.id, again.id);
  assert.strictEqual(again.cnpj, '11222333000181'); // primeiro vínculo preservado
  assert.strictEqual(again.confidence, 0.9); // máx, não média nem sobrescrita
  assert.strictEqual(prisma.discoveryCandidate.rows.length, 1);

  await persistence.importCandidate({ orgId: 'org-1', candidateId: first.id, prospectId: 'pros-1' });
  await persistence.importCandidate({ orgId: 'org-1', candidateId: first.id, prospectId: 'pros-2' });
  assert.strictEqual(prisma.discoveryCandidate.rows[0].importedProspectId, 'pros-1');
});

test('candidate: listagem pagina e filtra por confiança mínima', async () => {
  const { persistence } = makePersistence();
  const job = await persistence.createJob({ orgId: 'org-1', trigger: 'api', criteria: {}, providerConfig: {} });
  for (let i = 0; i < 5; i++) {
    await persistence.upsertCandidate({
      orgId: 'org-1', jobId: job.id, name: `Cand ${i}`,
      confidence: i / 10, dedupeKey: `name:hash-${i}`,
    });
  }
  const page1 = await persistence.listCandidates({ orgId: 'org-1', minConfidence: 0.3, pageSize: 2 });
  assert.strictEqual(page1.total, 2);
  assert.strictEqual(page1.items.length, 2);
});

// ── Sinal derivado (T037) ───────────────────────────────────────────────────

test('signal: upsert por (org, entidade, tipo) substitui valor — evidência fica intacta', async () => {
  const { persistence } = makePersistence();
  const entity = await persistence.upsertEntity({
    orgId: 'org-1', type: 'company', canonicalKey: 'cnpj:11222333000181',
  });
  await persistence.upsertSignal({
    orgId: 'org-1', companyEntityId: entity.id, type: 'recent_funding',
    value: { round: 'Serie A' }, confidence: 0.8, evidenceIds: ['ev-1'],
  });
  const updated = await persistence.upsertSignal({
    orgId: 'org-1', companyEntityId: entity.id, type: 'recent_funding',
    value: { round: 'Serie B' }, confidence: 0.85, evidenceIds: ['ev-2'],
  });
  assert.strictEqual(updated.value.round, 'Serie B');
  assert.strictEqual(updated.confidence, 0.85);
});

// ── Observação completa (entidade + evidência + relações) ───────────────────

test('recordObservation: entidade, evidência e relações num passo idempotente', async () => {
  const { prisma, persistence } = makePersistence();
  const domainEntity = await persistence.upsertEntity({
    orgId: 'org-1', type: 'domain', canonicalKey: 'host:exemplo.com.br',
  });
  const input = {
    orgId: 'org-1', jobId: 'job-1', providerRunId: 'run-1',
    entityType: 'company',
    canonicalKey: normalizer.canonicalKey('company', '11222333000181'),
    displayName: 'Empresa Exemplo',
    attributes: { capitalSocial: 100000 },
    evidence: {
      evidenceType: 'official_registry', sourceProvider: 'cnpj-mcp',
      observedValue: { capitalSocial: 100000 }, confidence: 0.98,
      relationships: [{ toEntityId: domainEntity.id, type: 'HAS_DOMAIN' }],
    },
  };
  const first = await persistence.recordObservation(input);
  const replay = await persistence.recordObservation(input);

  assert.ok(first.entity);
  assert.strictEqual(replay.entity.id, first.entity.id);
  assert.strictEqual(prisma.discoveryEntity.rows.length, 2);
  assert.strictEqual(prisma.discoveryEvidence.rows.length, 1); // dedup por hash
  assert.strictEqual(prisma.discoveryRelationship.rows.length, 1);
});
