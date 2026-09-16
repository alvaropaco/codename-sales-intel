/**
 * csv-import.js — importação de leads via CSV com entendimento da estrutura
 * por IA (mapeamento de colunas → modelo de dados do B2Base).
 *
 * Estratégia (duas fases):
 *   1. ENTENDIMENTO — uma única chamada de LLM recebe o cabeçalho + uma
 *      amostra das linhas e devolve o mapeamento coluna → campo do Prospect.
 *      A IA mapeia a ESTRUTURA uma vez (barato e consistente), nunca linha a
 *      linha. Se o LLM estiver indisponível ou alucinar, cai num mapeamento
 *      heurístico por similaridade de nome de coluna (fallback determinístico,
 *      padrão do repo).
 *   2. APLICAÇÃO — os valores são normalizados de forma determinística
 *      (CNPJ com dígitos verificadores, telefone, e-mail, faturamento em
 *      formato BR) e gravados como Prospect pelo server-prod.js, que dispara
 *      a esteira de enriquecimento (NATS) como em qualquer outro cadastro.
 */

const { callLlm, parseJsonLoose } = require('./llm-client');

// Limites defensivos: o CSV chega como texto no corpo JSON. 2MB de texto
// cobre ~dezenas de milhares de linhas; o corte de linhas protege o loop de
// importação (e a cota do plano) de arquivos gigantes.
const MAX_CSV_CHARS = 2_000_000;
const MAX_IMPORT_ROWS = 300;
// Linhas enviadas à IA para entender a estrutura (cabeçalho vai separado).
const MAPPING_SAMPLE_ROWS = 8;

// Campos-alvo no modelo Prospect (labels para o prompt e para a UI).
// O CNPJ é a chave de enriquecimento principal no BR, mas é OPCIONAL: leads
// sem identificador fiscal são cadastrados e ficam pendentes de chave
// (informada depois ou resolvida contra a base RFB).
const TARGET_FIELDS = [
  { key: 'cnpj', label: 'CNPJ', description: 'CNPJ da empresa (com ou sem máscara); opcional' },
  { key: 'companyName', label: 'Razão social', description: 'Nome legal / razão social da empresa' },
  { key: 'tradeName', label: 'Nome fantasia', description: 'Nome comercial / de fantasia' },
  { key: 'industry', label: 'Setor', description: 'Segmento, atividade econômica ou CNAE' },
  { key: 'domain', label: 'Site', description: 'Site/domínio da empresa (ex.: alfa.com.br)' },
  { key: 'city', label: 'Cidade', description: 'Município' },
  { key: 'state', label: 'UF', description: 'Estado (sigla ou nome)' },
  { key: 'email', label: 'E-mail', description: 'E-mail de contato da empresa' },
  { key: 'phone', label: 'Telefone', description: 'Telefone, celular ou WhatsApp (múltiplos separados por / ou ;)' },
  { key: 'employees', label: 'Funcionários', description: 'Quantidade de funcionários/colaboradores' },
  { key: 'revenueEstimate', label: 'Faturamento', description: 'Faturamento/receita estimada (número ou formato BR)' },
];

// ---------------------------------------------------------------------------
// PARSING CSV — parser próprio (sem dependências): BOM, CRLF, campos entre
// aspas com '' escapado e detecção de delimitador (; , tab |) — planilhas BR
// normalmente usam ";".
// ---------------------------------------------------------------------------

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

/**
 * Escolhe o delimitador mais provável contando ocorrências FORA de aspas na
 * primeira linha não-vazia. Delimitador citado dentro de campo não conta.
 */
