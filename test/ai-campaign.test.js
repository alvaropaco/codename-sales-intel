'use strict';
const test = require('node:test');
const assert = require('node:assert');
const aiCampaign = require('../ai-campaign');
const { buildOrgContext } = require('../org-context');
const { validateTemplateMessage } = require('../whatsapp-utils');

// ── Fixtures ────────────────────────────────────────────────────────────────
function perfil(overrides = {}) {
  return buildOrgContext({
    orgName: 'Org Fall Back',
    settings: {
      orgId: 'org_1',
      companyName: 'MB Máquinas',
      valueProposition: 'corte e dobra de precisão para a indústria',
      ctaGoal: 'agendar uma conversa de 15 minutos',
      ...overrides,
    },
  });
}

// Frases que JAMAIS podem aparecer numa mensagem enviada ao lead (FR-002):
// instruções internas, público-alvo, contagens e metas do funil.
const FRASES_INTERNAS = [
  'pré-qualificados',
  'pré-qualificados por enriquecimento de CNPJ',
  'leads prontos para contato',
  'enriquecimento de CNPJ',
  'decisores dos',
  'Conduza o lead',
  'NUNCA invente',
  'Objetivo desta campanha',
];

function assertSemTextoInterno(texto, msg) {
  for (const frase of FRASES_INTERNAS) {
    assert.ok(!texto.includes(frase), `${msg}: não deve conter "${frase}" — recebido: "${texto}"`);
  }
}

// ── composeBaseFromProfile (WhatsApp) ───────────────────────────────────────

test('composeBaseFromProfile: identidade + proposta de valor, pronta para template', () => {
  const base = aiCampaign.composeBaseFromProfile(perfil());
  assert.ok(base, 'deve compor a base com perfil configurado');
  assert.ok(base.includes('MB Máquinas'), 'identidade da org presente');
  assert.ok(/corte e dobra de precisão/i.test(base), 'proposta de valor presente');
  assert.ok(base.includes('{{firstName}}'), 'placeholder de saudação suportado');
  assert.ok(base.includes('tudo bem?'), 'saudação presente');
  assertSemTextoInterno(base, 'base WhatsApp');
});

test('composeBaseFromProfile: ctaGoal (instrução interna) NUNCA entra no corpo', () => {
  const base = aiCampaign.composeBaseFromProfile(perfil());
  assert.ok(!base.includes('agendar uma conversa de 15 minutos'), 'ctaGoal é instrução, não corpo');
});

test('composeBaseFromProfile: perfil não configurado — modo estrito retorna null', () => {
  const org = buildOrgContext({ orgName: 'Sem Perfil Ltda', settings: {} });
  assert.strictEqual(org.configured, false);
  assert.strictEqual(aiCampaign.composeBaseFromProfile(org, { requireConfigured: true }), null);
});

test('composeBaseFromProfile: perfil não configurado — fluxo IA usa só identidade honesta', () => {
  const org = buildOrgContext({ orgName: 'Sem Perfil Ltda', settings: {} });
  const base = aiCampaign.composeBaseFromProfile(org);
  assert.ok(base, 'fluxo IA segue com identidade do org (sem inventar negócio)');
  assert.ok(base.includes('Sem Perfil Ltda'));
  assertSemTextoInterno(base, 'base sem perfil');
});

test('composeBaseFromProfile: sem nome de org não há o que compor', () => {
  const org = buildOrgContext({ orgName: null, settings: {} });
  assert.strictEqual(aiCampaign.composeBaseFromProfile(org), null);
});

