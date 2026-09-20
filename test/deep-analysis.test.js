'use strict';

/**
 * Testes do módulo puro da análise profunda (feature 005) — deep-analysis.js.
 * Padrão test/contact-decision.test.js: node:test + node:assert + fixtures,
 * sem banco nem rede. Cobertura: buildPrompt (contexto da org, degradação
 * honesta, ausência de PII de contato), validateResult (contrato de saída da
 * IA) e verdictStatusAfter (aplicação do veredito).
 *
 * Contratos: specs/005-deep-lead-analysis/contracts/api.md e research.md R4.
 */

const test = require('node:test');
const assert = require('node:assert');
const { buildPrompt, validateResult, verdictStatusAfter, extractContactEvidence } = require('../deep-analysis');
const { buildOrgContext } = require('../org-context');
const { contactResult, noContactResult, fencedResult } = require('./helpers/fake-llm');

const PROSPECT_FIXTURE = {
  id: 'lead-001',
  orgId: 'org-1',
  companyName: 'Empresa Exemplo LTDA',
  tradeName: 'Exemplo',
  industry: 'Tecnologia',
  city: 'Campinas',
  state: 'SP',
  employees: 45,
  revenueEstimate: 3200000,
  cnpj: '12345678000199',
  cnpjOpenedAt: new Date('2024-02-01T00:00:00Z'),
  cnpjLegalNature: 'Sociedade Empresária Limitada',
  // PII que NUNCA pode entrar no prompt:
  cnpjEmail: 'contato@empresaexemplo.com.br',
  cnpjPhones: ['11999998888'],
  contactName: 'Maria da Silva',
  enrichmentStatus: 'enriched',
  enrichmentVersion: 3,
  enrichmentSummary: { technologies: ['hubspot'], social_platforms: ['linkedin'] },
  opportunityScore: 64,
};

// ── buildPrompt ─────────────────────────────────────────────────────────────

test('buildPrompt inclui o contexto comercial da organização configurada (FR-006)', () => {
  const orgContext = buildOrgContext({
    orgName: 'Cliente Org',
    settings: {
      productDescription: 'Software de gestão fiscal para contadores',
      businessModel: 'SaaS por assinatura',
      differentiators: ['Integração automática com a Receita'],
      targetSegments: ['Contabilidade'],
    },
  });
  const { system, user } = buildPrompt({
    orgContext,
    prospect: PROSPECT_FIXTURE,
    enrichmentSummary: PROSPECT_FIXTURE.enrichmentSummary,
    contactDecision: { recommendation: { verdict: 'contact_now' } },
    deterministicScore: 64,
  });

  assert.ok(system.includes('JSON'), 'system prompt deve exigir saída JSON');
  assert.ok(user.includes('Software de gestão fiscal para contadores'));
  assert.ok(user.includes('Integração automática com a Receita'));
  assert.ok(user.includes('Tecnologia'));
  assert.ok(user.includes('"score_oportunidade_deterministico":64'));
});

test('buildPrompt com org sem contexto usa degradação honesta (FR-017) — nada de inventar', () => {
  const orgContext = buildOrgContext({ orgName: 'Cliente Org', settings: {} });
  assert.strictEqual(orgContext.configured, false);
  const { user } = buildPrompt({
    orgContext,
    prospect: PROSPECT_FIXTURE,
    enrichmentSummary: {},
    contactDecision: null,
    deterministicScore: 10,
  });
  assert.ok(user.includes('NÃO CONFIGURADO'));
  assert.ok(user.includes('NÃO invente'));
});

test('buildPrompt NUNCA inclui valores crus de e-mail/telefone/pessoa de contato (padrão 003)', () => {
  const orgContext = buildOrgContext({ orgName: 'Org', settings: { productDescription: 'X' } });
  const { user } = buildPrompt({
    orgContext,
    prospect: PROSPECT_FIXTURE,
    enrichmentSummary: PROSPECT_FIXTURE.enrichmentSummary,
    contactDecision: null,
    deterministicScore: 64,
  });
  assert.ok(!user.includes('contato@empresaexemplo.com.br'), 'e-mail cru vazou no prompt');
  assert.ok(!user.includes('11999998888'), 'telefone cru vazou no prompt');
  assert.ok(!user.includes('Maria da Silva'), 'nome de contato vazou no prompt');
  // Evidência existente (não o valor) entra sim:
  assert.ok(user.includes('email_corporativo'));
});

