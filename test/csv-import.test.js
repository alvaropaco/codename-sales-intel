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
  isContactColumn,
  inferMappingWithLlm,
  verifyMappingWithLlm,
  resolveMapping,
  buildRecord,
  computeImportKey,
  computeHeaderSignature,
  headerSimilarity,
  pickMemoryMapping,
  MEMORY_SIMILARITY_THRESHOLD,
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

// ── Bloqueio de colunas de pessoa de contato ────────────────────────────────

const HEADERS_COM_CONTATO = ['Empresa', 'Contato', 'Cargo', 'Cidade', 'UF', 'Telefone', 'E-mail'];

test('isContactColumn reconhece colunas de pessoa de contato', () => {
  assert.strictEqual(isContactColumn('Contato'), true);
  assert.strictEqual(isContactColumn('Nome do Contato'), true);
  assert.strictEqual(isContactColumn('Responsável Comercial'), true);
  assert.strictEqual(isContactColumn('Cargo'), true);
  assert.strictEqual(isContactColumn('Empresa'), false);
  assert.strictEqual(isContactColumn('E-mail'), false); // email tem padrão próprio
});

test('heuristicMapping nunca usa coluna de contato para campos de texto da empresa', () => {
  const mapping = heuristicMapping(HEADERS_COM_CONTATO);
  assert.strictEqual(mapping.companyName, 'Empresa');
  // "Contato" não vira setor nem razão social nem nada:
  assert.strictEqual(Object.values(mapping).includes('Contato'), false);
  assert.strictEqual(Object.values(mapping).includes('Cargo'), false);
  assert.strictEqual(mapping.industry, undefined); // não há coluna de setor
});

test('sanitizeMapping derruba mapeamento da IA que aponta contato → industry/companyName', () => {
  const mapping = sanitizeMapping(
    { companyName: 'Empresa', industry: 'Contato', city: 'Cidade' },
    HEADERS_COM_CONTATO
  );
  assert.strictEqual(mapping.companyName, 'Empresa');
  assert.strictEqual(mapping.industry, undefined);
  assert.strictEqual(mapping.city, 'Cidade');
});

// ── Auditoria do mapeamento por valores (2ª chamada de LLM) ────────────────

const AMOSTRA_AUDITORIA = [
  { 'Empresa': 'Marisan Ltda', 'Segmento': 'Thiago', 'Cidade': 'Sertãozinho' },
  { 'Empresa': 'Dedini S.A.', 'Segmento': 'Sonia Lima', 'Cidade': 'Pirassununga' },
];

test('verifyMappingWithLlm devolve o julgamento campo a campo', async () => {
  const fakeLlm = async () => ({
    content: JSON.stringify({ verificacao: { companyName: true, industry: false, city: true } }),
  });
  const { verified, failed } = await verifyMappingWithLlm(
    ['Empresa', 'Segmento', 'Cidade'],
    AMOSTRA_AUDITORIA,
    { companyName: 'Empresa', industry: 'Segmento', city: 'Cidade' },
    { callLlm: fakeLlm }
  );
  assert.strictEqual(failed, false);
  assert.strictEqual(verified.industry, false);
  assert.strictEqual(verified.companyName, true);
});

test('verifyMappingWithLlm sinaliza failed quando o gateway não responde JSON', async () => {
  const { failed } = await verifyMappingWithLlm(
    ['Empresa'], AMOSTRA_AUDITORIA, { companyName: 'Empresa' },
    { callLlm: async () => ({ content: 'ok' }) }
  );
  assert.strictEqual(failed, true);
});

test('resolveMapping derrupa campo reprovado na auditoria e registra rejected', async () => {
  let chamada = 0;
  const fakeLlm = async () => {
    chamada++;
    // 1ª chamada: mapeamento (com erro: industry ← Segmento com nomes de pessoa)
    // 2ª chamada: auditoria reprova industry
    return chamada === 1
      ? { content: JSON.stringify({ mapping: { companyName: 'Empresa', industry: 'Segmento', city: 'Cidade' } }) }
      : { content: JSON.stringify({ verificacao: { companyName: true, industry: false, city: true } }) };
  };
  const { mapping, rejected } = await resolveMapping(
    ['Empresa', 'Segmento', 'Cidade'],
    AMOSTRA_AUDITORIA,
    { callLlm: fakeLlm }
  );
  assert.strictEqual(mapping.industry, undefined); // reprovado pela auditoria
  assert.strictEqual(mapping.companyName, 'Empresa');
  assert.ok(rejected.some((r) => r.field === 'industry'));
});

