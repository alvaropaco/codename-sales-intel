'use strict';

/**
 * test/studio-journey.test.js — US8 do Campaign Studio (T080).
 *
 * Journeys: validação estrutural do grafo, execução por lead com ramos por
 * comportamento, parada global (resposta/conversão/opt-out em todos os
 * canais — FR-053), webhook autenticado e stats por bloco (FR-056).
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const crypto = require('crypto');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');
const journeyEngine = require('../studio/journey-engine');

const DEFINITION = {
  blocks: [
    { id: 'b1', type: 'send', config: { channel: 'email', stepIndex: 1 } },
    { id: 'w1', type: 'wait', config: { days: 2 } },
    {
      id: 'c1',
      type: 'condition',
      config: { kind: 'opened' },
    },
    { id: 's-yes', type: 'send', config: { channel: 'whatsapp', stepIndex: 1 } },
    { id: 's-no', type: 'send', config: { channel: 'whatsapp', stepIndex: 1 } },
    { id: 'end', type: 'end', config: {} },
  ],
  edges: [
    { from: 'b1', to: 'w1' },
    { from: 'w1', to: 'c1' },
    { from: 'c1', to: 's-yes', branch: 'yes' },
    { from: 'c1', to: 's-no', branch: 'no' },
    { from: 's-yes', to: 'end' },
    { from: 's-no', to: 'end' },
  ],
};

function journeyFixture(prisma, overrides = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  prisma.studioJourney.rows.push({
    id: 'j-1',
    orgId: 'org-1',
    campaignId: 'camp-j',
    definition: DEFINITION,
    triggers: { kind: 'webhook' },
    stopConditions: ['reply', 'opt_out', 'converted'],
    status: 'active',
    webhookToken: crypto.createHash('sha256').update(token).digest('hex'),
    ...overrides,
  });
  return { journey: prisma.studioJourney.rows[0], token };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const prisma = createFakePrisma();
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1' };
    next();
  });
  app.use('/api/studio', createStudioRouter(prisma));
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
  return { server, prisma, api, base };
}

test('validação do grafo: ciclo sem wait e branch sem fim são rejeitados (T082)', () => {
  const errorsCycle = journeyEngine.validateDefinition({
    blocks: [
      { id: 'a', type: 'condition', config: { kind: 'opened' } },
      { id: 'b', type: 'condition', config: { kind: 'clicked' } },
    ],
    edges: [
      { from: 'a', to: 'b', branch: 'yes' },
      { from: 'b', to: 'a', branch: 'yes' },
    ],
  });
  assert.ok(errorsCycle.length > 0, 'ciclo sem wait → erro');

  const errorsEnd = journeyEngine.validateDefinition({
    blocks: [
      { id: 'a', type: 'send', config: {} },
    ],
    edges: [],
  });
  assert.ok(errorsEnd.length > 0, 'send sem caminho para fim → erro');

  const ok = journeyEngine.validateDefinition(DEFINITION);
  assert.deepEqual(ok, [], 'grafo válido não tem erros');
});

test('processLead: lead segue o ramo conforme o comportamento real (opened vs não)', async () => {
  const prisma = createFakePrisma();
  const { journey } = journeyFixture(prisma);
  prisma.studioJourneyLead.rows.push({
    id: 'jl-1', journeyId: 'j-1', prospectId: 'lead-abriu', currentBlockId: 'c1',
    waitingUntil: null, status: 'active', stopReason: null,
  });
  // Lead abriu o e-mail (evento de abertura presente).
  const result = await journeyEngine.processLead(prisma, journey, 'lead-abriu', {
    behavior: { opened: true, clicked: false, replied: false },
    now: new Date(),
    enqueue: async () => {},
  });
  const leadRow = prisma.studioJourneyLead.rows.find((r) => r.prospectId === 'lead-abriu');
  assert.equal(leadRow.currentBlockId, 's-yes', 'ramo "abriu" → WhatsApp');
  assert.equal(result.executed, true);
});

test('parada global: resposta cancela toques futuros em TODOS os canais (FR-053)', async () => {
  const prisma = createFakePrisma();
  const { journey } = journeyFixture(prisma);
  prisma.studioJourneyLead.rows.push({
    id: 'jl-2', journeyId: 'j-1', prospectId: 'lead-respondeu', currentBlockId: 'c1',
    waitingUntil: null, status: 'active', stopReason: null,
  });
  prisma.outreachContact.rows.push({ id: 'oc-x', campaignId: 'exec-e', prospectId: 'lead-respondeu', status: 'QUEUED' });
  prisma.whatsappCampaignContact.rows.push({ id: 'wc-x', campaignId: 'exec-w', prospectId: 'lead-respondeu', status: 'QUEUED' });

  await journeyEngine.processLead(prisma, journey, 'lead-respondeu', {
    behavior: { replied: true },
    now: new Date(),
    enqueue: async () => assert.fail('nada deve enviar após resposta'),
  });
  const leadRow = prisma.studioJourneyLead.rows.find((r) => r.prospectId === 'lead-respondeu');
  assert.equal(leadRow.status, 'stopped');
  assert.equal(leadRow.stopReason, 'reply');
  // Toques nos canais são cancelados.
  assert.equal(prisma.outreachContact.rows.find((r) => r.id === 'oc-x').status, 'CANCELLED');
  assert.equal(prisma.whatsappCampaignContact.rows.find((r) => r.id === 'wc-x').status, 'CANCELLED');
});

test('wait: lead fica waitingUntil e só avança após o prazo', async () => {
  const prisma = createFakePrisma();
  const { journey } = journeyFixture(prisma);
  prisma.studioJourneyLead.rows.push({
    id: 'jl-3', journeyId: 'j-1', prospectId: 'lead-wait', currentBlockId: 'w1',
    waitingUntil: null, status: 'active', stopReason: null,
  });
  const now = new Date('2026-09-23T13:00:00Z');
  await journeyEngine.processLead(prisma, journey, 'lead-wait', {
    behavior: {}, now, enqueue: async () => {},
  });
  const row = prisma.studioJourneyLead.rows.find((r) => r.prospectId === 'lead-wait');
  assert.equal(row.status, 'waiting');
  assert.ok(row.waitingUntil > now, 'waitingUntil definido 2 dias à frente');

  // Antes do prazo: não avança.
  const early = await journeyEngine.processLead(prisma, journey, 'lead-wait', {
    behavior: { opened: true }, now: new Date(now.getTime() + 86_400_000), enqueue: async () => {},
  });
  assert.equal(early.executed, false, 'aguardando prazo');
  // Depois do prazo: avança para a condição.
  const after = await journeyEngine.processLead(prisma, journey, 'lead-wait', {
    behavior: { opened: true }, now: new Date(now.getTime() + 3 * 86_400_000), enqueue: async () => {},
  });
  assert.equal(after.executed, true);
});

test('webhook: token correto inicia journey para lead da org; inválido não vaza (FR-054)', async () => {
  const { server, prisma, base, api } = await startServer();
  try {
    const { token } = journeyFixture(prisma);
    prisma.prospect.rows.push({ id: 'lead-w', orgId: 'org-1', companyName: 'W' });

    const ok = await fetch(`${base}/api/studio/journeys/j-1/webhook/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospectRef: 'lead-w' }),
    });
    assert.equal(ok.status, 202, 'webhook aceita (202 sempre)');
    assert.equal(prisma.studioJourneyLead.rows.length, 1, 'lead entrou no journey');

    const invalid = await fetch(`${base}/api/studio/journeys/j-1/webhook/token-invalido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospectRef: 'lead-w' }),
    });
    // Contrato (research D15): sempre 202 — sem vazar existência de journey/token.
    assert.equal(invalid.status, 202);
    assert.equal(prisma.studioJourneyLead.rows.length, 1, 'token inválido NÃO inscreve ninguém');

    // Lead de outra org não inicia.
    prisma.prospect.rows.push({ id: 'lead-outro', orgId: 'org-2', companyName: 'Fora' });
    const other = await fetch(`${base}/api/studio/journeys/j-1/webhook/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospectRef: 'lead-outro' }),
    });
    assert.equal(other.status, 202);
    assert.ok(!prisma.studioJourneyLead.rows.some((r) => r.prospectId === 'lead-outro'), 'lead de outra org ignora (isolamento IV)');
  } finally {
    server.close();
  }
});

test('stats por bloco: entered/done por bloco (FR-056)', async () => {
  const { server, prisma, api } = await startServer();
  try {
    journeyFixture(prisma);
    prisma.studioJourneyLead.rows.push(
      { id: 'jl-a', journeyId: 'j-1', prospectId: 'p1', currentBlockId: 'b1', waitingUntil: null, status: 'done', stopReason: null },
      { id: 'jl-b', journeyId: 'j-1', prospectId: 'p2', currentBlockId: 'b1', waitingUntil: null, status: 'active', stopReason: null },
      { id: 'jl-c', journeyId: 'j-1', prospectId: 'p3', currentBlockId: 'w1', waitingUntil: new Date(), status: 'waiting', stopReason: null }
    );
    const stats = await api('GET', '/journeys/j-1/stats');
    assert.equal(stats.res.status, 200);
    const byBlock = stats.body.data;
    assert.equal(byBlock.b1.entered, 2);
    assert.equal(byBlock.w1.entered, 1);
  } finally {
    server.close();
  }
});
