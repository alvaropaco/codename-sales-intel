'use strict';

/**
 * test/studio-agent.test.js — US9 do Campaign Studio (T089).
 *
 * Agente propõe plano completo item a item; conversão cria campanha em
 * revisão SEM disparar (FR-058); recomendações pós-disparo exigem aprovação
 * humana (FR-059).
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');

function agentLlm() {
  return async ({ user }) => {
    if (user.includes('critérios de segmento')) {
      return {
        content: JSON.stringify({
          criteria: { version: 1, groups: [{ op: 'AND', conditions: [{ field: 'industry', op: 'contains', value: 'indústria' }] }] },
          rationale: 'público industrial do objetivo',
        }),
      };
    }
    if (user.includes('pacote de campanha')) {
      return {
        content: JSON.stringify({
          title: 'Campanha ERP',
          email: { subject: 'ERP para {{companyName}}', preheader: 'x', blocks: [{ type: 'text', text: 'Olá {{firstName}}' }] },
          whatsapp: { text: 'Oi {{firstName}}, quer ver o ERP?' },
          linkedinText: 'texto',
          suggestedSegment: null,
          timing: 'terça 10h',
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
  app.use('/api/studio', createStudioRouter(prisma, { overrides: { aiDeps: { callLlm: agentLlm() } } }));
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

test('agente propõe plano completo; decisão item a item; convert cria em revisão SEM disparar', async () => {
  const { server, prisma, api } = await startServer();
  try {
    const propose = await api('POST', '/agent/propose', {
      prompt: 'quero vender ERP para indústrias de SP',
    });
    assert.equal(propose.res.status, 202);
    const proposalId = propose.body.data.proposalId;

    // Polling (execução inline) até o plano ficar pronto. Invariante da
    // máquina de estados: "proposed" SÓ existe com o plano completo no banco
    // (enquanto monta, o status é "planning" — o front faz polling nisso).
    let proposal = null;
    for (let i = 0; i < 100; i++) {
      proposal = (await api('GET', `/agent/proposals/${proposalId}`)).body.data;
      if (proposal.status !== 'planning') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(proposal.status, 'proposed');
    assert.ok(proposal.plan.audience, 'proposed só acontece com o plano completo no banco');
    assert.ok(proposal.plan.audience, 'plano inclui audiência');
    assert.ok(proposal.plan.contents, 'plano inclui conteúdos');

    // Decisão: aceita estratégia, rejeita audiência (troca), aceita conteúdos.
    const decided = await api('POST', `/agent/proposals/${proposalId}/decide`, {
      items: [
        { key: 'audience', decision: 'rejected' },
        { key: 'strategy', decision: 'accepted' },
        { key: 'contents', decision: 'accepted' },
      ],
      confirm: true,
    });
    assert.equal(decided.res.status, 200);
    assert.equal(decided.body.data.status, 'converted');

    // Campanha criada a partir do plano, em revisão — NUNCA ativa (FR-058).
    const campaigns = prisma.studioCampaign.rows;
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].origin, 'agent');
    assert.equal(campaigns[0].status, 'in_review');
    assert.ok(!prisma.outreachContact.rows.some((c) => c.status === 'QUEUED'), 'nenhum lead enfileirado');
  } finally {
    server.close();
  }
});

test('recomendação com efeito externo exige confirmação humana (FR-059)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    prisma.studioRecommendation.rows.push({
      id: 'rec-1', orgId: 'org-1', campaignId: 'camp-x',
      kind: 'pace_change', rationale: 'respostas caindo', evidence: [{ metric: 'replyRate', value: 0.01 }],
      status: 'proposed', requiresConfirmation: true,
    });
    const noConfirm = await api('POST', '/recommendations/rec-1/decide', { decision: 'apply' });
    assert.equal(noConfirm.res.status, 400, 'aplicar sem confirm → 400');
    const ok = await api('POST', '/recommendations/rec-1/decide', { decision: 'apply', confirm: true });
    assert.equal(ok.res.status, 200);
    assert.equal(ok.body.data.status, 'applied');
  } finally {
    server.close();
  }
});