test('resolveMapping mantém o mapeamento quando a auditoria falha (gateway fora)', async () => {
  let chamada = 0;
  const fakeLlm = async () => {
    chamada++;
    if (chamada === 1) {
      return { content: JSON.stringify({ mapping: { companyName: 'Empresa' } }) };
    }
    throw new Error('gateway fora');
  };
  const { mapping } = await resolveMapping(['Empresa'], AMOSTRA_AUDITORIA, { callLlm: fakeLlm });
  assert.strictEqual(mapping.companyName, 'Empresa');
});

// ── Memória de mapeamento (planilhas recorrentes do org) ────────────────────

test('computeHeaderSignature é estável, insensitive a ordem/caixa/acento', () => {
  const a = computeHeaderSignature(['Empresa', 'CNPJ', 'Cidade']);
  const b = computeHeaderSignature(['cnpj', 'CIDADE', 'empresa ']);
  const c = computeHeaderSignature(['Emp resa', 'CNPJ']); // conjunto diferente
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('headerSimilarity: jaccard entre conjuntos de colunas', () => {
  assert.strictEqual(headerSimilarity(['A', 'B'], ['B', 'A']), 1);
  assert.strictEqual(headerSimilarity(['A', 'B'], ['C', 'D']), 0);
  const sim = headerSimilarity(['Empresa', 'CNPJ', 'Cidade', 'UF'], ['Empresa', 'CNPJ', 'Cidade', 'E-mail']);
  assert.strictEqual(sim, 3 / 5); // interseção 3, união 5
});

test('pickMemoryMapping escolhe a memória mais parecida acima do limiar', () => {
  const headers = ['Empresa', 'CNPJ', 'Cidade', 'UF', 'Telefone'];
  const memories = [
    { headers: ['Totalmente', 'Diferente'], mapping: { companyName: 'Totalmente' } },
    { headers: ['Empresa', 'CNPJ', 'Cidade', 'UF', 'Fone'], mapping: { companyName: 'Empresa', phone: 'Fone' } },
    { headers: ['Empresa', 'CNPJ', 'Cidade', 'UF', 'Telefone'], mapping: { companyName: 'Empresa', phone: 'Telefone' } },
  ];
  const best = pickMemoryMapping(headers, memories);
  assert.strictEqual(best.mapping.phone, 'Telefone');
  assert.ok(best.similarity >= MEMORY_SIMILARITY_THRESHOLD);

  // Nada parecido o bastante → null
  assert.strictEqual(pickMemoryMapping(headers, [memories[0]]), null);
  assert.strictEqual(pickMemoryMapping(headers, []), null);
});

test('resolveMapping injeta o mapeamento memorizado no prompt (few-shot)', async () => {
  const prompts = [];
  const fakeLlm = async ({ user }) => {
    prompts.push(user);
    return {
      content: JSON.stringify({
        mapping: { companyName: 'Empresa', phone: 'Fone' },
        notes: 'reuso',
      }),
    };
  };
  const previous = {
    headers: ['Empresa', 'CNPJ', 'Cidade', 'UF', 'Fone'],
    mapping: { companyName: 'Empresa', phone: 'Fone' },
  };
  const rows = [{ 'Empresa': 'A Ltda', 'Fone': '11 3322-4455' }];
  const { mapping, memoryUsed } = await resolveMapping(
    ['Empresa', 'CNPJ', 'Cidade', 'UF', 'Fone'],
    rows,
    { callLlm: fakeLlm, previous }
  );
  assert.strictEqual(memoryUsed, true);
  assert.strictEqual(mapping.phone, 'Fone');
  // 1ª chamada = mapeamento (com o few-shot); 2ª = auditoria de valores
  assert.match(prompts[0], /mapeamento_anterior_aceito/);
  assert.match(prompts[0], /Fone/);

  // Sem memória: flag false e prompt de mapeamento sem o bloco
  prompts.length = 0;
  const r2 = await resolveMapping(['Empresa', 'Fone'], rows, { callLlm: fakeLlm });
  assert.strictEqual(r2.memoryUsed, false);
  assert.doesNotMatch(prompts[0], /mapeamento_anterior_aceito/);
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
