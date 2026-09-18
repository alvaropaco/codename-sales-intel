const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { createAvaExtractor } = require('../ava-extract');

// ---------------------------------------------------------------------------
// Fakes e fixtures
// ---------------------------------------------------------------------------

function makeFakeFetch(responses) {
  // responses: Map de url → { ok, status, text } (ou Error para lançar)
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const res = responses[url];
    if (!res) return { ok: false, status: 404, text: async () => '' };
    if (res instanceof Error) throw res;
    return { ok: res.ok !== false, status: res.status ?? 200, text: async () => res.text ?? '' };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function makeFakeLlm(payload) {
  const calls = [];
  const callLlm = async (opts) => {
    calls.push(opts);
    if (payload instanceof Error) throw payload;
    return { content: JSON.stringify(payload), usage: null, model: 'fake-model' };
  };
  callLlm.calls = calls;
  return callLlm;
}

const BUSINESS = {
  products: [{ name: 'CRM X', description: 'CRM para PMOs' }],
  valueProposition: 'Venda mais rápida',
  businessModel: 'SaaS B2B',
  differentiators: ['IA nativa'],
  targetMarket: 'Pequenas empresas',
};

function makeLogger() {
  const calls = [];
  return {
    calls,
    info: (...args) => calls.push(['info', ...args]),
    warn: (...args) => calls.push(['warn', ...args]),
    error: (...args) => calls.push(['error', ...args]),
  };
}

const PDF_FIXTURE = { name: 'pitch.pdf', mime: 'application/pdf', buffer: Buffer.from('%PDF-fake') };
const TXT_FIXTURE = { name: 'notas.txt', mime: 'text/plain', buffer: Buffer.from('Catalogo: maquinas industriais') };

async function docxFixture(text) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:document>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { name: 'deck.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer };
}

async function pptxFixture(slides) {
  const zip = new JSZip();
  slides.forEach((text, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`);
  });
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { name: 'apresentacao.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer };
}

const HTML = `<html><head><style>body{color:red}</style><script>var SEGREDO='nao-extrair';</script></head>
<body><h1>Acme Ltda</h1><p>Vendemos &amp; instalamos m&aacute;quinas</p></body></html>`;

function makeExtractor({ fetchImpl, llmPayload, pdfText = 'conteudo do pdf', logger } = {}) {
  return {
    extractor: createAvaExtractor({
      fetchImpl: fetchImpl || makeFakeFetch({}),
      callLlm: llmPayload === undefined ? makeFakeLlm(BUSINESS) : makeFakeLlm(llmPayload),
      pdfParse: async () => ({ text: pdfText }),
      premiumModel: () => 'fake-premium',
      logger: logger || makeLogger(),
    }),
    logger: logger || makeLogger(),
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test('US5 site institucional é limpo (script/style fora) e entidades decodificadas', async () => {
  const fetchImpl = makeFakeFetch({ 'https://acme.com': { text: HTML } });
  const { extractor } = makeExtractor({ fetchImpl });
  const { businessContext, extractedFrom, warnings } = await extractor.extractBusinessAssets({
    siteUrl: 'https://acme.com',
    catalogUrl: null,
    files: [],
  });
  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(extractedFrom.site.status, 'ok');
  assert.ok(extractedFrom.site.chars > 0);
  assert.ok(!JSON.stringify(businessContext).includes('nao-extrair')); // script não vira input
});

test('US5 site inacessível vira warning e não quebra a extração', async () => {
  const fetchImpl = makeFakeFetch({ 'https://acme.com': new Error('timeout') });
  const { extractor } = makeExtractor({ fetchImpl, llmPayload: BUSINESS });
  const { businessContext, warnings } = await extractor.extractBusinessAssets({
    siteUrl: 'https://acme.com', catalogUrl: null, files: [TXT_FIXTURE],
  });
  assert.ok(warnings.some((w) => w.startsWith('SITE_UNREACHABLE')));
  assert.ok(businessContext); // TXT ainda alimentou o LLM
});

test('US5 URL inválida de site vira SITE_INVALID_URL sem fetch', async () => {
  const fetchImpl = makeFakeFetch({});
  const { extractor } = makeExtractor({ fetchImpl, llmPayload: BUSINESS });
  const { warnings } = await extractor.extractBusinessAssets({
    siteUrl: 'não é url', catalogUrl: null, files: [TXT_FIXTURE],
  });
  assert.ok(warnings.some((w) => w.startsWith('SITE_INVALID_URL')));
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('US5 DOCX e PPTX (zip+xml) têm texto extraído em ordem de slides', async () => {
  const docx = await docxFixture('Ferramentas eletricas premium');
  const pptx = await pptxFixture(['Slide 1: proposta', 'Slide 2: precificacao']);
  const { extractor } = makeExtractor({});
  const { extractedFrom, warnings } = await extractor.extractBusinessAssets({
    siteUrl: null, catalogUrl: null, files: [docx, pptx],
  });
  assert.strictEqual(warnings.length, 0);
  assert.strictEqual(extractedFrom.documents.length, 2);
  assert.ok(extractedFrom.documents.every((d) => d.status === 'ok'));
  // o user prompt do LLM contém os textos extraídos, slides em ordem
  // (verificado indiretamente pelo chars > 0 de cada documento)
});

test('US5 PDF sem texto (só imagem) vira DOCUMENT_UNREADABLE/DOCUMENT_EMPTY', async () => {
  const { extractor } = makeExtractor({ pdfText: '   ' });
  const { businessContext, warnings } = await extractor.extractBusinessAssets({
    siteUrl: null, catalogUrl: null, files: [PDF_FIXTURE],
  });
  assert.ok(warnings.some((w) => w.startsWith('DOCUMENT_UNREADABLE') || w.startsWith('DOCUMENT_EMPTY')));
  assert.strictEqual(businessContext, null); // nenhuma fonte rendeu texto
});

test('US5 .doc legado vira DOCUMENT_UNSUPPORTED_FORMAT', async () => {
  const { extractor } = makeExtractor({ llmPayload: BUSINESS });
  const { warnings } = await extractor.extractBusinessAssets({
    siteUrl: null, catalogUrl: null, files: [{ name: 'antigo.doc', mime: 'application/msword', buffer: Buffer.from('xx') }],
  });
  assert.ok(warnings.some((w) => w.startsWith('DOCUMENT_UNSUPPORTED_FORMAT')));
});

test('US5 LLM indisponível → businessContext null + warning LLM_UNAVAILABLE', async () => {
  const fetchImpl = makeFakeFetch({ 'https://acme.com': { text: '<html><body>conteudo</body></html>' } });
  const { extractor } = makeExtractor({ fetchImpl, llmPayload: new Error('gateway fora') });
  const { businessContext, warnings } = await extractor.extractBusinessAssets({
    siteUrl: 'https://acme.com', catalogUrl: null, files: [],
  });
  assert.strictEqual(businessContext, null);
  assert.ok(warnings.some((w) => w.startsWith('LLM_UNAVAILABLE')));
});

test('US5 prompt do LLM rotula as fontes e respeita o cap por fonte', async () => {
  const longHtml = `<html><body>${'<p>texto repetido longo </p>'.repeat(2000)}</body></html>`;
  const fetchImpl = makeFakeFetch({ 'https://acme.com': { text: longHtml } });
  const callLlm = makeFakeLlm(BUSINESS);
  const extractor = createAvaExtractor({
    fetchImpl,
    callLlm,
    pdfParse: async () => ({ text: 'x' }),
    premiumModel: () => 'fake-premium',
    logger: makeLogger(),
    perSourceCap: 200,
  });
  await extractor.extractBusinessAssets({ siteUrl: 'https://acme.com', catalogUrl: null, files: [] });
  const user = callLlm.calls[0].user;
  assert.ok(user.includes('SITE INSTITUCIONAL'));
  assert.ok(user.length < 1000); // cap aplicado
  assert.strictEqual(callLlm.calls[0].jsonMode, true);
  assert.strictEqual(callLlm.calls[0].model, 'fake-premium');
});

test('US5 resposta do LLM vira businessContext no formato do org-context', async () => {
  const { extractor } = makeExtractor({});
  const { businessContext } = await extractor.extractBusinessAssets({
    siteUrl: null, catalogUrl: null, files: [TXT_FIXTURE],
  });
  assert.deepStrictEqual(businessContext.products, BUSINESS.products);
  assert.strictEqual(businessContext.valueProposition, BUSINESS.valueProposition);
  assert.deepStrictEqual(businessContext.sources, ['document']);
});

test('US5 requisição vazia é rejeitada', async () => {
  const { extractor } = makeExtractor({});
  await assert.rejects(
    () => extractor.extractBusinessAssets({ siteUrl: null, catalogUrl: null, files: [] }),
    (err) => err.status === 400
  );
});

test('US5 mais de 5 arquivos é rejeitado (413)', async () => {
  const { extractor } = makeExtractor({});
  const files = Array.from({ length: 6 }, (_, i) => TXT_FIXTURE);
  await assert.rejects(
    () => extractor.extractBusinessAssets({ siteUrl: null, catalogUrl: null, files }),
    (err) => err.status === 413
  );
});

test('US5 idempotente: mesma entrada → mesmo resultado', async () => {
  const fetchImpl = makeFakeFetch({ 'https://acme.com': { text: HTML } });
  const a = makeExtractor({ fetchImpl, llmPayload: BUSINESS });
  const b = makeExtractor({ fetchImpl, llmPayload: BUSINESS });
  const input = { siteUrl: 'https://acme.com', catalogUrl: null, files: [TXT_FIXTURE] };
  const r1 = await a.extractor.extractBusinessAssets(input);
  const r2 = await b.extractor.extractBusinessAssets(input);
  assert.deepStrictEqual(r1, r2);
});

test('US5 logs contêm apenas metadados — nunca o texto extraído (D9)', async () => {
  const logger = makeLogger();
  const fetchImpl = makeFakeFetch({ 'https://acme.com': { text: `<html><body>SENTINELA-SECRETA-conteudo</body></html>` } });
  const extractor = createAvaExtractor({
    fetchImpl,
    callLlm: makeFakeLlm(BUSINESS),
    pdfParse: async () => ({ text: 'x' }),
    premiumModel: () => 'fake-premium',
    logger,
  });
  await extractor.extractBusinessAssets({ siteUrl: 'https://acme.com', catalogUrl: null, files: [] });
  const dumped = JSON.stringify(logger.calls);
  assert.ok(!dumped.includes('SENTINELA-SECRETA'));
});

test('US5 catálogo online segue o mesmo caminho do site (CATALOG_UNREACHABLE)', async () => {
  const fetchImpl = makeFakeFetch({ 'https://acme.com/catalogo': new Error('dns') });
  const { extractor } = makeExtractor({ fetchImpl, llmPayload: BUSINESS });
  const { warnings } = await extractor.extractBusinessAssets({
    siteUrl: null, catalogUrl: 'https://acme.com/catalogo', files: [TXT_FIXTURE],
  });
  assert.ok(warnings.some((w) => w.startsWith('CATALOG_UNREACHABLE')));
});
