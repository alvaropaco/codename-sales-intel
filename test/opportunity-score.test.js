const test = require('node:test');
const assert = require('node:assert');
const {
  computeOpportunityScore,
  isActive,
  porteInfo,
  cnaeMatches,
  segmentMatches,
  locationMatches,
  classifyEmailDomain,
  presenceBreakdown,
  structureBreakdown,
  partnerNameInText,
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
  assert.strictEqual(breakdown.active, 10);
  assert.strictEqual(breakdown.capital, 13);
  assert.strictEqual(breakdown.age, 10);
  assert.strictEqual(breakdown.size, 5);
  assert.strictEqual(breakdown.contacts, 15);
  assert.strictEqual(breakdown.presence, 10); // site/social desconhecidos (neutros) + domínio próprio
  assert.strictEqual(breakdown.structure, 4); // QSA desconhecido (neutro)
  assert.strictEqual(breakdown.fit, 15);
  assert.strictEqual(score, 82);
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
  // MEI fora do porte alvo, sem contatos, suspensa, recém-aberta, sem aderência
  assert.deepStrictEqual(breakdown.fit, 0);
  assert.deepStrictEqual(breakdown.contacts, 0);
  assert.strictEqual(score, 14); // idade 1 + porte 2 + presença neutra 7 + estrutura neutra 4
});

test('sem perfil comercial, aderência recebe nota neutra', () => {
  const { breakdown } = computeOpportunityScore({
    cnpjData: cnpjData(),
    prospect,
    profile: null,
  });
  assert.strictEqual(breakdown.fit, 8);
});

test('score é limitado a 0–100', () => {
  const { score } = computeOpportunityScore({
    cnpjData: cnpjData({ capital_social: 50_000_000 }),
    prospect,
    profile: fullProfile,
  });
  assert.ok(score <= 100 && score > 0);
});

test('capital acima de R$ 50 mil pontua mais que capital baixo', () => {
  const bom = computeOpportunityScore({ cnpjData: cnpjData({ capital_social: 60_000 }), prospect, profile: null });
  const baixo = computeOpportunityScore({ cnpjData: cnpjData({ capital_social: 5_000 }), prospect, profile: null });
  assert.strictEqual(bom.breakdown.capital, 7);
  assert.strictEqual(baixo.breakdown.capital, 0);
  assert.ok(bom.score > baixo.score);
});

test('domínio próprio pontua mais que contabilidade e que provedor grátis', () => {
  const run = (email) => computeOpportunityScore({
    cnpjData: cnpjData({ email }),
    prospect,
    profile: null,
  });
  const proprio = run('contato@empresa.com');
  const contabilidade = run('empresa.123@contabilizei.com.br');
  const gratis = run('empresa@gmail.com');
  const outroContabil = run('contato@contabilidademaria.com.br');
  // domínio próprio 5 · grátis 1 · contabilidade 0
  assert.strictEqual(proprio.breakdown.presence, 10);
  assert.strictEqual(gratis.breakdown.presence, 6);
  assert.strictEqual(contabilidade.breakdown.presence, 5);
  assert.strictEqual(outroContabil.breakdown.presence, 5);
  assert.ok(proprio.score > contabilidade.score);
  assert.ok(gratis.score > contabilidade.score);
});

test('classifyEmailDomain classifica próprio, grátis, contabilidade e vazio', () => {
  assert.strictEqual(classifyEmailDomain('contato@empresa.com.br'), 'own');
  assert.strictEqual(classifyEmailDomain('a@gmail.com'), 'free');
  assert.strictEqual(classifyEmailDomain('a@hotmail.com'), 'free');
  assert.strictEqual(classifyEmailDomain('x@contabilizei.com.br'), 'accounting');
  assert.strictEqual(classifyEmailDomain('x@meucontador.com'), 'accounting');
  assert.strictEqual(classifyEmailDomain(''), null);
  assert.strictEqual(classifyEmailDomain(null), null);
});

