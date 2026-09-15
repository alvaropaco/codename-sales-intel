const test = require('node:test');
const assert = require('node:assert');
const {
  parseCsv,
  sniffDelimiter,
  isValidCnpj,
  normalizeEmail,
  normalizeDomain,
  normalizePhones,
  normalizeState,
  normalizeCount,
  normalizeMoney,
  heuristicMapping,
  sanitizeMapping,
  cnpjColumnLooksValid,
  inferMappingWithLlm,
  resolveMapping,
  buildRecord,
  computeImportKey,
} = require('../csv-import');

// CNPJ válido conhecido (dígitos verificadores corretos).
const CNPJ_VALIDO = '11.222.333/0001-81';
const CNPJ_VALIDO_DIGITS = '11222333000181';

// ── Validação de CNPJ ───────────────────────────────────────────────────────

test('isValidCnpj aceita CNPJ com máscara e rejeita dígito verificador errado', () => {
  assert.strictEqual(isValidCnpj(CNPJ_VALIDO), true);
  assert.strictEqual(isValidCnpj(CNPJ_VALIDO_DIGITS), true);
  assert.strictEqual(isValidCnpj('11.222.333/0001-80'), false); // DV errado
  assert.strictEqual(isValidCnpj('11111111111111'), false); // dígitos repetidos
  assert.strictEqual(isValidCnpj('123'), false);
  assert.strictEqual(isValidCnpj(''), false);
  assert.strictEqual(isValidCnpj('abc'), false);
});

// ── Parser CSV ──────────────────────────────────────────────────────────────

