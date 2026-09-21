'use strict';
const test = require('node:test');
const assert = require('node:assert');
const aiCampaign = require('../ai-campaign');
const { buildOrgContext } = require('../org-context');

const TEXTO_INCIDENTE = 'Olá {{firstName}}, tudo bem? Sou da Jefferson Torres. Obter resposta e agendar uma conversa curta (15 min) por WhatsApp com os decisores dos 249 leads pré-qualificados por enriquecimento de CNPJ.';

// ── detectSyntheticTemplate (detecção conservadora) ─────────────────────────

test('detect: texto do incidente é detectado como template sintético', () => {
  assert.strictEqual(
    aiCampaign.detectSyntheticTemplate(TEXTO_INCIDENTE, { objective: 'Obter resposta e agendar conversa' }),
    'synthetic_template_leak'
  );
});

test('detect: objetivo da campanha ecoado no template é detectado', () => {
  const objective = 'Agendar uma conversa de 15 minutos com os decisores da empresa para apresentar o diagnóstico gratuito do funil comercial';
  const template = `Olá {{firstName}}, tudo bem? ${objective}`;
  assert.strictEqual(aiCampaign.detectSyntheticTemplate(template, { objective }), 'synthetic_template_leak');
});

test('detect: template legítimo do tenant NUNCA é sinalizado (zero falso positivo)', () => {
  const legitimo = 'Olá {{firstName}}, tudo bem? A MB trabalha com corte e dobra industrial. Faz sentido conversarmos?';
  assert.strictEqual(
    aiCampaign.detectSyntheticTemplate(legitimo, { objective: 'Agendar reunião de diagnóstico técnico com amostra do material do cliente' }),
    null
  );
});

test('detect: objetivo curto (<30 chars) não dispara falso positivo', () => {
  assert.strictEqual(aiCampaign.detectSyntheticTemplate('Olá {{firstName}}, agendar', { objective: 'agendar' }), null);
});

// ── sanitizeLegacyCampaigns (rotina idempotente, FR-008) ────────────────────

function makeFakePrisma({ waCampaigns = [], emailCampaigns = [] } = {}) {
  const db = { wa: waCampaigns.map((c) => ({ needsReview: false, reviewReason: null, ...c })), email: emailCampaigns.map((c) => ({ needsReview: false, reviewReason: null, ...c })) };
  let seq = 0;
  db.steps = [];
  for (const c of db.wa) {
    for (const s of c._steps || []) db.steps.push({ ...s, campaignId: c.id, id: `step_${++seq}` });
  }
  const withSteps = (row) => ({ ...row, steps: db.steps.filter((s) => s.campaignId === row.id) });

  return {
    db,
    whatsAppCampaign: {
      async findMany({ where } = {}) {
        return db.wa.filter((r) => (!where || where.source === undefined || r.source === where.source)).map(withSteps);
      },
      async findFirst({ where } = {}) {
        const row = db.wa.find((r) => Object.entries(where || {}).every(([k, v]) => r[k] === v));
        return row ? withSteps(row) : null;
      },
      async update({ where, data }) {
        const row = db.wa.find((r) => r.id === where.id);
        assert.ok(row, 'campanha WA existe');
        return Object.assign(row, data);
      },
    },
    outreachCampaign: {
      async findMany({ where } = {}) {
        return db.email.filter((r) => (!where || where.source === undefined || r.source === where.source));
      },
      async findFirst({ where } = {}) {
        return db.email.find((r) => Object.entries(where || {}).every(([k, v]) => r[k] === v)) || null;
      },
      async update({ where, data }) {
        const row = db.email.find((r) => r.id === where.id);
        assert.ok(row, 'campanha email existe');
        return Object.assign(row, data);
      },
    },
    whatsAppSequenceStep: {
      async findFirst({ where } = {}) { return db.steps.find((s) => Object.entries(where).every(([k, v]) => s[k] === v)) || null; },
      async update({ where, data }) {
        const row = db.steps.find((s) => s.id === where.id);
        assert.ok(row);
        return Object.assign(row, data);
      },
    },
    organization: { async findUnique() { return { id: 'org_1', name: 'Org A', plan: 'premium' }; } },
    commercialSettings: {
      async findUnique() {
        return { orgId: 'org_1', companyName: 'MB Máquinas', valueProposition: 'corte e dobra de precisão' };
      },
    },
  };
}

function fixtureCampaigns() {
  return {
    waCampaigns: [
      {
        id: 'wa_poluída', orgId: 'org_1', status: 'RUNNING', source: 'ai',
        objective: 'Obter resposta e agendar uma conversa curta (15 min) por WhatsApp com os decisores',
        _steps: [{ orderIndex: 0, messageTemplate: TEXTO_INCIDENTE, aiPersonalized: true }],
      },
      {
        id: 'wa_legítima_manual', orgId: 'org_1', status: 'RUNNING', source: 'manual',
        objective: null,
        _steps: [{ orderIndex: 0, messageTemplate: 'Olá {{firstName}}, tudo bem?', aiPersonalized: false }],
      },
      {
        id: 'wa_outro_org', orgId: 'org_2', status: 'RUNNING', source: 'ai',
        objective: 'Apresentar a nova linha de produtos com amostras grátis para os clientes selecionados',
        _steps: [{ orderIndex: 0, messageTemplate: 'Olá {{firstName}}, lançamos uma linha nova. Posso enviar o catálogo?', aiPersonalized: false }],
      },
    ],
    emailCampaigns: [
      {
        id: 'em_poluída', tenantId: 'org_1', status: 'active', source: 'ai',
        objective: 'Apresentar o diagnóstico do funil com dados de 249 leads pré-qualificados',
        emailTemplateSubject: 'Diagnóstico',
        emailTemplateBody: 'Olá, Preparamos o diagnóstico com base nos 249 leads pré-qualificados da sua operação.',
      },
      {
        id: 'em_legítima', tenantId: 'org_1', status: 'active', source: 'ai',
        objective: 'Apresentar a nova linha de produtos',
        emailTemplateSubject: 'Novidades da MB',
        emailTemplateBody: 'Olá {{firstName}}, tudo bem? A MB lançou uma linha nova de serviços. Posso enviar o catálogo?',
      },
    ],
  };
}

