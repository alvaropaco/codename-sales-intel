const test = require('node:test');
const assert = require('node:assert');
const normalizer = require('../discovery/normalizer');

// ── CNPJ ────────────────────────────────────────────────────────────────────

test('normalizeCnpj: válidos consolidam em 14 dígitos; inválidos viram null', () => {
  // 11.222.333/0001-81 é o CNPJ válido canônico de exemplo.
  assert.strictEqual(normalizer.normalizeCnpj('11.222.333/0001-81'), '11222333000181');
  assert.strictEqual(normalizer.normalizeCnpj('11222333000181'), '11222333000181');
  assert.strictEqual(normalizer.normalizeCnpj('11222333000180'), null); // DV errado
  assert.strictEqual(normalizer.normalizeCnpj('11111111111111'), null); // curto
  assert.strictEqual(normalizer.normalizeCnpj(''), null);
  assert.strictEqual(normalizer.normalizeCnpj(null), null);
});

test('isValidCnpj: rejeita sequência repetida e valida dígitos verificadores', () => {
  assert.strictEqual(normalizer.isValidCnpj('00.000.000/0000-00'), false);
  assert.strictEqual(normalizer.isValidCnpj('11222333000181'), true);
});

test('formatCnpj: só formata quando há 14 dígitos', () => {
  assert.strictEqual(normalizer.formatCnpj('11222333000181'), '11.222.333/0001-81');
  assert.strictEqual(normalizer.formatCnpj('123'), '123');
});

// ── Domínio ─────────────────────────────────────────────────────────────────

test('normalizeDomain: URL, e-mail e host solto viram o mesmo host canônico', () => {
  const expected = 'exemplo.com.br';
  assert.strictEqual(normalizer.normalizeDomain('https://www.exemplo.com.br/caminho?q=1'), expected);
  assert.strictEqual(normalizer.normalizeDomain('HTTP://Exemplo.COM.BR:8080'), expected);
  assert.strictEqual(normalizer.normalizeDomain('contato@exemplo.com.br'), expected);
  assert.strictEqual(normalizer.normalizeDomain('exemplo.com.br/'), expected);
  assert.strictEqual(normalizer.normalizeDomain('exemplo.com.br.'), expected);
});

test('normalizeDomain: rejeita lixo sem TLD ou hostname inválido', () => {
  assert.strictEqual(normalizer.normalizeDomain('não é domínio'), null);
  assert.strictEqual(normalizer.normalizeDomain('localhost'), null);
  assert.strictEqual(normalizer.normalizeDomain(''), null);
  assert.strictEqual(normalizer.normalizeDomain(null), null);
});

test('baseDomain: sufixo multi-nível (.com.br) preserva o domínio registrável', () => {
  assert.strictEqual(normalizer.baseDomain('sub.exemplo.com.br'), 'exemplo.com.br');
  assert.strictEqual(normalizer.baseDomain('a.b.exemplo.com'), 'exemplo.com');
  assert.strictEqual(normalizer.baseDomain('exemplo.com.br'), 'exemplo.com.br');
});

// ── URL / e-mail / telefone / nome ──────────────────────────────────────────

test('normalizeUrl: minúsculo, sem hash e sem porta default', () => {
  assert.strictEqual(normalizer.normalizeUrl('HTTPS://Exemplo.com:443/Pagina#x'), 'https://exemplo.com/Pagina');
  assert.strictEqual(normalizer.normalizeUrl('http://exemplo.com:80'), 'http://exemplo.com');
  assert.strictEqual(normalizer.normalizeUrl(''), null);
});

test('normalizeEmail e normalizePhone: canônicos ou null', () => {
  assert.strictEqual(normalizer.normalizeEmail(' Contato@Exemplo.COM '), 'contato@exemplo.com');
  assert.strictEqual(normalizer.normalizeEmail('sem-arroba'), null);
  assert.strictEqual(normalizer.normalizePhone('(11) 98888-7777'), '5511988887777');
  assert.strictEqual(normalizer.normalizePhone('+55 11 3333-4444'), '551133334444');
  assert.strictEqual(normalizer.normalizePhone('123'), null);
});

test('normalizeName: acento/caixa/tipo societário não mudam a identidade', () => {
  const a = normalizer.normalizeName('Empresa Exemplo Ltda');
  const b = normalizer.normalizeName('  empresa exemplo  ME ');
  assert.strictEqual(a, 'empresa exemplo');
  assert.strictEqual(b, 'empresa exemplo');
});

// ── Chaves canônicas (SC-002) ───────────────────────────────────────────────

test('canonicalKey: mesma identidade → mesma chave, tipos diferentes → namespaces distintos', () => {
  assert.strictEqual(normalizer.canonicalKey('company', '11.222.333/0001-81'), 'cnpj:11222333000181');
  assert.strictEqual(normalizer.canonicalKey('company', '11222333000181'), 'cnpj:11222333000181');
  assert.strictEqual(normalizer.canonicalKey('domain', 'https://WWW.Exemplo.com.br/x'), 'host:exemplo.com.br');
  assert.strictEqual(normalizer.canonicalKey('email', 'A@Exemplo.com'), 'email:a@exemplo.com');
  assert.strictEqual(normalizer.canonicalKey('phone', '(11) 98888-7777'), 'phone:5511988887777');

  const person1 = normalizer.canonicalKey('person', 'José da Silva');
  const person2 = normalizer.canonicalKey('person', 'jose da silva');
  assert.strictEqual(person1, person2);
  assert.ok(person1.startsWith('person:'));

  // CNPJ inválido NÃO gera chave de company (identidade fraca não consolida).
  assert.strictEqual(normalizer.canonicalKey('company', '11222333000180'), null);
  assert.strictEqual(normalizer.canonicalKey('tipo-desconhecido', 'x'), null);
});