test('extractContactEvidence classifica e-mail sem expor o valor', () => {
  const evidence = extractContactEvidence(PROSPECT_FIXTURE);
  assert.strictEqual(evidence.email_corporativo, true);
  assert.strictEqual(evidence.email_generico, false);
  assert.strictEqual(evidence.telefone, true);
  assert.deepStrictEqual(Object.values(evidence).every((v) => typeof v === 'boolean'), true);
});

// ── validateResult (contrato de saída do modelo) ────────────────────────────

test('validateResult normaliza o resultado válido da IA', () => {
  const r = validateResult(JSON.stringify(contactResult()));
  assert.strictEqual(r.finalScore, 72);
  assert.strictEqual(r.verdict, 'contact');
  assert.ok(r.summary.length > 0);
  assert.ok(Array.isArray(r.impressions) && r.impressions.length > 0);
  assert.ok(Array.isArray(r.factorsPro) && r.factorsPro.length > 0);
  assert.ok(Array.isArray(r.factorsCon) && r.factorsCon.length > 0);
});

test('validateResult aceita JSON cercado por fences de código', () => {
  const { rawContent } = fencedResult(noContactResult());
  const r = validateResult(rawContent);
  assert.strictEqual(r.verdict, 'no_contact');
  assert.strictEqual(r.finalScore, 24);
});

test('validateResult rejeita score fora de 0–100', () => {
  assert.throws(() => validateResult(JSON.stringify(contactResult({ score_final: 101 }))));
  assert.throws(() => validateResult(JSON.stringify(contactResult({ score_final: -1 }))));
  assert.throws(() => validateResult(JSON.stringify(contactResult({ score_final: 'alto' }))));
});

test('validateResult rejeita veredito desconhecido', () => {
  assert.throws(() => validateResult(JSON.stringify(contactResult({ veredito: 'talvez' }))));
});

test('validateResult rejeita resumo vazio e listas ausentes', () => {
  assert.throws(() => validateResult(JSON.stringify(contactResult({ resumo: '   ' }))));
  assert.throws(() => validateResult(JSON.stringify(contactResult({ impressoes: 'não é lista' }))));
  assert.throws(() => validateResult(JSON.stringify(contactResult({ fatores_pro: null }))));
});

test('validateResult rejeita conteúdo não-JSON', () => {
  assert.throws(() => validateResult('desculpe, não consigo analisar'));
});

// ── verdictStatusAfter (FR-009/FR-010) ──────────────────────────────────────

test('verdictStatusAfter mapeia veredito para próximo estágio', () => {
  assert.strictEqual(verdictStatusAfter('contact'), 'qualified');
  assert.strictEqual(verdictStatusAfter('no_contact'), 'discarded');
  assert.throws(() => verdictStatusAfter('outra-coisa'));
});

// ── Degradação conservadora quando a org não tem contexto (hotfix 98%) ─────

test('buildPrompt sem contexto da org instrui viés conservador no veredito', () => {
  const orgContext = buildOrgContext({ orgName: 'Org', settings: {} });
  const { system } = buildPrompt({
    orgContext,
    prospect: PROSPECT_FIXTURE,
    enrichmentSummary: {},
    contactDecision: null,
    deterministicScore: 10,
  });
  assert.match(system, /N[ÃA]O CONFIGURADO/i);
  assert.match(system, /conservador/i);
  assert.match(system, /no_contact/);
});

test('buildPrompt com contexto da org não aplica o viés conservador', () => {
  const orgContext = buildOrgContext({
    orgName: 'Org',
    settings: { productDescription: 'Software de gestão fiscal' },
  });
  const { system } = buildPrompt({
    orgContext,
    prospect: PROSPECT_FIXTURE,
    enrichmentSummary: {},
    contactDecision: null,
    deterministicScore: 50,
  });
  assert.doesNotMatch(system, /conservador/i);
});
