'use strict';

/**
 * test/studio-materials.test.js — US4 do Campaign Studio (specs/010, T042).
 *
 * Campaign from Material/URL/Prompt: extração confirmada pelo usuário
 * (FR-024), pacote de campanha multicanal com ≥2 tons em revisão (FR-025/026),
 * falhas explicáveis (FR-029) e gating premium (decisão de clarify).
 * LLM e parsers são injetados (padrão DI do repo) — nada de rede nos testes.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');

const EXTRACTION_OK = {
  product: 'ERP industrial',
  offer: 'implantação em 30 dias',
  benefits: ['integração fiscal', 'app de chão de fábrica'],
  audience: 'indústrias de médio porte',
  cta: 'agendar demonstração',
  confidence: 0.9,
};

// LLM fake: responde extração e composição por tom (JSON em string).
// Mesma assinatura do llm-client: ({system, user}) → {content}.
function fakeLlm() {
  const calls = [];
  const fn = async ({ system, user }) => {
    calls.push({ system, user });
    const prompt = `${system || ''} ${user || ''}`;
    if (prompt.includes('extração')) {
      return { content: JSON.stringify(EXTRACTION_OK) };
    }
    // Compose: deriva o tom do prompt para provar adaptação real por canal/ton.
    const tone = prompt.includes('"formal"') ? 'formal' : prompt.includes('"urgente"') ? 'urgente' : 'comercial';
    return {
      content: JSON.stringify({
        title: `Campanha ${tone}`,
        email: {
          subject: `Assunto ${tone} para {{companyName}}`,
          preheader: `Pré-header ${tone}`,
          blocks: [
            { type: 'text', text: `Proposta ${tone} para {{firstName}} da {{companyName}}.` },
            { type: 'button', label: 'Agendar', url: 'https://exemplo.com' },
          ],
        },
        whatsapp: { text: `Mensagem curta ${tone} para {{firstName}}: quer ver o ERP?` },
        linkedinText: `Texto LinkedIn ${tone}`,
        suggestedSegment: {
          criteria: { version: 1, groups: [{ op: 'AND', conditions: [{ field: 'industry', op: 'contains', value: 'indústria' }] }] },
          rationale: 'público industrial do material',
        },
        timing: 'terça a quinta, 9h–11h',
      }),
    };
  };
  fn.calls = calls;
  return fn;
}

async function startServer({ orgPlan = 'premium' } = {}) {
  const app = express();
  app.use(express.json());
  const prisma = createFakePrisma();
  prisma.organization.rows.push({ id: 'org-1', plan: orgPlan, name: 'Org' });

  const llm = fakeLlm();
  const fetchImpl = async (url) => {
    if (String(url).includes('quebrado')) {
      throw new Error('ENOTFOUND');
    }
    return {
      ok: true,
      status: 200,
      text: async () => '<html><body><h1>ERP Industrial 3000</h1><p>Oferta de lançamento</p></body></html>',
    };
  };

  // Injeta os deps de IA/parsers no router (padrão DI do repo).
  const { createStudioRouter } = require('../studio/router');
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1' };
    next();
  });
  app.use(
    '/api/studio',
    createStudioRouter(prisma, {
      overrides: {
        aiDeps: {
          callLlm: llm,
          pdfParse: async () => ({ text: 'PDF ERP industrial oferta de lançamento agendar demonstração' }),
          docxExtract: async () => ({ text: 'DOCX ERP industrial' }),
          fetchImpl,
        },
      },
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
  async function createCampaign(channels = ['email', 'whatsapp']) {
    const { body } = await api('POST', '/campaigns', { name: 'Campanha', channels });
    return body.data;
  }
  return { server, prisma, api, createCampaign, llm };
}

test('URL: extração por IA retorna produto/oferta/benefícios/público/CTA para confirmação (FR-024)', async () => {
  const { server, api } = await startServer();
  try {
    const created = await api('POST', '/materials', { url: 'https://exemplo.com/produto' });
    assert.equal(created.res.status, 201);
    assert.equal(created.body.data.kind, 'url');
    assert.equal(created.body.data.extractionStatus, 'pending');

    const extracted = await api('POST', `/materials/${created.body.data.id}/extract`);
    assert.equal(extracted.res.status, 200);
    assert.equal(extracted.body.data.extractionStatus, 'extracted');
    assert.equal(extracted.body.data.extraction.product, 'ERP industrial');
    assert.ok(Array.isArray(extracted.body.data.extraction.benefits));
    assert.equal(extracted.body.data.extraction.confirmedAt, null, 'aguarda confirmação humana');
  } finally {
    server.close();
  }
});

test('URL inacessível → falha explicável, sem geração silenciosa (FR-029/edge case)', async () => {
  const { server, api } = await startServer();
  try {
    const created = await api('POST', '/materials', { url: 'https://quebrado.exemplo.com' });
    const extracted = await api('POST', `/materials/${created.body.data.id}/extract`);
    assert.equal(extracted.res.status, 200);
    assert.equal(extracted.body.data.extractionStatus, 'failed');
    assert.ok(extracted.body.data.extractionError, 'motivo explicável presente');
  } finally {
    server.close();
  }
});

test('vídeo sem transcrição → needs_manual com pedido de descrição (limite v1 documentado)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    const created = await api('POST', '/materials', {
      kind: 'video',
      description: 'Vídeo de demonstração do ERP para indústrias',
    });
    const extracted = await api('POST', `/materials/${created.body.data.id}/extract`);
    assert.equal(extracted.res.status, 200);
    assert.equal(extracted.body.data.extractionStatus, 'needs_manual');
  } finally {
    server.close();
  }
});

test('compose exige confirmação da extração; sem confirmar → 409 EXTRACTION_NOT_CONFIRMED', async () => {
  const { server, api, createCampaign } = await startServer();
  try {
    const campaign = await createCampaign();
    const material = await api('POST', '/materials', { url: 'https://exemplo.com/produto' });
    await api('POST', `/materials/${material.body.data.id}/extract`);

    const compose = await api('POST', `/campaigns/${campaign.id}/compose`, {
      materialId: material.body.data.id,
      tones: ['formal', 'urgente'],
      variants: 2,
    });
    assert.equal(compose.res.status, 409);
    assert.equal(compose.body.error, 'EXTRACTION_NOT_CONFIRMED');
  } finally {
    server.close();
  }
});

test('compose feliz: ≥2 tons × canais distintos, campanha em revisão, adaptação real (FR-025/026)', async () => {
  const { server, prisma, api, createCampaign, llm } = await startServer();
  try {
    const campaign = await createCampaign(['email', 'whatsapp']);
    const material = await api('POST', '/materials', { url: 'https://exemplo.com/produto' });
    await api('POST', `/materials/${material.body.data.id}/extract`);
    await api('POST', `/materials/${material.body.data.id}/confirm`);

    const t0 = Date.now();
    const compose = await api('POST', `/campaigns/${campaign.id}/compose`, {
      materialId: material.body.data.id,
      tones: ['formal', 'urgente'],
    });
    const durationMs = Date.now() - t0;
    assert.equal(compose.res.status, 202, 'compose é assíncrono (202 + polling)');
    assert.ok(compose.body.data.batchId);

    // Polling até concluir (executor inline nos testes).
    let progress = null;
    for (let i = 0; i < 50; i++) {
      progress = (await api('GET', `/ai-batch/${compose.body.data.batchId}`)).body.data;
      if (progress.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(progress.status, 'completed');
    // SC-005: teto de regressão de latência do pipeline (com LLM mock).
    assert.ok(durationMs < 5000, `compose lento: ${durationMs}ms`);

    const detail = await api('GET', `/campaigns/${campaign.id}`);
    const contents = detail.body.data.contents.filter((c) => c.kind === 'base');
    const tones = new Set(contents.map((c) => c.tone));
    assert.ok(tones.has('formal') && tones.has('urgente'), '≥2 tons gerados');
    const formal = contents.find((c) => c.tone === 'formal');
    const urgent = contents.find((c) => c.tone === 'urgente');
    assert.ok(formal && urgent);
    const emailFormal = contents.find((c) => c.tone === 'formal' && c.channel === 'email');
    const waFormal = contents.find((c) => c.tone === 'formal' && c.channel === 'whatsapp');
    assert.ok(emailFormal.subject.includes('formal'), 'assunto adapta o tom');
    assert.notEqual(emailFormal.subject, waFormal.whatsappText, 'e-mail ≠ WhatsApp (adaptação por canal, FR-026)');
    assert.ok(waFormal.whatsappText.length < 500, 'mensagem WA curta (adaptação por canal)');
    assert.equal(detail.body.data.status, 'in_review', 'pacote cai em REVISÃO, nunca dispara (FR-002)');
    assert.ok(llm.calls.length >= 3, 'LLM chamado para extração + por variante/tom');
  } finally {
    server.close();
  }
});

test('gating premium: org trial não extrai nem compõe com IA (403 PREMIUM_REQUIRED)', async () => {
  const { server, api } = await startServer({ orgPlan: 'trial' });
  try {
    const material = await api('POST', '/materials', { url: 'https://exemplo.com/produto' });
    const extracted = await api('POST', `/materials/${material.body.data.id}/extract`);
    assert.equal(extracted.res.status, 403);
    assert.equal(extracted.body.error, 'PREMIUM_REQUIRED');
  } finally {
    server.close();
  }
});

test('variação de campanha (FR-028): duplicata nasce rascunho vinculado, original intocada', async () => {
  const { server, prisma, api, createCampaign } = await startServer();
  try {
    const original = await createCampaign(['email']);
    prisma.studioCampaign.rows[0].objective = 'objetivo original';

    const { res, body } = await api('POST', '/campaigns', {
      name: 'Variação reativação',
      channels: ['email'],
      duplicateOf: original.id,
      origin: 'duplicate',
    });
    assert.equal(res.status, 201);
    assert.equal(body.data.status, 'draft', 'variação nasce rascunho');
    assert.equal(body.data.sourceCampaignId, original.id);

    assert.equal(
      prisma.studioCampaign.rows.find((c) => c.id === original.id).objective,
      'objetivo original',
      'original nunca é alterada'
    );
  } finally {
    server.close();
  }
});
