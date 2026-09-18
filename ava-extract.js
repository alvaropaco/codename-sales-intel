/**
 * ava-extract.js — extração de dados de negócio para o onboarding conversacional
 * da Ava (feature 004, User Story 5).
 *
 * Endpoint stateless (POST /api/onboarding/ava/extract): recebe ativos informados
 * na conversa — site institucional, materiais (PDF/DOCX/PPTX/TXT) e catálogo
 * online — extrai o texto de cada fonte e usa o LLM (gateway LiteLLM via
 * llm-client.js) para estruturar o contexto de negócio no shape que
 * org-context.js já consome (drop-in para outreach e-mail/WhatsApp).
 *
 * Garantias (constituição + contrato specs/004-ai-onboarding/contracts/http-api.md):
 *   - stateless e idempotente: nada é persistido; mesma entrada → mesma saída;
 *   - materiais vivem só em memória e NUNCA vão para logs (só metadados);
 *   - falhas parciais viram warnings com código estável — a extração nunca
 *     "lança" por causa de uma fonte ruim; só erros de requisição inválida.
 *
 * DI ({ fetchImpl, callLlm, pdfParse, premiumModel, logger }) segue o padrão
 * dos módulos testados em test/ (ver test/ava-extract.test.js).
 */

const JSZip = require('jszip');
const { parseJsonLoose } = require('./llm-client');

const MAX_FILES = 5;
const FETCH_TIMEOUT_MS = 10000;
const LLM_TIMEOUT_MS = 60000;
const PER_SOURCE_CAP = 12000;
const TOTAL_CAP = 30000;

const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function cap(text, limit) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? clean.slice(0, limit) : clean;
}

function decodeBasicEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** HTML → texto plano: remove script/style/noscript, tags viram espaço. */
function htmlToText(html) {
  return decodeBasicEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

async function fetchText(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'B2Base-Ava-Onboarding/1.0 (+https://b2base.com)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return String((await res.text()) || '');
  } finally {
    clearTimeout(timer);
  }
}

/** DOCX: word/document.xml → nós <w:t>. PPTX: ppt/slides/slideN.xml → <a:t>. */
async function zipXmlText(buffer, { xmlPath, tagRegex, listPath }) {
  const zip = await JSZip.loadAsync(buffer);
  let xml;
  if (xmlPath) {
    const entry = zip.file(xmlPath);
    if (!entry) throw new Error('xml ausente');
    xml = await entry.async('string');
  } else {
    const slides = Object.keys(zip.files)
      .filter((name) => listPath.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)/)?.[1] || 0);
        const nb = Number(b.match(/(\d+)/)?.[1] || 0);
        return na - nb;
      });
    if (!slides.length) throw new Error('slides ausentes');
    const parts = [];
    for (const name of slides) parts.push(await zip.file(name).async('string'));
    xml = parts.join(' ');
  }
  const matches = xml.match(tagRegex) || [];
  return matches.map((m) => m.replace(tagRegex, '$1')).join(' ');
}

async function documentToText(file, pdfParse) {
  if (file.mime === 'application/pdf') {
    const out = await pdfParse(file.buffer);
    return String(out && out.text ? out.text : '');
  }
  if (file.mime === 'text/plain') {
    return file.buffer.toString('utf8');
  }
  if (
    file.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return zipXmlText(file.buffer, {
      xmlPath: 'word/document.xml',
      tagRegex: /<w:t[^>]*>([^<]*)<\/w:t>/g,
    });
  }
  if (
    file.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return zipXmlText(file.buffer, {
      listPath: /^ppt\/slides\/slide\d+\.xml$/,
      tagRegex: /<a:t>([^<]*)<\/a:t>/g,
    });
  }
  const err = new Error('formato não suportado');
  err.code = 'DOCUMENT_UNSUPPORTED_FORMAT';
  throw err;
}