test('composeBaseFromProfile: limita a 400 chars sem truncar placeholder', () => {
  const base = aiCampaign.composeBaseFromProfile(perfil({
    valueProposition: 'x'.repeat(500),
  }));
  assert.ok(base.length <= 400, `comprimento ${base.length} ≤ 400`);
  assert.ok(!/\{\{[^}]*$/.test(base), 'não pode terminar com placeholder aberto');
  assert.strictEqual(validateTemplateMessage(base).ok, true, 'base aprovada no guard de ingestão');
});

// ── composeEmailBaseFromProfile (email) ─────────────────────────────────────

test('composeEmailBaseFromProfile: subject + body do perfil', () => {
  const email = aiCampaign.composeEmailBaseFromProfile(perfil());
  assert.ok(email && email.subject && email.body);
  assert.ok(email.subject.length <= 78, `assunto curto (${email.subject.length} ≤ 78)`);
  assert.ok(email.body.includes('MB Máquinas'));
  assert.ok(email.body.includes('{{firstName}}'));
  assertSemTextoInterno(email.body, 'base email');
  assertSemTextoInterno(email.subject, 'subject email');
});

test('composeEmailBaseFromProfile: modo estrito sem perfil → null', () => {
  const org = buildOrgContext({ orgName: 'Sem Perfil Ltda', settings: {} });
  assert.strictEqual(aiCampaign.composeEmailBaseFromProfile(org, { requireConfigured: true }), null);
});

// ── Ciclo IA: criar → prévia → aprovar → disparar (US1 — T007) ─────────────

/**
 * Fake Prisma in-memory apenas com as operações usadas pelo ciclo IA
 * (padrão dos fakes do repo: test/whatsapp-engine.test.js). Suporta o
 * create aninhado de steps e includes básicos.
 */
function makeFakePrisma({ orgPlan = 'premium', settings, withEmail = true, withWa = true, prospects = null, aiCampaignsToday = 0 } = {}) {
  const db = { outreachCampaigns: [], waCampaigns: [], steps: [] };
  let seq = 0;
  const id = (p) => `${p}_${++seq}`;
  const flatMatch = (rec, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && v.constructor === Object && 'gte' in v) {
      return new Date(rec[k]) >= new Date(v.gte);
    }
    return rec[k] === v;
  });

  const org = { id: 'org_1', name: 'Org Fall Back', plan: orgPlan };
  const settingsRow = settings || { orgId: 'org_1', companyName: 'MB Máquinas', valueProposition: 'corte e dobra de precisão para a indústria', ctaGoal: 'agendar uma conversa de 15 minutos' };
  const prospectRows = prospects !== null
    ? prospects
    : [
        { id: 'pr_1', companyName: 'Metalúrgica Exemplo', contactName: 'Mariana', status: 'qualified', opportunityScore: 90, tradeName: null, industry: 'Metalurgia', city: ' Joinville', state: 'SC' },
        { id: 'pr_2', companyName: 'Transportes Alfa', contactName: null, status: 'qualified', opportunityScore: 80, tradeName: 'Alfa', industry: 'Transporte', city: 'Curitiba', state: 'PR' },
      ];

  const outreachCampaign = {
    rows: db.outreachCampaigns,
    async create({ data }) {
      const row = { approvedAt: null, createdAt: new Date(), ...data, id: id('oc') };
      db.outreachCampaigns.push(row);
      return row;
    },
    async findFirst({ where }) {
      return db.outreachCampaigns.find((r) => flatMatch(r, where)) || null;
    },
    async update({ where, data }) {
      const row = db.outreachCampaigns.find((r) => r.id === where.id);
      if (!row) throw new Error('campaign not found');
      return Object.assign(row, data);
    },
    async count({ where } = {}) {
      let n = aiCampaignsToday;
      for (const r of db.outreachCampaigns) {
        if (flatMatch(r, where)) n += 1;
      }
      return n;
    },
    findMany: async ({ where } = {}) => db.outreachCampaigns.filter((r) => flatMatch(r, where)),
  };

  const whatsAppCampaign = {
    async create({ data }) {
      const { steps, ...campaignData } = data;
      const row = { approvedAt: null, createdAt: new Date(), ...campaignData, id: id('wc') };
      db.waCampaigns.push(row);
      if (steps && steps.create) {
        const created = Array.isArray(steps.create) ? steps.create : [steps.create];
        for (const s of created) {
          db.steps.push({ ...s, campaignId: row.id, id: id('step') });
        }
      }
      return { ...row, steps: db.steps.filter((s) => s.campaignId === row.id) };
    },
    async findFirst({ where, include } = {}) {
      const row = db.waCampaigns.find((r) => flatMatch(r, where));
      if (!row) return null;
      return include && include.steps
        ? { ...row, steps: db.steps.filter((s) => s.campaignId === row.id) }
        : row;
    },
    async update({ where, data }) {
      const row = db.waCampaigns.find((r) => r.id === where.id);
      if (!row) throw new Error('wa campaign not found');
      return Object.assign(row, data);
    },
  };

  const whatsAppSequenceStep = {
    async findFirst({ where }) {
      return db.steps.find((s) => flatMatch(s, where)) || null;
    },
    async update({ where, data }) {
      const row = db.steps.find((s) => s.id === where.id);
      if (!row) throw new Error('step not found');
      return Object.assign(row, data);
    },
  };

  return {
    db,
    organization: { findUnique: async () => org },
    commercialSettings: { findUnique: async () => ({ ...settingsRow, orgId: 'org_1' }) },
    emailAccount: { findFirst: async () => (withEmail ? { id: 'ea_1', tenantId: 'org_1', status: 'connected' } : null) },
    whatsAppAccount: { findFirst: async () => (withWa ? { id: 'wa_1', orgId: 'org_1', status: 'CONNECTED' } : null) },
    prospect: { findMany: async () => prospectRows.map((p) => ({ ...p })) },
    outreachCampaign,
    whatsAppCampaign,
    whatsAppSequenceStep,
  };
}