function sniffDelimiter(text) {
  const candidates = [';', ',', '\t', '|'];
  let firstLine = '';
  for (const line of stripBom(text).split(/\r?\n/)) {
    if (line.trim()) {
      firstLine = line;
      break;
    }
  }
  let best = ',';
  let bestCount = 0;
  for (const ch of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ch && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = ch;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parser CSV completo. Retorna { headers, records, delimiter } onde records é
 * array de objetos { header: valor }. Linhas com menos/more células que o
 * cabeçalho são truncadas/preenchidas com '' (não derrubam o import).
 */
function parseCsv(text, { maxRows = MAX_IMPORT_ROWS } = {}) {
  const clean = stripBom(text);
  const delimiter = sniffDelimiter(clean);
  let truncated = false;

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Descarta linhas totalmente vazias (";;;;" ou em branco).
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      pushRow();
      if (rows.length > maxRows) {
        // Teto de linhas atingido: para de ler e sinaliza truncamento (o
        // relatório avisa o usuário quantas linhas ficaram de fora).
        truncated = true;
        break;
      }
    } else {
      field += c;
    }
  }
  if (sawAnyChar && (field !== '' || row.length)) pushRow();

  if (!rows.length) return { headers: [], records: [], delimiter, truncated: false };

  const headers = rows[0].map((h, idx) => (h.trim() ? h.trim() : `coluna_${idx + 1}`));
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const record = {};
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      record[headers[cIdx]] = cells[cIdx] !== undefined ? cells[cIdx] : '';
    }
    records.push(record);
  }
  return { headers, records, delimiter, truncated };
}

// ---------------------------------------------------------------------------
// NORMALIZAÇÃO DE VALORES — determinística, sem IA.
// ---------------------------------------------------------------------------

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Dígitos verificadores do CNPJ (algoritmo oficial mod 11). */
function isValidCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (base) => {
    let sum = 0;
    let weight = base.length - 7;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(digits.slice(0, 12));
  const d2 = calc(digits.slice(0, 12) + d1);
  return digits === digits.slice(0, 12) + d1 + d2;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(email)) return null;
  return email;
}

/**
 * Domínio do lead: aceita URL completa ou host ("https://www.alfa.com.br/contato"
 * → "alfa.com.br"). Sem protocolo nem caminho, é a chave universal de
 * enriquecimento B2B.
 */
function normalizeDomain(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  raw = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const host = raw.split('/')[0].split('?')[0].split(':')[0].trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

/**
 * Telefone(s): uma célula pode trazer vários ("1133224455 / 11998887766").
 * Devolve array de dígitos com 10–13 posições (DDD + número), deduplicado.
 */
function normalizePhones(value) {
  if (!value) return [];
  const parts = String(value).split(/[\/;|,]|\s{2,}|\s[eE]\s/);
  const phones = [];
  for (const part of parts) {
    const digits = onlyDigits(part);
    if (digits.length >= 10 && digits.length <= 13 && !phones.includes(digits)) {
      phones.push(digits);
    }
  }
  return phones;
}

const STATE_BY_NAME = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', distritofederal: 'DF', espiritosanto: 'ES', goias: 'GO',
  maranhao: 'MA', matogrosso: 'MT', matogrossodosul: 'MS', minasgerais: 'MG',
  para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  riodejaneiro: 'RJ', riograndedonorte: 'RN', riograndedosul: 'RS', rondonia: 'RO',
  roraima: 'RR', santacatarina: 'SC', saopaulo: 'SP', sergipe: 'SE', tocantins: 'TO',
};

function normalizeState(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const key = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  return STATE_BY_NAME[key] || upper.slice(0, 2).toUpperCase();
}

/**
 * Números de funcionários: "25", "25 funcionários", "10-49" ou "10 a 49"
 * (faixa → topo da faixa), "1.000". Retorna inteiro ou null.
 */
function normalizeCount(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Faixa exige separador explícito (- ou "a") para não confundir com
  // "1.000 funcionários" (que cai no onlyDigits abaixo).
  const range = raw.match(/(\d[\d.,]*)\s*(?:[-–]|\ba\b)\s*(\d[\d.,]*)/i);
  const source = range ? (range[2] || range[1]) : raw;
  const num = Number(onlyDigits(source));
  if (!Number.isFinite(num) || num <= 0 || num > 10_000_000) return null;
  return Math.round(num);
}

/**
 * Faturamento em formato livre: "R$ 1.500.000,00", "1500000", "1,5 mi",
 * "500 mil", "R$ 300k". Retorna inteiro (reais) ou null.
 */
