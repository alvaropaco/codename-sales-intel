const test = require('node:test');
const assert = require('node:assert');
const {
  computeOpportunityScore,
  isActive,
  porteInfo,
  cnaeMatches,
  segmentMatches,
  locationMatches,
} = require('../opportunity-score');

// Payload BrasilAPI representativo (campos usados pelo scoring).
function cnpjData(overrides = {}) {
  return {
    razao_social: 'Empresa Exemplo LTDA',
    situacao_cadastral: 2,
    descricao_situacao_cadastral: 'ATIVA',
    data_inicio_atividade: '2010-06-15',
    capital_social: 500000.0,
    porte: '03',
    cnae_fiscal: 6201501,
    cnae_fiscal_descricao: 'Desenvolvimento de programas de computador sob encomenda',
    email: 'contato@empresa.com',
    ddd_telefone_1: '11999998888',
    ...overrides,
  };
}

const prospect = { city: 'Campinas', state: 'SP', cnpjOpenedAt: new Date('2010-06-15') };

const fullProfile = {
  targetCnaes: ['6201-5/01'],
  targetSegments: ['Tecnologia'],
  targetLocations: ['Campinas - SP'],
  targetSizes: ['medium'],
};

test('lead aderente, ativo, capital alto e com contatos pontua alto', () => {
  const data = cnpjData({ cnae_fiscal_descricao: 'Consultoria em tecnologia da informação' });
  const { score, breakdown } = computeOpportunityScore({ cnpjData: data, prospect, profile: fullProfile });
  assert.strictEqual(breakdown.active, 15);
  assert.strictEqual(breakdown.capital, 16);
  assert.strictEqual(breakdown.age, 15);
  assert.strictEqual(breakdown.size, 10);
  assert.strictEqual(breakdown.contacts, 20);
  assert.strictEqual(breakdown.fit, 20);
  assert.strictEqual(score, 96);
});

test('cada dimensão contribui e lead fraco pontua baixo', () => {
  const weak = cnpjData({
    situacao_cadastral: 3,
    descricao_situacao_cadastral: 'SUSPENSA',
    data_inicio_atividade: new Date().toISOString().slice(0, 10),
    capital_social: 0,
    porte: '05',
    cnae_fiscal: 4711302,
    cnae_fiscal_descricao: 'Comércio varejista de mercadorias em geral',
    email: null,
    ddd_telefone_1: null,
  });
  const { score, breakdown } = computeOpportunityScore({
    cnpjData: weak,
    prospect: { city: null, state: null, cnpjOpenedAt: new Date() },
    profile: fullProfile,
  });
  // MEI fora do porte alvo, sem contatos, suspensa, recém-aberta, sem aderência:
  // só idade 2 + porte 5
  assert.deepStrictEqual(breakdown.fit, 0);
  assert.strictEqual(score, 7);
});

test('sem perfil comercial, aderência recebe nota neutra', () => {
  const { breakdown } = computeOpportunityScore({
    cnpjData: cnpjData(),
    prospect,
    profile: null,
  });
  assert.strictEqual(breakdown.fit, 10);
});

test('score é limitado a 0–100', () => {
  const { score } = computeOpportunityScore({
    cnpjData: cnpjData({ capital_social: 50_000_000 }),
    prospect,
    profile: fullProfile,
  });
  assert.ok(score <= 100 && score > 0);
});

test('isActive aceita id 2 ou descrição "ATIVA"', () => {
  assert.strictEqual(isActive(cnpjData()), true);
  assert.strictEqual(isActive(cnpjData({ situacao_cadastral: null, descricao_situacao_cadastral: 'ATIVA' })), true);
  assert.strictEqual(isActive(cnpjData({ situacao_cadastral: 3, descricao_situacao_cadastral: 'SUSPENSA' })), false);
  assert.strictEqual(isActive(null), false);
});

test('porteInfo normaliza id numérico, objeto e texto da BrasilAPI', () => {
  assert.deepStrictEqual(porteInfo({ porte: '03' }), { id: '03', size: 'medium' });
  assert.deepStrictEqual(porteInfo({ porte: { id: '05', descricao: 'MEI' } }), { id: '05', size: 'small' });
  assert.deepStrictEqual(porteInfo({ porte: 'MICRO EMPRESA' }), { id: '01', size: 'small' });
  assert.deepStrictEqual(porteInfo({ porte: 'EMPRESA DE PEQUENO PORTE' }), { id: '03', size: 'medium' });
  assert.deepStrictEqual(porteInfo({ porte: 'DEMAIS' }), { id: '00', size: 'large' });
  assert.deepStrictEqual(porteInfo({}), { id: '00', size: 'large' });
});

test('cnaeMatches tolera formatação e prefixo', () => {
  assert.strictEqual(cnaeMatches(['6201-5/01'], cnpjData()), true);
  assert.strictEqual(cnaeMatches(['6201501'], cnpjData()), true);
  assert.strictEqual(cnaeMatches(['4711-3/02'], cnpjData()), false);
  assert.strictEqual(cnaeMatches([], cnpjData()), false);
});

test('segmentMatches casa token do segmento na descrição do CNAE', () => {
  assert.strictEqual(segmentMatches(['Tecnologia'], 'Desenvolvimento de software e tecnologia da informação'), true);
  assert.strictEqual(segmentMatches(['Alimentos'], 'Desenvolvimento de software'), false);
});

test('locationMatches casa cidade ou UF de "Cidade - UF"', () => {
  assert.strictEqual(locationMatches(['Campinas - SP'], prospect), true);
  assert.strictEqual(locationMatches(['São Paulo - SP'], { city: 'Santos', state: 'SP' }), true);
  assert.strictEqual(locationMatches(['Rio de Janeiro - RJ'], prospect), false);
  assert.strictEqual(locationMatches(['Curitiba - PR'], { city: null, state: null }), false);
});