test('sanitização: campanha IA poluída é retida (PAUSED + needsReview)', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  const stats = await aiCampaign.sanitizeLegacyCampaigns(fake);

  const poluida = fake.db.wa.find((c) => c.id === 'wa_poluída');
  assert.strictEqual(poluida.needsReview, true);
  assert.strictEqual(poluida.reviewReason, 'synthetic_template_leak');
  assert.strictEqual(poluida.status, 'PAUSED', 'campanha ativa é retida');
  assert.ok(stats.retained >= 1);
  // varredura cobre apenas campanhas source:'ai' (2 WA + 2 email); manuais
  // nem entram — zero risco de falso positivo.
  assert.strictEqual(stats.scanned, 4);
});

test('sanitização: campanha manual e template legítimo NUNCA são alterados', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  await aiCampaign.sanitizeLegacyCampaigns(fake);

  const manual = fake.db.wa.find((c) => c.id === 'wa_legítima_manual');
  assert.strictEqual(manual.needsReview, false, 'manual intocada');
  assert.strictEqual(manual.status, 'RUNNING', 'manual segue ativa');

  const legitima = fake.db.email.find((c) => c.id === 'em_legítima');
  assert.strictEqual(legitima.needsReview, false, 'email legítimo intocado');
  assert.strictEqual(legitima.status, 'active');
});

test('sanitização: idempotente — segunda execução não muda nada', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  const first = await aiCampaign.sanitizeLegacyCampaigns(fake);
  const poluida = fake.db.wa.find((c) => c.id === 'wa_poluída');
  const snapshot = { ...poluida };
  const second = await aiCampaign.sanitizeLegacyCampaigns(fake);

  assert.ok(first.retained > 0);
  assert.ok(second.retained === 0, 'nada novo retido na 2ª execução');
  assert.deepStrictEqual(
    { needsReview: poluida.needsReview, status: poluida.status },
    { needsReview: snapshot.needsReview, status: snapshot.status }
  );
});

// ── rederivação (atalho de revalidação da Q2) ───────────────────────────────

test('rederiva WhatsApp: regenera base do perfil, limpa needsReview e MANTÉM pausa', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  await aiCampaign.sanitizeLegacyCampaigns(fake);
  const poluida = fake.db.wa.find((c) => c.id === 'wa_poluída');
  // reativação simulada para testar rederive em campanha retida
  poluida.status = 'PAUSED';

  const result = await aiCampaign.rederiveWhatsAppBase(fake, { orgId: 'org_1', campaignId: 'wa_poluída' });

  assert.strictEqual(result.needsReview, false);
  assert.ok(result.messageTemplate.includes('MB Máquinas'));
  assertSemTextoInterno(result.messageTemplate);
  assert.strictEqual(poluida.status, 'PAUSED', 'rederivação NÃO reativa a campanha');

  function assertSemTextoInterno(texto) {
    assert.ok(!/pré-qualificados|leads prontos|decisores dos/i.test(texto), 'sem texto interno');
  }
});

test('rederiva WhatsApp: campanha de outro org → 404 (isolamento)', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  await assertRejectsCode(
    aiCampaign.rederiveWhatsAppBase(fake, { orgId: 'org_9', campaignId: 'wa_poluída' }),
    'CAMPAIGN_NOT_FOUND'
  );
});

test('rederiva email: sem perfil configurado → 409 NO_PROFILE_CONTEXT', async () => {
  const fake = makeFakePrisma(fixtureCampaigns());
  await aiCampaign.sanitizeLegacyCampaigns(fake);
  fake.commercialSettings = { async findUnique() { return null; } };
  await assertRejectsCode(
    aiCampaign.rederiveEmailBase(fake, { orgId: 'org_1', campaignId: 'em_poluída' }),
    'NO_PROFILE_CONTEXT'
  );
});

async function assertRejectsCode(promise, code) {
  try {
    await promise;
    assert.fail(`deveria rejeitar com ${code}`);
  } catch (err) {
    assert.strictEqual(err.code, code, `esperado ${code}, veio ${err.code}: ${err.message}`);
  }
}

// sanity: o contexto das fixtures compõe base válida
test('sanity: fixture de perfil compõe base lead-facing', () => {
  const ctx = buildOrgContext({ orgName: 'Org A', settings: { companyName: 'MB Máquinas', valueProposition: 'corte e dobra de precisão' } });
  const base = aiCampaign.composeBaseFromProfile(ctx, { requireConfigured: true });
  assert.ok(base && base.includes('MB Máquinas'));
});
