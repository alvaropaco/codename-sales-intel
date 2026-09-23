'use strict';

/**
 * test/studio-reply-classification.test.js — US6 do Campaign Studio (T063).
 *
 * Classificação de respostas por IA (FR-045): labels, confiança baixa →
 * revisão humana, opt-out propaga para LeadChannelState + supressão e
 * suspende toques futuros em todos os canais (FR-046).
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createReplyClassifier } = require('../studio/ai/classify-reply');

function llmWith(label, confidence) {
  return async () => ({ content: JSON.stringify({ label, confidence }) });
}

function basePrisma() {
  const prisma = createFakePrisma();
  prisma.prospect.rows.push({ id: 'lead-1', orgId: 'org-1', companyName: 'Empresa 1', cnpjEmail: 'lead-1@empresa.com.br' });
  return prisma;
}

test('classificação: resposta de interesse → label interested', async () => {
  const prisma = basePrisma();
  const classifier = createReplyClassifier({ callLlm: llmWith('interested', 0.95) });
  const result = await classifier.classifyAndStore(prisma, {
    orgId: 'org-1',
    prospectId: 'lead-1',
    channel: 'whatsapp',
    sourceMessageId: 'wa-msg-1',
    text: 'Adorei! Podemos marcar uma call essa semana?',
  });
  assert.equal(result.label, 'interested');
  assert.equal(result.needsHumanReview, false);
  assert.equal(prisma.studioReplyClassification.rows.length, 1);
});

test('baixa confiança → fila de revisão humana (FR-045)', async () => {
  const prisma = basePrisma();
  const classifier = createReplyClassifier({ callLlm: llmWith('doubt', 0.3) });
  const result = await classifier.classifyAndStore(prisma, {
    orgId: 'org-1',
    prospectId: 'lead-1',
    channel: 'email',
    sourceMessageId: 'om-1',
    text: 'hum, deixa eu pensar',
  });
  assert.equal(result.label, 'doubt');
  assert.equal(result.needsHumanReview, true);
});

test('opt-out propagado: LeadChannelState + supressão + toques futuros cancelados (FR-046)', async () => {
  const prisma = basePrisma();
  // Execuções de canal com toques futuros do lead.
  prisma.outreachContact.rows.push({ id: 'oc-1', campaignId: 'exec-e', prospectId: 'lead-1', status: 'QUEUED' });
  prisma.whatsappCampaignContact.rows.push({ id: 'wc-1', campaignId: 'exec-w', prospectId: 'lead-1', status: 'QUEUED' });

  const classifier = createReplyClassifier({ callLlm: llmWith('opt_out', 0.99) });
  const result = await classifier.classifyAndStore(prisma, {
    orgId: 'org-1',
    prospectId: 'lead-1',
    channel: 'whatsapp',
    sourceMessageId: 'wa-msg-2',
    text: 'Não quero mais receber mensagens de vocês. Parem!',
  });
  assert.equal(result.label, 'opt_out');

  const state = prisma.leadChannelState.rows.find((r) => r.prospectId === 'lead-1' && r.channel === 'whatsapp');
  assert.equal(state.status, 'opted_out', 'LeadChannelState marcado opt-out');
  const suppressed = prisma.suppressionList.rows.find((r) => r.email === 'lead-1@empresa.com.br');
  assert.ok(suppressed, 'e-mail na supressão');
  assert.equal(prisma.outreachContact.rows.find((r) => r.id === 'oc-1').status, 'CANCELLED', 'toque e-mail cancelado');
  assert.equal(prisma.whatsappCampaignContact.rows.find((r) => r.id === 'wc-1').status, 'OPTED_OUT');
});

test('LLM indisponível → classificação fica pendente sem quebrar o fluxo do reply', async () => {
  const prisma = basePrisma();
  const classifier = createReplyClassifier({
    callLlm: async () => { throw new Error('gateway down'); },
  });
  const result = await classifier.classifyAndStore(prisma, {
    orgId: 'org-1',
    prospectId: 'lead-1',
    channel: 'email',
    sourceMessageId: 'om-2',
    text: 'qualquer texto',
  });
  assert.equal(result.label, 'unclassified');
  assert.equal(result.needsHumanReview, true, 'cai para revisão humana');
});
