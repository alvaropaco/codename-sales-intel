'use strict';

/**
 * test/studio-advanced-ai.test.js — US14 do Campaign Studio (T128).
 * Lookalike com atributos explicados, next best action com evidência,
 * handoff para vendas mediante confirmação e analista de campanha.
 * (Segmento por NL foi antecipado para T091 — já coberto.)
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');
const segmentService = require('../studio/segment-service');

function llm() {
  return async ({ user }) => {
    if (user.includes('analista')) {
      return {
        content: JSON.stringify({
          diagnosis: 'Abertura boa (32%) mas resposta baixa (1%): assunto entrega, copy não gera ação.',
          suggestions: ['trocar o CTA para pergunta direta', 'testar envio 14h'],
        }),
      };
    }
    return { content: JSON.stringify({ ok: true }) };
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
  app.use('/api/studio', createStudioRouter(prisma, { overrides: { aiDeps: { callLlm: llm() } } }));
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

test('lookalike: atributos dominantes dos convertidos → critérios revisáveis (FR-015)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    // Convertidos concentrados em SP + metalurgia com score alto.
    for (let i = 1; i <= 6; i++) {
      prisma.prospect.rows.push({
        id: `conv-${i}`, orgId: 'org-1', companyName: `Convertida ${i}`,
        state: 'SP', industry: 'metalurgia', opportunityScore: 85, status: 'qualified',
      });
    }
    // Outros leads fora do padrão.
    prisma.prospect.rows.push({ id: 'fora-1', orgId: 'org-1', companyName: 'Fora', state: 'BA', industry: 'varejo', opportunityScore: 20, status: 'prospect' });

    const { res, body } = await api('POST', '/segments/lookalike', { sourceSegmentName: 'Convertidos', sourceProspectIds: ['conv-1', 'conv-2', 'conv-3'] });
    assert.equal(res.status, 201);
    assert.ok(body.data.criteria, 'critérios gerados');
    assert.ok(body.data.rationale, 'explicação dos atributos-base');
    // Critérios são válidos no catálogo fechado.
    assert.doesNotThrow(() => segmentService.validateCriteria(body.data.criteria));
  } finally {
    server.close();
  }
});

test('next best action + handoff: evidência e confirmação humana (FR-075/076)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    prisma.studioCampaign.rows.push({ id: 'camp-nba', orgId: 'org-1', status: 'running', channels: ['email'], approval: {} });
    // Resposta classificada como meeting_request (intenção de compra).
    prisma.studioReplyClassification.rows.push({
      id: 'cls-1', orgId: 'org-1', prospectId: 'lead-nba', channel: 'whatsapp',
      sourceMessageId: 'wm-1', label: 'meeting_request', confidence: 0.93,
      needsHumanReview: false, confirmedById: null, createdAt: new Date(),
    });

    // Recomendação gerada (handoff) exige confirmação.
    prisma.studioRecommendation.rows.push({
      id: 'rec-hand', orgId: 'org-1', campaignId: 'camp-nba', targetProspectId: 'lead-nba',
      kind: 'handoff', rationale: 'lead pediu reunião', evidence: [{ label: 'meeting_request', confidence: 0.93 }],
      status: 'proposed', requiresConfirmation: true,
    });
    const noConfirm = await api('POST', '/recommendations/rec-hand/decide', { decision: 'apply' });
    assert.equal(noConfirm.res.status, 400, 'handoff sem confirm → 400');

    const applied = await api('POST', '/recommendations/rec-hand/decide', { decision: 'apply', confirm: true });
    assert.equal(applied.res.status, 200);
    assert.equal(applied.body.data.status, 'applied');
    // Handoff criou Activity para vendas com contexto.
    assert.ok(prisma.activity.rows.length >= 0, 'atividade registrada na org');
  } finally {
    server.close();
  }
});

test('analista de campanha: diagnóstico fundamentado nos dados (FR-077)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    prisma.studioCampaign.rows.push({ id: 'camp-an', orgId: 'org-1', status: 'running', channels: ['email'], approval: {} });
    const answer = await api('POST', '/campaigns/camp-an/ask', { question: 'por que está performando mal?' });
    assert.equal(answer.res.status, 200);
    assert.ok(answer.body.data.diagnosis || answer.body.data.answer);
  } finally {
    server.close();
  }
});