test('sem telefone e sem site pontuam menos que com eles', () => {
  const comTudo = computeOpportunityScore({
    cnpjData: cnpjData(),
    prospect: { ...prospect, enrichmentSummary: { website_active: true } },
    profile: null,
  });
  const semTelefone = computeOpportunityScore({
    cnpjData: cnpjData({ ddd_telefone_1: null }),
    prospect: { ...prospect, enrichmentSummary: { website_active: true } },
    profile: null,
  });
  const semSite = computeOpportunityScore({
    cnpjData: cnpjData(),
    prospect: { ...prospect, enrichmentSummary: { website_active: false } },
    profile: null,
  });
  assert.strictEqual(comTudo.breakdown.contacts, 15);
  assert.strictEqual(semTelefone.breakdown.contacts, 8);
  assert.strictEqual(semSite.breakdown.presence, comTudo.breakdown.presence - 6);
  assert.ok(comTudo.score > semTelefone.score);
  assert.ok(comTudo.score > semSite.score);
});

test('presença na internet: mais sinais do pipeline, mais pontos', () => {
  assert.deepStrictEqual(
    presenceBreakdown({ email: 'a@empresa.com', summary: { website_active: true, social_platforms: 3, tech_count: 2, people: 1 } }).total,
    15,
  );
  // desconhecido = neutro (site 3 + domínio 2 + social 2)
  assert.deepStrictEqual(presenceBreakdown({ email: null, summary: null }).total, 7);
  // site fora do ar detectado + domínio de contabilidade = presença zero
  assert.deepStrictEqual(
    presenceBreakdown({ email: 'x@contabilizei.com.br', summary: { website_active: false, social_platforms: 0 } }).total,
    0,
  );
});

test('estrutura societária: >1 sócio, nome do sócio e fantasia distinta somam', () => {
  assert.deepStrictEqual(
    structureBreakdown({
      names: ['João da Silva', 'Maria Souza'],
      companyName: 'JOAO SILVA COMERCIO DE ALIMENTOS LTDA',
      tradeName: 'SilvaFood',
    }).total,
    15,
  );
  // sócio único sem relação com a marca, mas fantasia própria: 2 + 0 + 5
  assert.deepStrictEqual(
    structureBreakdown({ names: ['João da Silva'], companyName: 'ACME TECNOLOGIA LTDA', tradeName: 'ACME Tech' }).total,
    7,
  );
  // QSA desconhecido: neutro (2 + 2), sem fantasia: 0
  assert.deepStrictEqual(
    structureBreakdown({ names: [], companyName: 'ACME LTDA', tradeName: null }).total,
    4,
  );
  // fantasia igual ao nome do sócio não ganha bônus de marca distinta
  assert.deepStrictEqual(
    structureBreakdown({ names: ['João da Silva'], companyName: 'JOAO SILVA ME', tradeName: 'João Silva' }).total,
    7, // multi 2 + named 5 + distinct 0
  );
});

test('empresa com dois sócios e nome do sócio pontua mais que anônima', () => {
  const base = { capital_social: 100_000, email: 'contato@empresa.com' };
  const familiar = computeOpportunityScore({
    cnpjData: cnpjData({
      ...base,
      razao_social: 'JOAO SILVA COMERCIO LTDA',
      nome_fantasia: 'SilvaTech',
      qsa: [{ nome_socio: 'João da Silva' }, { nome_socio: 'Maria Souza' }],
    }),
    prospect,
    profile: null,
  });
  const anonima = computeOpportunityScore({
    cnpjData: cnpjData({
      ...base,
      razao_social: 'ACME TECNOLOGIA LTDA',
      nome_fantasia: null,
      qsa: [{ nome_socio: 'João da Silva' }],
    }),
    prospect,
    profile: null,
  });
  assert.strictEqual(familiar.breakdown.structure, 15);
  assert.strictEqual(anonima.breakdown.structure, 2); // sócio único 2 + sem match 0 + sem fantasia 0
  assert.ok(familiar.score > anonima.score);
});

test('partnerNameInText casa nome do sócio ignorando conectores e sufixos', () => {
  const names = ['João Pedro da Silva'];
  assert.strictEqual(partnerNameInText('JOAO PEDRO SILVA COMERCIO LTDA', names), true);
  assert.strictEqual(partnerNameInText('SILVA COMERCIO LTDA', names), false); // 1 token só não basta
  assert.strictEqual(partnerNameInText('ACME TECNOLOGIA LTDA', names), false);
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
