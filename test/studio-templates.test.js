'use strict';

/**
 * test/studio-templates.test.js — US13 do Campaign Studio (T122).
 * CRUD da biblioteca, sementes do sistema por objetivo/estágio, duplicação
 * vinculada sem alterar a original e tradução que preserva variáveis/links.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');
const { createWriter } = require('../studio/ai/write');

test('tradução preserva variáveis {{}} e links (US13/FR-028)', async () => {
  const writer = createWriter({
    callLlm: async () => ({
      content: JSON.stringify({
        text: 'Hello {{firstName}}, check https://exemplo.com?foo=1 for the offer and do the opt-out if needed.',
      }),
    }),
  });
  const result = await writer.translateText({
    text: 'Olá {{firstName}}, veja https://exemplo.com?foo=1 a oferta e faça o descadastro se quiser.',
    targetLanguage: 'en',
  });
  assert.ok(result.text.includes('{{firstName}}'), 'variável preservada');
  assert.ok(result.text.includes('https://exemplo.com?foo=1'), 'link preservado');
});

async function startServer() {
  const app = express();
  app.use(express.json());
  const prisma = createFakePrisma();
  prisma.organization.rows.push({ id: 'org-1', plan: 'premium' });
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1' };
    next();
  });
  app.use(
    '/api/studio',
    createStudioRouter(prisma, {
      overrides: {
        allowSeed: true,
        seeds: [
          {
            id: 'tpl-system-1', orgId: 'system', name: 'Prospecção industrial', channel: 'email',
            objective: 'prospection', funnelStage: 'middle', subject: 'Proposta {{companyName}}',
            content: { blocks: [{ type: 'text', text: 'Olá {{firstName}}' }] }, variables: ['{{firstName}}'],
          },
        ],
        aiDeps: {
          callLlm: async () => ({
            content: JSON.stringify({ text: 'Hello {{firstName}}, see https://exemplo.com (unsubscribe available).' }),
          }),
        },
      },
    })
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${base}/api/studio${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { res, body: await res.json() };
  };
  return { server, prisma, api };
}

test('biblioteca: seeds do sistema listados; duplicar campanha não altera a original (T122/T123)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    // Seed instalado.
    const seeded = await api('POST', '/templates/seed', {});
    assert.equal(seeded.res.status, 200);

    const list = await api('GET', '/templates?objective=prospection');
    assert.equal(list.res.status, 200);
    assert.ok(list.body.data.some((t) => t.id === 'tpl-system-1' && t.isSystem));

    // Duplicar campanha: original intocada, nova vinculada em rascunho.
    prisma.studioCampaign.rows.push({
      id: 'camp-orig', orgId: 'org-1', name: 'Original', status: 'completed',
      channels: ['email'], origin: 'manual', funnelStage: 'middle', approval: {},
      schedule: {}, utmTemplate: {}, fallbackPolicy: {}, journeyEnabled: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.studioCampaign.rows[0].objective = 'objetivo original';
    const dup = await api('POST', '/campaigns', {
      name: 'Cópia reativação', channels: ['email'], duplicateOf: 'camp-orig', origin: 'duplicate',
    });
    assert.equal(dup.res.status, 201);
    assert.equal(dup.body.data.sourceCampaignId, 'camp-orig');
    assert.equal(prisma.studioCampaign.rows.find((c) => c.id === 'camp-orig').objective, 'objetivo original');
  } finally {
    server.close();
  }
});

test('tradução via endpoint nasce como novo conteúdo em revisão com variáveis preservadas', async () => {
  const { server, prisma, api } = await startServer();
  try {
    prisma.studioContent.rows.push({
      id: 'content-t', orgId: 'org-1', campaignId: 'camp-t', channel: 'email',
      subject: 'Proposta', preheader: null, whatsappText: null, linkedinText: null,
      emailDoc: { blocks: [{ type: 'text', text: 'Olá {{firstName}}, veja https://exemplo.com e faça o descadastro.' }] },
      origin: 'manual', variantLabel: 'A', kind: 'base', stepIndex: 1,
      editHistory: [], ctaUrl: null, tone: null,
    });
    const { res, body } = await api('POST', '/contents/content-t/translate', { targetLanguage: 'en' });
    assert.equal(res.status, 201);
    const translated = body.data;
    assert.ok(translated.emailDoc.blocks[0].text.includes('{{firstName}}'), 'variável preservada');
    assert.ok(translated.emailDoc.blocks[0].text.includes('https://exemplo.com'), 'link preservado');
    assert.ok(translated.emailDoc.blocks[0].text.toLowerCase().includes('unsubscribe'), 'traduzido para o idioma');
  } finally {
    server.close();
  }
});