function normalizeMoney(value) {
  if (value === null || value === undefined) return null;
  let raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  let multiplier = 1;
  const suffix = raw.match(/([\d.,]+)\s*(mil|milhoes|milhao|mi|mm|k|m)\b/);
  if (suffix) {
    raw = suffix[1];
    const unit = suffix[2];
    if (unit === 'mil' || unit === 'k') multiplier = 1_000;
    else if (unit === 'm' && !/mil/.test(suffix[0])) multiplier = 1_000_000;
    else multiplier = 1_000_000; // mi, milhao, milhoes, mm
  }

  const num = raw.replace(/[r$]|\s/g, '');
  // Decide separador: BR usa "." milhar e "," decimal.
  let normalized = num;
  const hasDot = num.includes('.');
  const hasComma = num.includes(',');
  if (hasDot && hasComma) {
    normalized = num.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // "1,5" → decimal; "1,500,000" → milhar (US)
    normalized = /,\d{1,2}$/.test(num) ? num.replace(',', '.') : num.replace(/,/g, '');
  } else if (hasDot) {
    // "1.500.000" → milhar (todo grupo pós-ponto tem 3 dígitos); "1500.50" → decimal
    const parts = num.split('.');
    const isThousands = parts.length > 1 && parts.slice(1).every((p) => /^\d{3}$/.test(p));
    normalized = isThousands ? num.replace(/\./g, '') : num;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * multiplier);
}

// ---------------------------------------------------------------------------
// MAPEAMENTO DE COLUNAS — IA com fallback heurístico.
// ---------------------------------------------------------------------------

function normalizeHeaderKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Colunas de PESSOA de contato ("Contato", "Nome do Contato", "Responsável",
// "Cargo"...) não correspondem a NENHUM campo do Prospect — são pessoas, não
// atributos da empresa. Bloqueadas deterministicamente para os campos de
// texto (a IA às vezes as mapeia como setor/razão social; valores de pessoa
// em industry poluem o CRM).
const CONTACT_COLUMN_PATTERNS = [
  'contato', 'nomedocontato', 'responsavel', 'proprietario', 'vendedor',
  'representante', 'socio', 'cargo', 'funcao', 'pessoa',
];
const TEXT_FIELDS = ['companyName', 'tradeName', 'industry'];

function isContactColumn(header) {
  const key = normalizeHeaderKey(header);
  return CONTACT_COLUMN_PATTERNS.some((p) => key === p || key.includes(p));
}

// Padrões por campo, em ordem de prioridade (1ª passada: igualdade; 2ª:
// prefixo/contém). Chaves sem acento/espaço/pontuação (normalizeHeaderKey).
const HEURISTIC_PATTERNS = {
  cnpj: ['cnpj', 'cnpjdaempresa', 'documento', 'inscricaoestadualjuridica', 'nucnpj'],
  companyName: ['razaosocial', 'nomeempresarial', 'nomelegal', 'nomedarazao', 'companyname', 'legalname', 'nome', 'empresa', 'company', 'lead'],
  tradeName: ['nomefantasia', 'fantasia', 'nomedefantasia', 'tradename', 'nomecomercial', 'apelido'],
  industry: ['setor', 'segmento', 'ramo', 'atividade', 'cnae', 'industria', 'industria', 'categoria', 'nichodeatuação', 'nichodeatuacao', 'ocupacao'],
  domain: ['site', 'website', 'dominio', 'url', 'web', 'homepage', 'paginaweb', 'sitedaempresa', 'link'],
  city: ['cidade', 'municipio', 'city'],
  state: ['uf', 'estado', 'state', 'provincia'],
  email: ['email', 'correioeletronico', 'mail', 'emailcontato', 'emailprincipal'],
  phone: ['telefone', 'celular', 'whatsapp', 'fone', 'phone', 'mobile', 'tel', 'contatotelefonico'],
  employees: ['funcionarios', 'colaboradores', 'employees', 'numerodefuncionarios', 'qtdefuncionarios', 'headcount', 'porte', 'tamanho'],
  revenueEstimate: ['faturamento', 'receita', 'revenue', 'faturamentoanual', 'receitaestimada', 'faturamentoestimado', 'billing', 'faturamentoanualestimado'],
};

/**
 * Fallback sem IA: igualdade exata na 1ª passada, prefixo/contém na 2ª.
 * Uma coluna só é usada uma vez (ordem de prioridade dos campos acima).
 */
function heuristicMapping(headers) {
  const normalized = headers.map((h) => ({ header: h, key: normalizeHeaderKey(h) }));
  const used = new Set();
  const mapping = {};

  for (const field of TARGET_FIELDS) {
    const patterns = HEURISTIC_PATTERNS[field.key] || [field.key.toLowerCase()];
    // Campos de texto da empresa nunca vêm de coluna de pessoa de contato.
    const skipContact = TEXT_FIELDS.includes(field.key);
    let match = null;
    // 1) igualdade exata
    for (const pattern of patterns) {
      const hit = normalized.find(
        (c) => !used.has(c.header) && c.key === pattern && !(skipContact && isContactColumn(c.header))
      );
      if (hit) {
        match = hit;
        break;
      }
    }
    // 2) prefixo/contém
    if (!match) {
      for (const pattern of patterns) {
        const hit = normalized.find(
          (c) => !used.has(c.header) && (c.key.startsWith(pattern) || c.key.includes(pattern)) &&
            !(skipContact && isContactColumn(c.header))
        );
        if (hit) {
          match = hit;
          break;
        }
      }
    }
    if (match) {
      mapping[field.key] = match.header;
      used.add(match.header);
    }
  }
  return mapping;
}

/**
 * Garante que o mapeamento (da IA ou heurístico) só aponta para colunas que
 * EXISTEM no cabeçalho, que cada coluna atende a um único campo e que campos
 * de texto da empresa não recebem colunas de pessoa de contato.
 */
function sanitizeMapping(rawMapping, headers) {
  if (!rawMapping || typeof rawMapping !== 'object') return {};
  const headerSet = new Set(headers);
  const used = new Set();
  const mapping = {};
  for (const field of TARGET_FIELDS) {
    const value = rawMapping[field.key];
    if (typeof value !== 'string') continue;
    const column = value.trim();
    if (!headerSet.has(column) || used.has(column)) continue;
    if (TEXT_FIELDS.includes(field.key) && isContactColumn(column)) continue;
    mapping[field.key] = column;
    used.add(column);
  }
  return mapping;
}

/**
 * Verificação sanidade do mapeamento da IA: a coluna apontada como CNPJ
 * precisa realmente conter CNPJs na amostra (evita mapear, ex., "CPF do
 * contato" como CNPJ). Retorna true se a coluna passa (>= metade da amostra
 * com 13–14 dígitos após limpar máscara).
 */
function cnpjColumnLooksValid(rows, cnpjHeader) {
  if (!cnpjHeader) return false;
  const values = rows.map((row) => onlyDigits(row[cnpjHeader])).filter(Boolean);
  if (!values.length) return false;
  const valid = values.filter((v) => v.length >= 13 && v.length <= 14).length;
  return valid / values.length >= 0.5;
}

const MAPPING_SYSTEM_PROMPT = `Você analisa a estrutura de planilhas CSV de leads B2B brasileiras e mapeia cada coluna para o modelo de dados de uma plataforma de prospecção.

Regras:
- Mapeie APENAS colunas que existem no cabeçalho, usando o nome EXATO da coluna.
- Julgue pelo CONTEÚDO dos exemplos, não só pelo nome da coluna.
- Cada campo-alvo recebe no máximo UMA coluna; uma coluna não serve a dois campos.
- Colunas de PESSOA de contato ("Contato", "Nome do Contato", "Responsável", "Sócio", "Vendedor", "Cargo", "Função") NÃO mapeiam para NENHUM campo — são pessoas físicas, não atributos da empresa. Em particular NUNCA as use como "industry"/setor ou "companyName"/razão social.
- "cnpj" é opcional: muitas planilhas de contatos não o têm, e tudo bem. Quando existir, procure CNPJ (14 dígitos, com ou sem máscara). NUNCA mapeie CPF, RG ou outro documento como CNPJ.
- Colunas que não correspondem a nenhum campo-alvo ficam de fora.
- Datas de abertura, endereço completo, observações: NÃO têm campo correspondente — ignore.
- Responda SOMENTE com JSON válido no formato:
{"mapping": {"cnpj": "<coluna ou null>", "companyName": "<coluna ou null>", "tradeName": "<coluna ou null>", "industry": "<coluna ou null>", "domain": "<coluna ou null>", "city": "<coluna ou null>", "state": "<coluna ou null>", "email": "<coluna ou null>", "phone": "<coluna ou null>", "employees": "<coluna ou null>", "revenueEstimate": "<coluna ou null>"}, "notes": "<1 frase em pt-BR sobre o que entendeu da planilha>"}`;

/**
 * Chamada de auditoria do mapeamento: reenvia cada campo mapeado com os
 * VALORES de exemplo da coluna e pede um julgamento por campo. É a rede de
 * segurança contra o modelo pequeno do gateway mapear pelo nome da coluna e
 * deixar valores impertinentes entrarem (ex.: nomes de pessoas em "setor").
 */
const VERIFY_SYSTEM_PROMPT = `Você audita o mapeamento de colunas de uma planilha CSV de leads B2B para um modelo de dados.

Para cada item, julgue se os VALORES de exemplo da coluna são plausíveis para o campo:
- companyName: nomes de empresas (ex.: "Dedini S.A."). tradeName: nomes comerciais/fantasia.
- industry: ramos de atividade/segmentos (ex.: "Metalurgia", "Varejo"). NÃO são setores: nomes de pessoas, cargos, cidades.
- city: cidades. state: UFs/estados. email: e-mails. phone: telefones. employees: quantidades. revenueEstimate: valores financeiros. domain: domínios/sites.

Julgue PRINCIPALMENTE pelos valores; o nome da coluna é secundário. Seja conservador: responda false apenas quando os valores claramente NÃO correspondem ao campo (valores vazios/ilegíveis contam como correspondência razoável — true).
Responda SOMENTE JSON: {"verificacao": {"<campo>": true, "<campo>": false, ...}}`;

/**
 * Segunda chamada de LLM que valida o mapeamento campo a campo.
 * Retorna { verified: {field: bool}, failed } — failed indica gateway fora
 * (caller mantém o mapeamento sem auditoria nesse caso).
 */
async function verifyMappingWithLlm(headers, rows, mapping, { callLlm: callLlmFn = callLlm } = {}) {
  const fields = Object.entries(mapping).filter(([key]) => key !== 'cnpj'); // cnpj tem validação própria
  if (!fields.length) return { verified: {}, failed: false };

  const userPrompt = JSON.stringify(
    fields.map(([field, column]) => ({
      campo: field,
      coluna: column,
      valores: rows
        .slice(0, MAPPING_SAMPLE_ROWS)
        .map((r) => String(r[column] ?? '').trim())
        .filter(Boolean)
        .slice(0, 5),
    })),
    null,
    1
  );

  try {
    const { content } = await callLlmFn({
      system: VERIFY_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0,
      maxTokens: 300,
      jsonMode: true,
      tag: 'csv-import-verify',
    });
    const parsed = parseJsonLoose(content);
    if (!parsed || typeof parsed.verificacao !== 'object') return { verified: {}, failed: true };
    return { verified: parsed.verificacao, failed: false };
  } catch (_err) {
    return { verified: {}, failed: true };
  }
}

/**
 * Mapeamento via LLM (gateway LiteLLM, llm-client.js). Lança em falha —
 * o caller cai no heurístico.
 */
async function inferMappingWithLlm(headers, sampleRows, { callLlm: callLlmFn = callLlm } = {}) {
  // Apresenta cada coluna com uma amostra dos valores: modelos pequenos
  // mapeiam muito melhor vendo o CONTEÚDO junto com o nome da coluna.
  const userPrompt = JSON.stringify(
    {
      colunas: headers.map((h) => ({
        nome: h,
        exemplos: sampleRows
          .slice(0, MAPPING_SAMPLE_ROWS)
          .map((r) => String(r[h] ?? '').trim())
          .filter(Boolean)
          .slice(0, 3),
      })),
      campos_alvo: TARGET_FIELDS.map((f) => ({ campo: f.key, descricao: f.label, detalhe: f.description })),
    },
    null,
    1
  );

  const { content } = await callLlmFn({
    system: MAPPING_SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0,
    maxTokens: 600,
    jsonMode: true,
    tag: 'csv-import',
  });

  const parsed = parseJsonLoose(content);
  if (!parsed || typeof parsed.mapping !== 'object') {
    throw new Error('resposta da IA sem mapping válido');
  }
  return {
    mapping: sanitizeMapping(parsed.mapping, headers),
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

/**
 * Mapeamento final, em camadas:
 *   1. IA propõe o mapeamento (nome da coluna + exemplos de valores);
 *   2. sanitização determinística (colunas existentes, sem duplicar, colunas
 *      de pessoa de contato fora dos campos de texto da empresa);
 *   3. heurístico preenche lacunas;
 *   4. auditoria por VALORES com uma segunda chamada de LLM sobre o
 *      MAPEAMENTO FINAL (derruba campo cuja coluna claramente não contém
 *      aquele tipo de dado — inclusive campos preenchidos pelo heurístico,
 *      que só olham o nome da coluna).
 * Nunca lança. Retorna { mapping, source, notes?, rejected }.
 * callLlmFn injetável para testes (default: gateway LiteLLM via llm-client).
 */
async function resolveMapping(headers, sampleRows, { callLlm: callLlmFn = callLlm } = {}) {
  let mapping = {};
  let source = 'heuristic';
  let notes;
  let llmOk = false;
  const rejected = [];

  try {
    const ai = await inferMappingWithLlm(headers, sampleRows, { callLlm: callLlmFn });
    if (ai.mapping && Object.keys(ai.mapping).length) {
      mapping = ai.mapping;
      source = 'ai';
      notes = ai.notes;
      llmOk = true;
    }
  } catch (error) {
    console.warn(`[csv-import] mapeamento por IA falhou (${error.message}); usando heurístico`);
  }

  // CNPJ do caminho da IA é validado por valor aqui; o heurístico entra no
  // merge abaixo e passa pela mesma checagem depois do merge.
  if (mapping.cnpj && !cnpjColumnLooksValid(sampleRows, mapping.cnpj)) {
    rejected.push({ field: 'cnpj', column: mapping.cnpj, reason: 'coluna não contém CNPJs' });
    delete mapping.cnpj;
  }

  const heuristic = heuristicMapping(headers);
  for (const field of TARGET_FIELDS) {
    if (!mapping[field.key] && heuristic[field.key]) {
      mapping[field.key] = heuristic[field.key];
      if (source === 'ai') source = 'ai+heuristic';
    }
  }
  if (!mapping.cnpj && heuristic.cnpj) {
    mapping.cnpj = heuristic.cnpj;
  }
  if (mapping.cnpj && !cnpjColumnLooksValid(sampleRows, mapping.cnpj)) {
    rejected.push({ field: 'cnpj', column: mapping.cnpj, reason: 'coluna não contém CNPJs' });
    delete mapping.cnpj;
  }

  // Auditoria por valores sobre o mapeamento FINAL. Se o gateway estiver
  // fora (llmOk=false), mantém o mapeamento sem auditoria — o sanitizador
  // determinístico já bloqueou as classes de erro mais perigosas.
  if (llmOk && Object.keys(mapping).length) {
    const { verified, failed } = await verifyMappingWithLlm(headers, sampleRows, mapping, { callLlm: callLlmFn });
    if (!failed) {
      for (const [field, ok] of Object.entries(verified)) {
        if (ok === false && mapping[field]) {
          rejected.push({ field, column: mapping[field], reason: 'valores não correspondem ao campo (auditoria IA)' });
          delete mapping[field];
        }
      }
    }
  }

  if (rejected.length) {
    console.warn(`[csv-import] campos rejeitados no mapeamento: ${JSON.stringify(rejected)}`);
  }

  return { mapping, source, notes, rejected };
}

// ---------------------------------------------------------------------------
// APLICAÇÃO DO MAPEAMENTO — monta o registro normalizado de uma linha.
// ---------------------------------------------------------------------------

/**
 * Converte uma linha do CSV em um registro no formato do Prospect.
 * O CNPJ é OPCIONAL (lead pendente de chave de enriquecimento); quando
 * presente, precisa ser válido — não gravamos identificador fiscal errado.
 * Retorna { record, issues } — record é null quando a linha não pode ser
 * importada (issues[0] traz o motivo); issues também acumula avisos não
 * fatais (ex.: faturamento ilegível).
 */
function buildRecord(row, mapping) {
  const issues = [];
  const pick = (field) => {
    const header = mapping[field];
    if (!header) return '';
    return String(row[header] ?? '').trim();
  };

  const cnpjRaw = pick('cnpj');
  const cnpj = cnpjRaw ? onlyDigits(cnpjRaw) : null;
  if (cnpjRaw && (cnpj.length !== 14 || !isValidCnpj(cnpj))) {
    issues.push(`CNPJ inválido (dígitos verificadores não conferem): "${cnpjRaw}"`);
    return { record: null, issues };
  }

  const companyName = pick('companyName') || pick('tradeName');
  if (!companyName && !cnpj) {
    // Sem CNPJ nem nome não há identidade para cadastrar.
    issues.push('Linha sem nome da empresa e sem CNPJ');
    return { record: null, issues };
  }

  const email = normalizeEmail(pick('email'));
  if (pick('email') && !email) issues.push(`E-mail inválido ignorado: "${pick('email')}"`);

  const phones = normalizePhones(pick('phone'));

  const employeesRaw = pick('employees');
  const employees = normalizeCount(employeesRaw);
  if (employeesRaw && employees === null) issues.push(`Funcionários ilegível ignorado: "${employeesRaw}"`);

  const revenueRaw = pick('revenueEstimate');
  const revenueEstimate = normalizeMoney(revenueRaw);
  if (revenueRaw && revenueEstimate === null) issues.push(`Faturamento ilegível ignorado: "${revenueRaw}"`);

  return {
    record: {
      cnpj,
      // CNPJ presente → lead entra direto na esteira de enriquecimento (BR).
      taxIdType: cnpj ? 'br_cnpj' : null,
      companyName: (companyName || cnpj).slice(0, 200),
      tradeName: pick('tradeName') ? pick('tradeName').slice(0, 200) : null,
      industry: pick('industry') ? pick('industry').slice(0, 200) : null,
      domain: normalizeDomain(pick('domain')),
      city: pick('city') ? pick('city').slice(0, 120) : null,
      state: normalizeState(pick('state')),
      cnpjEmail: email,
      cnpjPhones: phones.length ? phones : null,
      employees,
      revenueEstimate,
    },
    issues,
  };
}

/**
 * Chave de dedup idempotente para leads SEM CNPJ (os com CNPJ deduplicam pela
 * unicidade org+cnpj). Determinística entre uploads do mesmo arquivo:
 * e-mail quando existe; senão nome normalizado + cidade.
 */
function computeImportKey(record) {
  if (!record || record.cnpj) return null;
  if (record.cnpjEmail) return `email:${String(record.cnpjEmail).trim().toLowerCase()}`;
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(ltda|limitada|me|eireli|epp|s\/a|sa|s\.a\.|mei)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const name = norm(record.companyName);
  if (!name) return null;
  return `nome:${name}|${norm(record.city)}`;
}

module.exports = {
  TARGET_FIELDS,
  MAX_CSV_CHARS,
  MAX_IMPORT_ROWS,
  MAPPING_SAMPLE_ROWS,
  parseCsv,
  sniffDelimiter,
  stripBom,
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
  MAPPING_SYSTEM_PROMPT,
  VERIFY_SYSTEM_PROMPT,
};
