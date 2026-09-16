const test = require('node:test');
const assert = require('node:assert');
const {
  nameSimilarity,
  extractCnpjCandidates,
  resolveCnpj,
} = require('../lead-enrichment');
const { isValidCnpj } = require('../csv-import');

// ── Similaridade de nomes ───────────────────────────────────────────────────

test('nameSimilarity: razão social variações e contenção pontuam alto', () => {
  assert.ok(nameSimilarity('MARISPAN INDÚSTRIA E COMÉRCIO LTDA', 'Implementos Agricolas Marispan LTDA') > 0.4);
  assert.ok(nameSimilarity('DEDINI S.A.', 'Dedini') >= 0.75); // contenção
  assert.ok(nameSimilarity('MARISPAN', 'MARISPAN INDUSTRIA E COMERCIO') >= 0.75);
  assert.strictEqual(nameSimilarity('MARISPAN', 'PETROBRAS'), 0);
  assert.strictEqual(nameSimilarity('', 'qualquer'), 0);
});

// ── Extração de CNPJs de texto de busca ─────────────────────────────────────

test('extractCnpjCandidates: máscara, puro e filtragem por DV', () => {
  const text = [
    'Empresa X - CNPJ 45.299.583/0001-31 de Batatais/SP',
    'cnpj.biz/45299583000131',
    'CNPJ 11.222.333/0001-99 inválido',
    'telefone 54 3332 2800',
  ].join('\n');
  const cands = extractCnpjCandidates(text);
  assert.deepStrictEqual(cands, ['45299583000131']); // DV inválido e telefone fora
});

test('extractCnpjCandidates deduplica', () => {
  assert.deepStrictEqual(
    extractCnpjCandidates('45.299.583/0001-31 e 45299583000131'),
    ['45299583000131']
  );
});

// ── Resolução de CNPJ com fontes injetadas ──────────────────────────────────

const PROSPECT = {
  companyName: 'MARISPAN INDÚSTRIA E COMÉRCIO LTDA',
  city: 'BATATAIS',
  state: 'SP',
};

test('resolveCnpj: base RFB local resolve por nome com score alto', async () => {
  const deps = {
    searchCompanies: async ({ query }) => [
      { cnpj: '45299583000131', legalName: 'IMPLEMENTOS AGRICOLAS MARISPAN LTDA', city: 'Batatais', state: 'SP' },
      { cnpj: '11222333000181', legalName: 'Empresa Sem Relação Alguma', city: 'Curitiba', state: 'PR' },
    ],
    searxSearch: async () => { throw new Error('não deveria chamar SearXNG'); },
  };
  const r = await resolveCnpj(PROSPECT, deps);
  assert.strictEqual(r.cnpj, '45299583000131');
  assert.strictEqual(r.source, 'rfb');
  assert.ok(r.confidence >= 0.62);
});

test('resolveCnpj: cai para SearXNG quando RFB não acha, validando na RFB', async () => {
  const calls = { byCnpj: 0 };
  const deps = {
    searchCompanies: async () => [],
    searxSearch: async () => [
      { title: 'Marispan Indústria - 45.299.583/0001-31 - casadosdados', content: 'CNPJ 45299583000131 de Batatais/SP' },
      { title: 'outro site', content: 'CNPJ 11.222.333/0001-81 outro negócio' },
    ],
    getCompanyByCnpj: async (cnpj) => {
      calls.byCnpj++;
      return cnpj === '45299583000131'
        ? { cnpj, legalName: 'IMPLEMENTOS AGRICOLAS MARISPAN LTDA', city: 'Batatais', state: 'SP' }
        : { cnpj, legalName: 'NOME TOTALMENTE DIFERENTE LTDA', city: 'Manaus', state: 'AM' };
    },
  };
  const r = await resolveCnpj(PROSPECT, deps);
  assert.strictEqual(r.source, 'searxng+rfb');
  assert.strictEqual(r.cnpj, '45299583000131');
  assert.ok(calls.byCnpj >= 1);
});

test('resolveCnpj retorna null quando nada casa acima do limiar', async () => {
  const deps = {
    searchCompanies: async () => [
      { cnpj: '11222333000181', legalName: 'NOME SEM RELACAO NENHUMA COM O LEAD', city: 'Manaus', state: 'AM' },
    ],
    searxSearch: async () => [],
  };
  assert.strictEqual(await resolveCnpj(PROSPECT, deps), null);
  assert.strictEqual(await resolveCnpj({ companyName: '' }, deps), null);
});

// ── Gating por plano: deep enrich é exclusivo do Premium ────────────────────

test('trial: deep enrich sem CNPJ marca indisponível com upsell, sem chamar fontes pagas', async () => {
  const { _deepEnrichWithoutCnpj } = require('../lead-enrichment');
  let captured = null;
  const prismaStub = {
    prospect: {
      findUnique: async () => null,
      update: async ({ data }) => {
        captured = data;
        return { id: 'p1' };
      },
    },
  };
  const prospect = { id: 'p1', orgId: 'org_trial', companyName: 'Alguem LTDA', city: 'X', cnpj: null };
  await _deepEnrichWithoutCnpj(prismaStub, prospect, { orgPlan: 'trial' });
  assert.strictEqual(captured.enrichmentStatus, 'unavailable');
  assert.match(captured.enrichmentError, /Premium/);
  assert.strictEqual(captured.enrichmentSummary, undefined); // nada de PDL/scans
});

test('logoForDomain monta URL do Clearbit', async () => {
  const { logoForDomain } = require('../lead-enrichment');
  assert.strictEqual(logoForDomain('dedini.com.br'), 'https://logo.clearbit.com/dedini.com.br');
  assert.strictEqual(logoForDomain(null), null);
});
