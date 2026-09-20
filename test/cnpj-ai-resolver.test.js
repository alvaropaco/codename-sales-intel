'use strict';

/**
 * Testes do resolutor de CNPJ assistido por IA (feature 005 — hotfill de
 * leads importados sem CNPJ). Módulo puro cnpj-ai-resolver.js com DI:
 * LLM e busca injetados, sem rede nos testes.
 *
 * Garantias de segurança:
 * - o CNPJ candidato NUNCA vem da memória do modelo: só de resultados de
 *   busca confirmados por lookup oficial (RFB);
 * - DV do CNPJ validado antes de qualquer aceite;
 * - match do LLM só é aceito acima do limiar de confiança.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  parseVariants,
  parseMatch,
  extractCandidatesFromResults,
  resolveWithAi,
} = require('../cnpj-ai-resolver');

const LEAD = { companyName: 'STAMPCOM METALÚRGICA LTDA', city: 'SÃO PAULO', state: 'SP' };

const VARIANTS_JSON = JSON.stringify({
  variants: [
    'STAMPCOM METALURGICA LTDA',
    'STAMPCOM INDUSTRIA E COMERCIO',
    'STAMP COM METALURGICA',
  ],
});

// CNPJ real (DV válido): 45.723.174/0001-10 (Vivo), só para validação de DV.
const VALID_CNPJ = '45723174000110';

// ── parseVariants ───────────────────────────────────────────────────────────

test('parseVariants normaliza variações do LLM (JSON, cercas, limites)', () => {
  assert.deepStrictEqual(parseVariants(VARIANTS_JSON), [
    'STAMPCOM METALURGICA LTDA',
    'STAMPCOM INDUSTRIA E COMERCIO',
    'STAMP COM METALURGICA',
  ]);
  assert.deepStrictEqual(
    parseVariants('```json\n{"variants":["A LTDA","B"]}\n```'),
    ['A LTDA', 'B']
  );
  // Máximo 5 variantes; strings vazias descartadas
  assert.strictEqual(
    parseVariants(JSON.stringify({ variants: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).length,
    5
  );
});

test('parseVariants rejeita conteúdo inválido', () => {
  assert.throws(() => parseVariants('não sei'));
  assert.throws(() => parseVariants(JSON.stringify({ variants: 'uma string' })));
  assert.throws(() => parseVariants(JSON.stringify({ variants: [] })));
});

// ── parseMatch ──────────────────────────────────────────────────────────────

test('parseMatch valida DV do CNPJ e limiar de confiança', () => {
  const m = parseMatch(
    JSON.stringify({ cnpj: VALID_CNPJ, confidence: 0.9, reason: 'mesma razão social e cidade' }),
    0.7
  );
  assert.strictEqual(m.cnpj, VALID_CNPJ);
  assert.strictEqual(m.confidence, 0.9);

  // DV inválido → rejeita mesmo com confiança alta
  assert.throws(() =>
    parseMatch(JSON.stringify({ cnpj: '12345678000199', confidence: 0.95 }), 0.7)
  );
  // Abaixo do limiar → null (não é erro, é "sem match confiável")
  assert.strictEqual(
    parseMatch(JSON.stringify({ cnpj: VALID_CNPJ, confidence: 0.4 }), 0.7),
    null
  );
  // CNPJ vindo formatado (com pontuação) é normalizado
  assert.strictEqual(
    parseMatch(JSON.stringify({ cnpj: '45.723.174/0001-10', confidence: 0.8 }), 0.7).cnpj,
    VALID_CNPJ
  );
  assert.throws(() => parseMatch('lixo', 0.7));
});

// ── extractCandidatesFromResults ────────────────────────────────────────────

test('extrai candidatos de CNPJ dos resultados de busca com DV válido', () => {
  const results = [
    { title: 'STAMPCOM', content: 'CNPJ 45.723.174/0001-10 - telefone', url: 'https://x' },
    { title: 'outro', content: 'CNPJ 12.345.678/0001-99 inválido', url: 'https://y' },
    { title: 'de novo', content: 'CNPJ 45.723.174/0001-10 repete', url: 'https://z' },
  ];
  assert.deepStrictEqual(extractCandidatesFromResults(results), [VALID_CNPJ]);
});

// ── resolveWithAi (orquestração com DI) ─────────────────────────────────────

function fakeDeps(overrides = {}) {
  // A chamada de variantes não contém "candidatos"; a do juiz contém.
  const callLlm = overrides.callLlm || (async ({ user }) => {
    if (!user.includes('candidatos')) return { content: VARIANTS_JSON, model: 'fake' };
    return {
      content: JSON.stringify({ cnpj: VALID_CNPJ, confidence: 0.85, reason: 'ok' }),
      model: 'fake',
    };
  });
  return {
    callLlm,
    searxSearch: overrides.searxSearch || (async () => [
      { title: 'STAMPCOM', content: `CNPJ ${VALID_CNPJ} - São Paulo`, url: 'https://x' },
    ]),
    getCompanyByCnpj: overrides.getCompanyByCnpj || (async () => ({
      cnpj: VALID_CNPJ,
      legalName: 'STAMPCOM INDUSTRIA METALURGICA LTDA',
      city: 'SAO PAULO',
      state: 'SP',
    })),
    isValidCnpj: overrides.isValidCnpj,
  };
}

test('resolveWithAi: variações → busca → lookup oficial → match do LLM', async () => {
  const searches = [];
  const r = await resolveWithAi(LEAD, fakeDeps({
    searxSearch: async (q) => {
      searches.push(q);
      return [{ title: 'resultado', content: `CNPJ ${VALID_CNPJ}`, url: 'x' }];
    },
  }));
  assert.strictEqual(r.cnpj, VALID_CNPJ);
  assert.strictEqual(r.source, 'ia');
  assert.strictEqual(r.confidence, 0.85);
  assert.ok(searches.length >= 2, 'deve buscar a razão social original + variações');
  assert.ok(searches[0].includes('STAMPCOM'), '1ª busca usa o nome original');
});

test('resolveWithAi: LLM sem match confiável → null (não inventa)', async () => {
  const r = await resolveWithAi(LEAD, fakeDeps({
    callLlm: async ({ user }) => {
      if (!user.includes('candidatos')) return { content: VARIANTS_JSON, model: 'fake' };
      return {
        content: JSON.stringify({ cnpj: VALID_CNPJ, confidence: 0.3, reason: 'parecido demais' }),
        model: 'fake',
      };
    },
  }));
  assert.strictEqual(r, null);
});

test('resolveWithAi: sem candidatos nas buscas não chama o juiz do LLM', async () => {
  let judgeCalls = 0;
  const r = await resolveWithAi(LEAD, fakeDeps({
    searxSearch: async () => [],
    callLlm: async ({ user }) => {
      if (!user.includes('candidatos')) return { content: VARIANTS_JSON, model: 'fake' };
      judgeCalls += 1;
      return { content: JSON.stringify({ cnpj: VALID_CNPJ, confidence: 0.9 }), model: 'fake' };
    },
  }));
  assert.strictEqual(r, null);
  assert.strictEqual(judgeCalls, 0);
});

test('resolveWithAi: falha de busca não derruba o fluxo (degrada para null)', async () => {
  const r = await resolveWithAi(LEAD, fakeDeps({
    searxSearch: async () => { throw new Error('searx fora'); },
  }));
  assert.strictEqual(r, null);
});
