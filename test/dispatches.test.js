'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  toEmailDispatchItem,
  toWhatsAppDispatchItem,
  bucketForEmail,
  bucketForWhatsApp,
} = require('../dispatch-utils');

const iso = (d) => new Date(d).toISOString();

// ── Fixtures ────────────────────────────────────────────────────────────────
const prospectById = new Map([['pr_1', { id: 'pr_1', companyName: 'Acme', cnpj: '12.345.678/0001-90', cnpjEmail: 'contato@acme.com' }]]);
const waContactById = new Map([['cc_1', { id: 'cc_1', campaignId: 'camp_1', campaign: { id: 'camp_1', name: 'Outbound IA' } }]]);

function emailMessage(overrides = {}) {
  return {
    id: 'om_1',
    status: 'SENT',
    error: null,
    subject: 'Assunto do tenant',
    sentAt: new Date('2026-09-21T12:00:00Z'),
    createdAt: new Date('2026-09-21T11:59:00Z'),
    contact: { prospectId: 'pr_1', campaignId: 'camp_1', campaign: { name: 'Suíte', trigger: 'on_enrichment' } },
    compositionOrigin: 'tenant_template',
    ...overrides,
  };
}

function waMessage(overrides = {}) {
  return {
    id: 'wm_1',
    status: 'SENT',
    error: null,
    content: 'Olá Mariana, tudo bem? Aqui é o(a) MB Máquinas.',
    campaignContactId: 'cc_1',
    sentAt: new Date('2026-09-21T12:00:00Z'),
    createdAt: new Date('2026-09-21T11:59:00Z'),
    conversation: { prospectId: 'pr_1', phoneNumber: '5511987654321' },
    compositionOrigin: 'ai',
    ...overrides,
  };
}

// ── compositionOrigin exposto por item (FR-010 — T028) ──────────────────────

test('dispatches: item de email expõe compositionOrigin do registro', () => {
  const item = toEmailDispatchItem(emailMessage(), { prospectById });
  assert.strictEqual(item.compositionOrigin, 'tenant_template');
  assert.strictEqual(item.channel, 'email');
  assert.strictEqual(item.bucket, 'sent');
  assert.strictEqual(item.campaignName, 'Suíte');
});

test('dispatches: item de WhatsApp expõe compositionOrigin do registro', () => {
  const item = toWhatsAppDispatchItem(waMessage(), { prospectById, waContactById });
  assert.strictEqual(item.compositionOrigin, 'ai');
  assert.strictEqual(item.channel, 'whatsapp');
  assert.strictEqual(item.campaignId, 'camp_1', 'campanha resolvida via campaignContactId');
  assert.strictEqual(item.campaignName, 'Outbound IA');
});

test('dispatches: registro anterior à migração → compositionOrigin null', () => {
  const legacyEmail = toEmailDispatchItem(emailMessage({ compositionOrigin: undefined }), { prospectById });
  assert.strictEqual(legacyEmail.compositionOrigin, null);
  const legacyWa = toWhatsAppDispatchItem(waMessage({ compositionOrigin: null }), { prospectById, waContactById });
  assert.strictEqual(legacyWa.compositionOrigin, null);
});

test('dispatches: todas as origens de composição atravessam sem alteração', () => {
  for (const origin of ['tenant_template', 'ai', 'ai_fallback_template', 'profile_base']) {
    const item = toWhatsAppDispatchItem(waMessage({ compositionOrigin: origin }), { prospectById, waContactById });
    assert.strictEqual(item.compositionOrigin, origin);
  }
});

// ── Buckets de status (contrato existente preservado) ───────────────────────

test('dispatches: buckets de email e WhatsApp inalterados', () => {
  assert.strictEqual(bucketForEmail({ status: 'SENT' }), 'sent');
  assert.strictEqual(bucketForEmail({ status: 'SCHEDULED' }), 'pending');
  assert.strictEqual(bucketForEmail({ status: 'FAILED', error: 'x' }), 'failed');
  assert.strictEqual(bucketForWhatsApp({ status: 'READ' }), 'sent');
  assert.strictEqual(bucketForWhatsApp({ status: 'PENDING' }), 'pending');
  assert.strictEqual(bucketForWhatsApp({ status: 'FAILED' }), 'failed');
});

// ── Conversa 1:1 (sem campanha) continua com origin 'conversation' ──────────

test('dispatches: mensagem de conversa sem campaignContactId → origin conversation', () => {
  const item = toWhatsAppDispatchItem(
    waMessage({ campaignContactId: null }),
    { prospectById, waContactById }
  );
  assert.strictEqual(item.origin, 'conversation');
  assert.strictEqual(item.compositionOrigin, 'ai');
});