function buildSystemPrompt() {
  return [
    'Você extrai dados de negócio a partir de fontes de uma empresa (site institucional,',
    'documentos de apresentação e catálogo online). Responda APENAS um JSON válido,',
    'no formato:',
    '{',
    '  "products": [{ "name": "string", "description": "string" }],',
    '  "valueProposition": "string",',
    '  "businessModel": "string",',
    '  "differentiators": ["string"],',
    '  "targetMarket": "string"',
    '}',
    'Use "" para campos que não der para inferir e [] para listas vazias.',
    'Não invente produtos ou dados que não estejam nas fontes.',
  ].join('\n');
}

function buildUserPrompt(sources) {
  // Fontes rotuladas, cada uma capada; total combinado também tem cap.
  let total = 0;
  const blocks = [];
  for (const source of sources) {
    let text = cap(source.text, PER_SOURCE_CAP);
    if (total + text.length > TOTAL_CAP) {
      text = cap(text, Math.max(0, TOTAL_CAP - total));
    }
    total += text.length;
    blocks.push(`FONTE: ${source.label}\n${text}`);
    if (total >= TOTAL_CAP) break;
  }
  return [
    'Extraia os dados de negócio da empresa a partir das fontes abaixo.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

function createAvaExtractor(deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const callLlm = deps.callLlm || require('./llm-client').callLlm;
  const pdfParse = deps.pdfParse || require('pdf-parse');
  const parseJson = deps.parseJson || parseJsonLoose;
  const premiumModel = deps.premiumModel || null;
  const logger = deps.logger || console;
  const fetchTimeoutMs = deps.fetchTimeoutMs || FETCH_TIMEOUT_MS;
  const perSourceCap = deps.perSourceCap || PER_SOURCE_CAP;

  function warn(warnings, code, message) {
    warnings.push(`${code}: ${message}`);
  }

  async function fetchLabeledSource(kind, label, warningCode, url, warnings) {
    try {
      const html = await fetchText(url, fetchImpl, fetchTimeoutMs);
      const text = cap(htmlToText(html), perSourceCap);
      if (!text) {
        warn(warnings, warningCode, `${url} respondeu sem conteúdo utilizável`);
        return { status: 'failed', chars: 0 };
      }
      return { status: 'ok', chars: text.length, text, label };
    } catch (err) {
      warn(warnings, warningCode, `não foi possível acessar ${url} (${err.message})`);
      return { status: 'failed', chars: 0 };
    }
  }

  async function extractBusinessAssets({ siteUrl, catalogUrl, files }) {
    const warnings = [];
    const inputFiles = Array.isArray(files) ? files : [];

    if (!siteUrl && !catalogUrl && inputFiles.length === 0) {
      const err = new Error('nenhuma fonte informada');
      err.status = 400;
      throw err;
    }
    if (inputFiles.length > MAX_FILES) {
      const err = new Error(`máximo de ${MAX_FILES} arquivos`);
      err.status = 413;
      throw err;
    }

    const extractedFrom = { site: null, catalog: null, documents: [] };
    const promptSources = [];
    const successSources = [];

    // 1) Site institucional
    if (siteUrl) {
      if (!isValidHttpUrl(siteUrl)) {
        warn(warnings, 'SITE_INVALID_URL', `o endereço ${siteUrl} não parece uma URL válida`);
        extractedFrom.site = { status: 'failed', chars: 0 };
      } else {
        const site = await fetchLabeledSource(
          'site', 'SITE INSTITUCIONAL', 'SITE_UNREACHABLE', String(siteUrl).trim(), warnings
        );
        extractedFrom.site = { status: site.status, chars: site.chars };
        if (site.status === 'ok') {
          promptSources.push(site);
          successSources.push('site');
        }
      }
    }

    // 2) Catálogo online
    if (catalogUrl) {
      if (!isValidHttpUrl(catalogUrl)) {
        warn(warnings, 'SITE_INVALID_URL', `o catálogo ${catalogUrl} não parece uma URL válida`);
        extractedFrom.catalog = { status: 'failed', chars: 0 };
      } else {
        const catalog = await fetchLabeledSource(
          'catalog', 'CATÁLOGO ONLINE', 'CATALOG_UNREACHABLE', String(catalogUrl).trim(), warnings
        );
        extractedFrom.catalog = { status: catalog.status, chars: catalog.chars };
        if (catalog.status === 'ok') {
          promptSources.push(catalog);
          successSources.push('catalog');
        }
      }
    }

    // 3) Documentos anexados (em memória, descartados ao fim da request)
    for (const file of inputFiles) {
      const meta = { name: file.name, status: 'ok', chars: 0 };
      if (!SUPPORTED_DOC_MIMES.has(file.mime)) {
        meta.status = 'unsupported';
        extractedFrom.documents.push(meta);
        warn(warnings, 'DOCUMENT_UNSUPPORTED_FORMAT', `${file.name} (${file.mime}) não é um formato que eu leio ainda`);
        continue;
      }
      try {
        const text = cap(await documentToText(file, pdfParse), perSourceCap);
        meta.chars = text.length;
        if (!text) {
          meta.status = 'failed';
          extractedFrom.documents.push(meta);
          warn(warnings, 'DOCUMENT_EMPTY', `${file.name} não tem texto extraível (apenas imagens?)`);
          continue;
        }
        extractedFrom.documents.push(meta);
        promptSources.push({ text, label: `DOCUMENTO: ${file.name}` });
        successSources.push('document');
      } catch (err) {
        meta.status = 'failed';
        extractedFrom.documents.push(meta);
        warn(
          warnings,
          err && err.code === 'DOCUMENT_UNSUPPORTED_FORMAT' ? 'DOCUMENT_UNSUPPORTED_FORMAT' : 'DOCUMENT_UNREADABLE',
          `não consegui ler ${file.name} (${err.message})`
        );
      }
    }

    // 4) LLM: uma chamada única com as fontes combinadas (D4)
    let businessContext = null;
    if (promptSources.length > 0) {
      try {
        const { content } = await callLlm({
          system: buildSystemPrompt(),
          user: buildUserPrompt(promptSources),
          jsonMode: true,
          model: premiumModel ? premiumModel() : undefined,
          timeoutMs: LLM_TIMEOUT_MS,
          maxTokens: 1200,
          temperature: 0.2,
          tag: 'ava-extract',
        });
        const parsed = parseJson(content);
        if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido do LLM');
        businessContext = {
          products: Array.isArray(parsed.products)
            ? parsed.products
                .filter((p) => p && typeof p.name === 'string')
                .map((p) => ({ name: String(p.name), description: String(p.description || '') }))
            : [],
          valueProposition: String(parsed.valueProposition || ''),
          businessModel: String(parsed.businessModel || ''),
          differentiators: Array.isArray(parsed.differentiators)
            ? parsed.differentiators.map(String).filter(Boolean)
            : [],
          targetMarket: String(parsed.targetMarket || ''),
          sources: [...new Set(successSources)],
          warnings,
        };
      } catch (err) {
        warn(warnings, 'LLM_UNAVAILABLE', `não consegui processar agora (${err.message})`);
        businessContext = null;
      }
    }

    // Log SOMENTE com metadados — nunca o conteúdo das fontes (D9/constituição V).
    logger.info('[ava-extract] extração concluída', {
      site: extractedFrom.site ? extractedFrom.site.status : null,
      catalog: extractedFrom.catalog ? extractedFrom.catalog.status : null,
      documents: extractedFrom.documents.map((d) => ({ name: d.name, status: d.status, chars: d.chars })),
      warnings: warnings.map((w) => w.split(':')[0]),
      extracted: Boolean(businessContext),
    });

    return { businessContext, extractedFrom, warnings };
  }

  return { extractBusinessAssets };
}

module.exports = { createAvaExtractor, htmlToText, MAX_FILES };