test('parseCsv detecta delimitador ponto-e-vírgula (padrão BR) e vírgula', () => {
  assert.strictEqual(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.strictEqual(sniffDelimiter('a,b,c\n1,2,3'), ',');
  assert.strictEqual(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
});

test('parseCsv lê campos entre aspas com separador e aspas escapadas dentro', () => {
  const csv = [
    '"Razão Social";CNPJ',
    '"Empresa LTDA; Filial";11222333000181',
    '"Empresa ""Premium"" LTDA";11222333000181',
  ].join('\n');
  const { headers, records, delimiter } = parseCsv(csv);
  assert.strictEqual(delimiter, ';');
  assert.deepStrictEqual(headers, ['Razão Social', 'CNPJ']);
  assert.strictEqual(records[0]['Razão Social'], 'Empresa LTDA; Filial');
  assert.strictEqual(records[1]['Razão Social'], 'Empresa "Premium" LTDA');
});

test('parseCsv ignora BOM, linhas vazias e aceita CRLF', () => {
  const csv = `\uFEFFCNPJ;Empresa\r\n11222333000181;A LTDA\r\n\r\n;`;
  const { headers, records } = parseCsv(csv);
  assert.deepStrictEqual(headers, ['CNPJ', 'Empresa']);
  assert.strictEqual(records.length, 1);
});

test('parseCsv respeita maxRows', () => {
  const lines = ['CNPJ', ...Array.from({ length: 10 }, () => CNPJ_VALIDO_DIGITS)].join('\n');
  const { records, truncated } = parseCsv(lines, { maxRows: 5 });
  assert.strictEqual(records.length, 5); // teto = linhas de dados mantidas
  assert.strictEqual(truncated, true);
  const { records: todas, truncated: semCorte } = parseCsv(lines, { maxRows: 20 });
  assert.strictEqual(todas.length, 10);
  assert.strictEqual(semCorte, false);
});

test('parseCsv preenche células faltantes e nomeia colunas vazias', () => {
  const csv = 'CNPJ;;Cidade\n11222333000181;Foo';
  const { headers, records } = parseCsv(csv);
  assert.deepStrictEqual(headers, ['CNPJ', 'coluna_2', 'Cidade']);
  assert.strictEqual(records[0].Cidade, '');
});

// ── Normalização de valores ─────────────────────────────────────────────────

test('normalizeEmail valida e lowerca; rejeita lixo', () => {
  assert.strictEqual(normalizeEmail(' Contato@Empresa.COM '), 'contato@empresa.com');
  assert.strictEqual(normalizeEmail('sem-arroba'), null);
  assert.strictEqual(normalizeEmail(''), null);
});

test('normalizeDomain extrai host de URL, www e caminho', () => {
  assert.strictEqual(normalizeDomain('https://www.alfa.com.br/contato'), 'alfa.com.br');
  assert.strictEqual(normalizeDomain('WWW.Beta.COM'), 'beta.com');
  assert.strictEqual(normalizeDomain('gama.com.br'), 'gama.com.br');
  assert.strictEqual(normalizeDomain('não é domínio'), null);
  assert.strictEqual(normalizeDomain(''), null);
});

test('normalizePhones extrai múltiplos telefones deduplicados', () => {
  assert.deepStrictEqual(
    normalizePhones('(11) 3322-4455 / 11 99888-7766, 11998887766'),
    ['1133224455', '11998887766']
  );
  assert.deepStrictEqual(normalizePhones('123'), []); // curto demais
  assert.deepStrictEqual(normalizePhones(''), []);
});

test('normalizeState resolve sigla e nome por extenso (sem acento)', () => {
  assert.strictEqual(normalizeState('sp'), 'SP');
  assert.strictEqual(normalizeState('São Paulo'), 'SP');
  assert.strictEqual(normalizeState('minas gerais'), 'MG');
  assert.strictEqual(normalizeState(''), null);
});

test('normalizeCount lê número puro, texto e topo de faixa', () => {
  assert.strictEqual(normalizeCount('25'), 25);
  assert.strictEqual(normalizeCount('25 funcionários'), 25);
  assert.strictEqual(normalizeCount('10-49'), 49);
  assert.strictEqual(normalizeCount('de 10 a 49'), 49);
  assert.strictEqual(normalizeCount('1.000'), 1000);
  assert.strictEqual(normalizeCount(''), null);
  assert.strictEqual(normalizeCount('muitos'), null);
});

test('normalizeMoney entende formato BR, sufixos e rejeita lixo', () => {
  assert.strictEqual(normalizeMoney('R$ 1.500.000,00'), 1500000);
  assert.strictEqual(normalizeMoney('1.500.000'), 1500000);
  assert.strictEqual(normalizeMoney('1500000'), 1500000);
  assert.strictEqual(normalizeMoney('1,5 mi'), 1500000);
  assert.strictEqual(normalizeMoney('500 mil'), 500000);
  assert.strictEqual(normalizeMoney('300k'), 300000);
  assert.strictEqual(normalizeMoney('1500.50'), 1501);
  assert.strictEqual(normalizeMoney('abc'), null);
  assert.strictEqual(normalizeMoney(''), null);
});

// ── Mapeamento heurístico (fallback sem IA) ─────────────────────────────────

test('heuristicMapping mapeia cabeçalhos comuns BR para o modelo Prospect', () => {
  const mapping = heuristicMapping([
    'CNPJ', 'Razão Social', 'Nome Fantasia', 'Segmento', 'Site', 'Cidade', 'UF',
    'E-mail', 'Telefone', 'Nº Funcionários', 'Faturamento Estimado', 'Observações',
  ]);
  assert.strictEqual(mapping.cnpj, 'CNPJ');
  assert.strictEqual(mapping.companyName, 'Razão Social');
  assert.strictEqual(mapping.tradeName, 'Nome Fantasia');
  assert.strictEqual(mapping.industry, 'Segmento');
  assert.strictEqual(mapping.domain, 'Site');
  assert.strictEqual(mapping.city, 'Cidade');
  assert.strictEqual(mapping.state, 'UF');
  assert.strictEqual(mapping.email, 'E-mail');
  assert.strictEqual(mapping.phone, 'Telefone');
  assert.strictEqual(mapping.employees, 'Nº Funcionários');
  assert.strictEqual(mapping.revenueEstimate, 'Faturamento Estimado');
  // Coluna sem campo correspondente fica de fora.
  assert.strictEqual(Object.values(mapping).includes('Observações'), false);
});

test('sanitizeMapping descarta colunas inexistentes e duplicadas', () => {
  const mapping = sanitizeMapping(
    { cnpj: 'CNPJ', companyName: 'NaoExiste', city: 'CNPJ' },
    ['CNPJ', 'Cidade']
  );
  assert.strictEqual(mapping.cnpj, 'CNPJ');
  assert.strictEqual(mapping.companyName, undefined);
  assert.strictEqual(mapping.city, undefined); // coluna CNPJ já usada
});

test('cnpjColumnLooksValid rejeita coluna que não contém CNPJ', () => {
  const rows = [
    { 'Doc': '123.456.789-00' }, // CPF
    { 'Doc': '987.654.321-00' },
  ];
  assert.strictEqual(cnpjColumnLooksValid(rows, 'Doc'), false);
  assert.strictEqual(cnpjColumnLooksValid([{ Doc: CNPJ_VALIDO }], 'Doc'), true);
});

// ── Mapeamento por IA (LLM injetável) ───────────────────────────────────────

const AMOSTRA = [
  { 'Cód': '1', 'CNPJ da Empresa': CNPJ_VALIDO, 'Nome da Empresa': 'Alpha LTDA', 'Cidade': 'Campinas' },
  { 'Cód': '2', 'CNPJ da Empresa': '22.222.333/0001-10', 'Nome da Empresa': 'Beta LTDA', 'Cidade': 'Sorocaba' },
];

test('inferMappingWithLlm sanitiza resposta da IA para colunas reais', async () => {
  const fakeLlm = async () => ({
    content: JSON.stringify({
      mapping: {
        cnpj: 'CNPJ da Empresa',
        companyName: 'Nome da Empresa',
        city: 'Cidade',
        industry: 'Coluna Inexistente', // alucinação → descartada
      },
      notes: 'Planilha com CNPJ e razão social.',
    }),
  });
  const { mapping, notes } = await inferMappingWithLlm(
    ['Cód', 'CNPJ da Empresa', 'Nome da Empresa', 'Cidade'],
    AMOSTRA,
    { callLlm: fakeLlm }
  );
  assert.strictEqual(mapping.cnpj, 'CNPJ da Empresa');
  assert.strictEqual(mapping.companyName, 'Nome da Empresa');
  assert.strictEqual(mapping.industry, undefined);
  assert.strictEqual(notes, 'Planilha com CNPJ e razão social.');
});

test('inferMappingWithLlm lança quando a IA não devolve JSON de mapping', async () => {
  await assert.rejects(
    () => inferMappingWithLlm(['CNPJ'], AMOSTRA, { callLlm: async () => ({ content: 'blz' }) })
  );
});

test('resolveMapping usa a IA e completa lacunas com o heurístico', async () => {
  const fakeLlm = async () => ({
    content: JSON.stringify({
      mapping: { cnpj: 'CNPJ da Empresa', companyName: 'Nome da Empresa' },
      notes: 'ok',
    }),
  });
  const { mapping, source } = await resolveMapping(
    ['CNPJ da Empresa', 'Nome da Empresa', 'Cidade'],
    AMOSTRA,
    { callLlm: fakeLlm }
  );
  assert.strictEqual(source, 'ai+heuristic');
  assert.strictEqual(mapping.cnpj, 'CNPJ da Empresa'); // amostra valida o campo
  assert.strictEqual(mapping.city, 'Cidade'); // heurístico completou
});

test('resolveMapping derruba coluna apontada como CNPJ que não contém CNPJ', async () => {
  // IA aponta a coluna de CPF como CNPJ → validação da amostra descarta o
  // campo; o heurístico não encontra outro → mapping sem cnpj (rota → 422).
  const fakeLlm = async () => ({
    content: JSON.stringify({ mapping: { cnpj: 'CPF do Contato', city: 'Cidade' } }),
  });
  const headers = ['CPF do Contato', 'Cidade'];
  const rows = [{ 'CPF do Contato': '123.456.789-00', 'Cidade': 'Campinas' }];
  const { mapping, source } = await resolveMapping(headers, rows, { callLlm: fakeLlm });
  assert.strictEqual(mapping.cnpj, undefined);
  assert.strictEqual(mapping.city, 'Cidade'); // mapeado pela IA antes do delete
  assert.strictEqual(source, 'ai');
});

test('resolveMapping cai no heurístico quando a IA lança erro', async () => {
  const falha = async () => { throw new Error('gateway indisponível'); };
  const { mapping, source } = await resolveMapping(
    ['CNPJ da Empresa', 'Nome da Empresa'],
    AMOSTRA,
    { callLlm: falha }
  );
  assert.strictEqual(source, 'heuristic');
  assert.strictEqual(mapping.cnpj, 'CNPJ da Empresa');
  assert.strictEqual(mapping.companyName, 'Nome da Empresa');
});

// ── buildRecord — linha → modelo Prospect ───────────────────────────────────

const MAPPING_COMPLETO = heuristicMapping([
  'CNPJ', 'Razão Social', 'Fantasia', 'Ramo', 'Site', 'Cidade', 'UF', 'Email', 'Telefone', 'Funcionários', 'Faturamento',
]);

test('buildRecord normaliza a linha no formato do Prospect', () => {
  const { record, issues } = buildRecord(
    {
      'CNPJ': CNPJ_VALIDO,
      'Razão Social': '  Alpha Comércio LTDA  ',
      'Fantasia': 'Alpha',
      'Ramo': 'Varejo',
      'Site': 'https://www.alfa.com.br/contato',
      'Cidade': 'Campinas',
      'UF': 'São Paulo',
      'Email': 'CONTATO@alpha.com.br',
      'Telefone': '(19) 3322-4455 / 19 99888-7766',
      'Funcionários': '10-49',
      'Faturamento': 'R$ 2.000.000,00',
    },
    MAPPING_COMPLETO
  );
  assert.deepStrictEqual(issues, []);
  assert.strictEqual(record.cnpj, CNPJ_VALIDO_DIGITS);
  assert.strictEqual(record.taxIdType, 'br_cnpj');
  assert.strictEqual(record.companyName, 'Alpha Comércio LTDA');
  assert.strictEqual(record.tradeName, 'Alpha');
  assert.strictEqual(record.industry, 'Varejo');
  assert.strictEqual(record.domain, 'alfa.com.br');
  assert.strictEqual(record.city, 'Campinas');
  assert.strictEqual(record.state, 'SP');
  assert.strictEqual(record.cnpjEmail, 'contato@alpha.com.br');
  assert.deepStrictEqual(record.cnpjPhones, ['1933224455', '19998887766']);
  assert.strictEqual(record.employees, 49);
  assert.strictEqual(record.revenueEstimate, 2000000);
});

test('buildRecord cadastra lead sem CNPJ (pendente de chave) quando há nome', () => {
  const { record, issues } = buildRecord(
    { 'CNPJ': '', 'Razão Social': 'Delta Serviços LTDA', 'Cidade': 'Curitiba' },
    MAPPING_COMPLETO
  );
  assert.deepStrictEqual(issues, []);
  assert.strictEqual(record.cnpj, null);
  assert.strictEqual(record.taxIdType, null);
  assert.strictEqual(record.companyName, 'Delta Serviços LTDA');
});

test('buildRecord rejeita CNPJ com DV inválido e linha sem identidade', () => {
  const dvErrado = buildRecord({ 'CNPJ': '11.222.333/0001-99' }, MAPPING_COMPLETO);
  assert.strictEqual(dvErrado.record, null);
  assert.match(dvErrado.issues[0], /inválido/);

  const semNada = buildRecord({ 'CNPJ': '', 'Razão Social': '' }, MAPPING_COMPLETO);
  assert.strictEqual(semNada.record, null);
  assert.match(semNada.issues[0], /sem nome da empresa e sem CNPJ/);
});

test('buildRecord tolera campos ausentes no mapeamento e avisa sobre lixo', () => {
  const { record, issues } = buildRecord(
    { 'CNPJ': CNPJ_VALIDO, 'Razão Social': 'Alpha LTDA', 'Faturamento': 'não informado' },
    { cnpj: 'CNPJ', companyName: 'Razão Social', revenueEstimate: 'Faturamento' }
  );
  assert.strictEqual(record.tradeName, null);
  assert.strictEqual(record.city, null);
  assert.strictEqual(record.cnpjPhones, null);
  assert.strictEqual(record.employees, null);
  assert.strictEqual(record.revenueEstimate, null);
  assert.strictEqual(issues.length, 1);
  assert.match(issues[0], /Faturamento ilegível/);
});

test('buildRecord usa nome fantasia/CNPJ quando falta a razão social', () => {
  const comFantasia = buildRecord({ 'CNPJ': CNPJ_VALIDO, 'Fantasia': 'Alpha' }, MAPPING_COMPLETO);
  assert.strictEqual(comFantasia.record.companyName, 'Alpha');

  const soCnpj = buildRecord({ 'CNPJ': CNPJ_VALIDO }, MAPPING_COMPLETO);
  assert.strictEqual(soCnpj.record.companyName, CNPJ_VALIDO_DIGITS);
});

// ── computeImportKey — dedup idempotente de leads sem CNPJ ──────────────────

test('computeImportKey: e-mail primeiro, senão nome+cidade normalizados; com CNPJ é null', () => {
  assert.strictEqual(computeImportKey({ cnpj: CNPJ_VALIDO_DIGITS }), null);

  assert.strictEqual(
    computeImportKey({ cnpj: null, cnpjEmail: 'Contato@Alfa.com', companyName: 'Alfa' }),
    'email:contato@alfa.com'
  );

  assert.strictEqual(
    computeImportKey({ cnpj: null, cnpjEmail: null, companyName: '  Alfa Comércio LTDA  ', city: 'São Paulo' }),
    'nome:alfa comercio|sao paulo'
  );

  // Determinístico entre uploads do mesmo arquivo.
  const a = computeImportKey({ cnpj: null, companyName: 'Beta Eireli ME', city: null });
  const b = computeImportKey({ cnpj: null, companyName: 'beta eireli  me', city: '' });
  assert.strictEqual(a, b);

  assert.strictEqual(computeImportKey({ cnpj: null, companyName: '', city: null }), null);
});
