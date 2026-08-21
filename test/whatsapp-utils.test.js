'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizePhone,
  toChatId,
  phoneFromChatId,
  renderTemplate,
  isOptOutMessage,
  idempotencyKey,
} = require('../whatsapp-utils');

test('normalizePhone: BR number gets 55 prefix', () => {
  assert.strictEqual(normalizePhone('(11) 98765-4321'), '5511987654321');
  assert.strictEqual(normalizePhone('11 98765 4321'), '5511987654321');
  assert.strictEqual(normalizePhone('+55 11 98765-4321'), '5511987654321');
});

test('normalizePhone: already E.164 kept', () => {
  assert.strictEqual(normalizePhone('5511987654321'), '5511987654321');
});

test('normalizePhone: invalid returns null', () => {
  assert.strictEqual(normalizePhone(''), null);
  assert.strictEqual(normalizePhone(null), null);
});

test('toChatId/phoneFromChatId round-trip', () => {
  assert.strictEqual(toChatId('(11) 98765-4321'), '5511987654321@c.us');
  assert.strictEqual(phoneFromChatId('5511987654321@c.us'), '5511987654321');
});

test('renderTemplate: substitutes known vars and sanitizes', () => {
  const lead = { companyName: 'Acme\nIndustria Ltda', tradeName: 'Acme', industry: 'Software', city: 'São Paulo', cnpjPartners: [{ name: 'João Silva', qual: 'CEO' }] };
  const out = renderTemplate('Olá {{firstName}}, da {{companyName}} ({{industry}}) em {{city}}. {{jobTitle}}', lead);
  assert.ok(out.includes('João'), 'firstName derivado do sócio');
  assert.ok(out.includes('Software'));
  assert.ok(out.includes('São Paulo'));
  assert.ok(!out.includes('\n'), 'control chars removidos');
  assert.ok(!/\{\{/.test(out), 'placeholders não resolvidos removidos');
});

test('renderTemplate: unresolved placeholders removed', () => {
  const out = renderTemplate('Olá {{firstName}}, {{unknown}}!', { companyName: 'X' });
  assert.ok(!out.includes('{{unknown}}'));
});

test('isOptOutMessage: keyword variations', () => {
  assert.ok(isOptOutMessage('STOP'));
  assert.ok(isOptOutMessage('sair'));
  assert.ok(isOptOutMessage('NAO QUERO'));
  assert.ok(isOptOutMessage('não quero mais'));
  assert.ok(isOptOutMessage('PARAR'));
  assert.ok(isOptOutMessage('cancelar'));
  assert.ok(isOptOutMessage('Por favor, STOP'));
  assert.ok(!isOptOutMessage('Olá, podemos conversar?'));
  assert.ok(!isOptOutMessage('quero falar sobre a proposta'));
});

test('idempotencyKey: deterministic and stable', () => {
  const a = idempotencyKey('camp1', 'lead1', 2);
  const b = idempotencyKey('camp1', 'lead1', 2);
  const c = idempotencyKey('camp1', 'lead1', 3);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});