async function assertCode(promise, code) {
  try {
    await promise;
    assert.fail(`deveria rejeitar com ${code}`);
  } catch (err) {
    assert.strictEqual(err.code, code, `esperado ${code}, veio ${err.code}: ${err.message}`);
  }
}

function makeLaunchSpies() {
  const calls = { outreach: [], whatsapp: [] };
  return {
    calls,
    launchers: {
      outreach: async (prisma, campaignId, prospectIds) => {
        calls.outreach.push({ campaignId, prospectIds });
        return { jobsQueued: prospectIds.length };
      },
      whatsapp: async (prisma, { campaignId, prospectIds }) => {
        calls.whatsapp.push({ campaignId, prospectIds });
        return { jobsQueued: prospectIds.length };
      },
    },
  };
}

test('US1 criação: grava bases compostas, NÃO dispara e responde pending_approval', async () => {
  const fake = makeFakePrisma();
  const result = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });

  assert.strictEqual(result.status, 'pending_approval');
  assert.ok(result.emailCampaignId, 'campanha email criada');
  assert.ok(result.whatsappCampaignId, 'campanha whatsapp criada');

  const email = fake.db.outreachCampaigns[0];
  assert.strictEqual(email.status, 'draft', 'email continua draft (não lançado)');
  assert.strictEqual(email.approvedAt, null);
  assert.ok(email.emailTemplateBody.includes('MB Máquinas'), 'base de email composta do perfil');
  assert.ok(!email.emailTemplateBody.includes('agendar uma conversa de 15 minutos'), 'ctaGoal fora do corpo');

  const wa = fake.db.waCampaigns[0];
  assert.strictEqual(wa.status, 'DRAFT', 'whatsapp continua DRAFT (não lançado)');
  assert.strictEqual(wa.approvedAt, null);
  const step = fake.db.steps.find((s) => s.campaignId === wa.id);
  assert.strictEqual(step.aiPersonalized, true);
  assert.ok(step.messageTemplate.includes('{{firstName}}'));
  assert.ok(!step.messageTemplate.includes('agendar uma conversa de 15 minutos'), 'ctaGoal (instrução) fora do corpo');
  assertSemTextoInterno(step.messageTemplate, 'step WhatsApp');

  // Nada enfileirado: status dos canais nunca saiu de draft/DRAFT e nenhum
  // evento de lançamento existe (o lançamento só ocorre no approve).
  assert.ok(result.preview, 'prévia presente');
  assert.ok(result.preview.sampleProspect.companyName);
  assert.ok(result.preview.whatsapp.message.includes('MB Máquinas'));
});

test('US1 approve: grava approvedAt e dispara os dois canais', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const { launchers, calls } = makeLaunchSpies();

  const result = await aiCampaign.approveAiCampaign(fake, {
    orgId: 'org_1',
    userId: 'u_1',
    outreachCampaignId: created.emailCampaignId,
    whatsappCampaignId: created.whatsappCampaignId,
  }, launchers);

  assert.strictEqual(result.status, 'launched');
  assert.strictEqual(result.enrolled.email, 2);
  assert.strictEqual(result.enrolled.whatsapp, 2);
  assert.strictEqual(calls.outreach.length, 1, 'startOutreachCampaign chamado 1x');
  assert.strictEqual(calls.whatsapp.length, 1, 'startCampaign chamado 1x');
  assert.strictEqual(calls.outreach[0].prospectIds.length, 2);
  const email = fake.db.outreachCampaigns.find((c) => c.id === created.emailCampaignId);
  const wa = fake.db.waCampaigns.find((c) => c.id === created.whatsappCampaignId);
  assert.ok(email.approvedAt instanceof Date);
  assert.ok(wa.approvedAt instanceof Date);
});

test('US1 approve: campanha já aprovada → 409 ALREADY_APPROVED', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const { launchers } = makeLaunchSpies();
  const args = {
    orgId: 'org_1', userId: 'u_1',
    outreachCampaignId: created.emailCampaignId,
    whatsappCampaignId: created.whatsappCampaignId,
  };
  await aiCampaign.approveAiCampaign(fake, args, launchers);
  await assertCode(aiCampaign.approveAiCampaign(fake, args, launchers), 'ALREADY_APPROVED');
});

test('US1 approve: edit com BLOCKLIST → 400 TEMPLATE_REJECTED', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const { launchers } = makeLaunchSpies();
  await assertCode(
    aiCampaign.approveAiCampaign(fake, {
      orgId: 'org_1', userId: 'u_1',
      outreachCampaignId: created.emailCampaignId,
      whatsappCampaignId: created.whatsappCampaignId,
      edits: { whatsappMessageTemplate: 'Olá {{firstName}}, temos desconto para a {{companyName}}!' },
    }, launchers),
    'TEMPLATE_REJECTED'
  );
});

