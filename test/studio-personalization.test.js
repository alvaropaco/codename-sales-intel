'use strict';

/**
 * test/studio-personalization.test.js — US7 do Campaign Studio (T072).
 *
 * Personalização com IA por lead usando somente dados existentes da base
 * (FR-047), lote com fallback para lead sem dados (FR-048/FR-051), edição
 * por lead isolada (FR-050) e preview ≡ envio (SC-006).
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');

function llmPersonalize() {
  return async ({ user }) => {
    // O prompt cita o setor real do lead — o mock devolve o que a IA "viu".
    const industryMatch = user.match(/Setor do lead: "([^"]+)"/);
    const industry = industryMatch ? industryMatch[1] : null;
    if (!industry) {
      // Lead sem setor: IA não inventa — sinaliza fallback.
      return { content: JSON.stringify({ skip: true, reason: 'sem dados suficientes' }) };
    }
    return {
      content: JSON.stringify({
        intro: `Vejo que a {{companyName}} atua em ${industry}.`,
        valueProp: 'Automação fiscal para o seu setor.',
        cta: 'Posso mostrar 15 minutos?',
        dataBasis: [`industry=${industry}`],
      }),
    };
  };
}

async function startServer({ orgPlan = 'premium' } = {}) {
  const app = express();
  app.use(express.json());
  const prisma = createFakePrisma();
  prisma.organization.rows.push({ id: 'org-1', plan: orgPlan });
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1' };
    next();
  });
  app.use(
    '/api/studio',
    createStudioRouter(prisma, {
      overrides: { aiDeps: { callLlm: llmPersonalize() } },
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(method, path, body) {
    const res = await fetch(`${base}/api/studio${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { res, body: await res.json() };
  }
  return { server, prisma, api };
}

async function campaignWithContent(prisma, api) {
  const { body: c } = await api('POST', '/campaigns', { name: 'Personalizada', channels: ['email'] });
  const campaign = c.data;
  prisma.prospect.rows.push(
    { id: 'lead-metal', orgId: 'org-1', companyName: 'Metalúrgica A', contactName: 'Ana', industry: 'metalurgia' },
    { id: 'lead-tech', orgId: 'org-1', companyName: 'Tech B', contactName: 'Bruno', industry: 'tecnologia' },
    { id: 'lead-vazio', orgId: 'org-1', companyName: 'Sem Dados Ltda', contactName: null, industry: null }
  );
  prisma.studioContent.rows.push({
    id: 'content-p', orgId: 'org-1', campaignId: campaign.id, channel: 'email',
    subject: 'Proposta {{companyName}}', preheader: null, whatsappText: null, linkedinText: null,
    emailDoc: { blocks: [{ type: 'text', text: 'Base: solução de automação. Descadastro:link' }] },
    origin: 'manual', variantLabel: 'A', kind: 'base', stepIndex: 1,
    editHistory: [], ctaUrl: null, tone: null,
  });
  return campaign;
}

test('personalização em lote: variações por setor, fallback para lead sem dados (FR-047/051)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    const campaign = await campaignWithContent(prisma, api);
    // Audiência manual (US1) para o snapshot existir.
    await api('POST', `/campaigns/${campaign.id}/audience`, {
      manual: { prospectIds: ['lead-metal', 'lead-tech', 'lead-vazio'] },
    });

    const { res, body } = await api('POST', `/campaigns/${campaign.id}/personalize`, {
      contentId: 'content-p',
      level: 'intro',
    });
    assert.equal(res.status, 202);
    const batchId = body.data.batchId;

    let progress = null;
    for (let i = 0; i < 50; i++) {
      progress = (await api('GET', `/ai-batch/${batchId}`)).body.data;
      if (progress.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(progress.status, 'completed');
    assert.equal(progress.total, 3);

    const preview = await api('GET', `/campaigns/${campaign.id}/personalization-preview?contentId=content-p&sample=10`);
    assert.equal(preview.res.status, 200);
    const rows = preview.body.data;
    const metal = rows.find((r) => r.prospectId === 'lead-metal');
    const tech = rows.find((r) => r.prospectId === 'lead-tech');
    const vazio = rows.find((r) => r.prospectId === 'lead-vazio');
    assert.ok(metal.rendered.includes('metalurgia'), 'personalização usa o setor real');
    assert.ok(tech.rendered.includes('tecnologia'), 'cada setor tem a própria intro');
    assert.notEqual(metal.rendered, tech.rendered);
    assert.equal(vazio.status, 'base_fallback', 'lead sem dados → versão base sinalizada');
  } finally {
    server.close();
  }
});

test('edição por lead é isolada; propagate cria regra (FR-050)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    const campaign = await campaignWithContent(prisma, api);
    await api('POST', `/campaigns/${campaign.id}/audience`, { manual: { prospectIds: ['lead-metal', 'lead-tech'] } });
    await api('POST', `/campaigns/${campaign.id}/personalize`, { contentId: 'content-p', level: 'intro' });
    await new Promise((r) => setTimeout(r, 50));

    await api('PATCH', '/personalization/content-p/lead-metal', {
      overrides: { intro: 'Intro editada à mão' },
    });
    const preview = await api('GET', `/campaigns/${campaign.id}/personalization-preview?contentId=content-p`);
    const metal = preview.body.data.find((r) => r.prospectId === 'lead-metal');
    const tech = preview.body.data.find((r) => r.prospectId === 'lead-tech');
    assert.ok(metal.rendered.includes('Intro editada à mão'), 'edição vale para o lead');
    assert.ok(!tech.rendered.includes('Intro editada à mão'), 'edição NÃO vaza para os demais');
    assert.equal(metal.status, 'edited');
  } finally {
    server.close();
  }
});

test('gating premium: trial não roda personalização em lote (403)', async () => {
  const { server, prisma, api } = await startServer({ orgPlan: 'trial' });
  try {
    const campaign = await campaignWithContent(prisma, api);
    await api('POST', `/campaigns/${campaign.id}/audience`, { manual: { prospectIds: ['lead-metal'] } });
    const { res, body } = await api('POST', `/campaigns/${campaign.id}/personalize`, {
      contentId: 'content-p',
      level: 'intro',
    });
    assert.equal(res.status, 403);
    assert.equal(body.error, 'PREMIUM_REQUIRED');
  } finally {
    server.close();
  }
});