test('US1 approve: edições válidas são aplicadas antes do disparo', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const { launchers } = makeLaunchSpies();
  await aiCampaign.approveAiCampaign(fake, {
    orgId: 'org_1', userId: 'u_1',
    outreachCampaignId: created.emailCampaignId,
    whatsappCampaignId: created.whatsappCampaignId,
    edits: {
      whatsappMessageTemplate: 'Olá {{firstName}}, aqui é a MB Máquinas, tudo bem?',
      emailTemplateSubject: 'Contato da MB Máquinas',
    },
  }, launchers);
  const step = fake.db.steps[0];
  assert.ok(step.messageTemplate.includes('aqui é a MB Máquinas'), 'edit aplicada no step');
  assert.strictEqual(fake.db.outreachCampaigns[0].emailTemplateSubject, 'Contato da MB Máquinas');
});

test('US1: org trial → 403 PREMIUM_REQUIRED na criação e na aprovação', async () => {
  const fake = makeFakePrisma({ orgPlan: 'trial' });
  await assertCode(
    aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' }),
    'PREMIUM_REQUIRED'
  );
  await assertCode(
    aiCampaign.approveAiCampaign(fake, { orgId: 'org_1', outreachCampaignId: 'x' }),
    'PREMIUM_REQUIRED'
  );
});

test('US1: limite diário de campanhas IA → 429 AI_CAMPAIGN_LIMIT', async () => {
  const fake = makeFakePrisma({ aiCampaignsToday: 3 });
  await assertCode(
    aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' }),
    'AI_CAMPAIGN_LIMIT'
  );
});

test('US1: sem leads qualificados → 400 NO_READY_LEADS', async () => {
  const fake = makeFakePrisma({ prospects: [] });
  await assertCode(
    aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' }),
    'NO_READY_LEADS'
  );
});

// ── Convergence T035: aprovação é caminho de disparo — retenção bloqueia ────

test('T035: campanha IA retida pelo saneamento (needsReview) → approve 409', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });

  // Simula a retenção do saneamento (sanitizeLegacyCampaigns) na campanha WA.
  const wa = fake.db.waCampaigns.find((c) => c.id === created.whatsappCampaignId);
  wa.needsReview = true;
  wa.reviewReason = 'synthetic_template_leak';

  const { launchers, calls } = makeLaunchSpies();
  await assertCode(
    aiCampaign.approveAiCampaign(fake, {
      orgId: 'org_1', userId: 'u_1',
      outreachCampaignId: created.emailCampaignId,
      whatsappCampaignId: created.whatsappCampaignId,
    }, launchers),
    'CAMPAIGN_REVIEW_REQUIRED'
  );
  assert.strictEqual(calls.whatsapp.length, 0, 'nenhum disparo com campanha retida');
  assert.strictEqual(calls.outreach.length, 0, 'nenhum canal lança quando o par é barrado');
});

test('T035: retenção na campanha de email também bloqueia o approve', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const email = fake.db.outreachCampaigns.find((c) => c.id === created.emailCampaignId);
  email.needsReview = true;
  email.reviewReason = 'synthetic_template_leak';

  const { launchers } = makeLaunchSpies();
  await assertCode(
    aiCampaign.approveAiCampaign(fake, {
      orgId: 'org_1', userId: 'u_1',
      outreachCampaignId: created.emailCampaignId,
      whatsappCampaignId: created.whatsappCampaignId,
    }, launchers),
    'CAMPAIGN_REVIEW_REQUIRED'
  );
});

test('T035: após rederivação limpar a retenção, o approve flui', async () => {
  const fake = makeFakePrisma();
  const created = await aiCampaign.createAndLaunchAiCampaign(fake, { orgId: 'org_1', userId: 'u_1' });
  const wa = fake.db.waCampaigns.find((c) => c.id === created.whatsappCampaignId);
  wa.needsReview = true;
  wa.reviewReason = 'synthetic_template_leak';

  // Rederivação regenera a base e limpa a retenção (sem reativar).
  await aiCampaign.rederiveWhatsAppBase(fake, { orgId: 'org_1', campaignId: created.whatsappCampaignId });
  assert.strictEqual(wa.needsReview, false);

  const { launchers, calls } = makeLaunchSpies();
  const result = await aiCampaign.approveAiCampaign(fake, {
    orgId: 'org_1', userId: 'u_1',
    outreachCampaignId: created.emailCampaignId,
    whatsappCampaignId: created.whatsappCampaignId,
  }, launchers);
  assert.strictEqual(result.status, 'launched');
  assert.strictEqual(calls.whatsapp.length, 1);
});
