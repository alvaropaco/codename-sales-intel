/**
 * lead-enrichment.js — enriquecimento de leads SEM CNPJ.
 *
 * Fase 1: RESOLVER o CNPJ (a chave da esteira clássica):
 *   a. SearXNG: busca web por "<nome> CNPJ", extrai candidatos dos snippets,
 *      valida dígitos verificadores e confirma cada candidato na base RFB;
 *   b. Base RFB local (MCP-CNPJ): busca por nome — lenta, fica por último.
 *
 * Fase 2 (plano):
 *   - PREMIUM: resolveu → esteira profunda (worker NATS com OSINT; fallback
 *     BrasilAPI). Não resolveu → deep enrich: PDL (empresa: site, redes,
 *     porte, funcionários, fundação; pessoa: nome, cargo, redes), scan
 *     jurídico e de notícias via SearXNG (links para revisão humana) e logo
 *     (Clearbit) a partir do domínio.
 *   - TRIAL: enriquecimento BÁSICO apenas — resolução de CNPJ + firmografia
 *     oficial (BrasilAPI). Sem worker OSINT, sem PDL, sem scans.
 *
 * Jobs rodam em fila in-process (concurreência baixa para não martelar
 * SearXNG/PDL) e são deduplicados por prospect.
 */

const csvImport = require('./csv-import');
const natsEnrichment = require('./nats-enrichment');
// Feature 005: roteamento do card pós-enriquecimento (premium → Análise profunda).
const pipelineTransitions = require('./pipeline-transitions');
const mcpCnpj = require('./mcp-cnpj');
const plan = require('./plan');

// Cliente SearXNG extraído para searxng.js (compartilhado com o motor v2).
const { searxSearch } = require('./searxng');
const PDL_API_KEY = process.env.PDL_API_KEY || '';
const PDL_BASE = 'https://api.peopledatalabs.com';
const PDL_MIN_INTERVAL_MS = parseInt(process.env.PDL_MIN_INTERVAL_MS || '6500', 10); // free tier: 10/min
const CONCURRENCY = parseInt(process.env.LEAD_ENRICHMENT_CONCURRENCY || '2', 10);
const RESOLVE_NAME_THRESHOLD_RFB = 0.62;
const RESOLVE_NAME_THRESHOLD_SEARX = 0.45;
// Busca na RFB não pode dominar o tempo total do resolve — SearXNG é o plano B.
const RFB_SEARCH_TIMEOUT_MS = parseInt(process.env.RFB_SEARCH_TIMEOUT_MS || '45000', 10);
const RFB_LOOKUP_TIMEOUT_MS = parseInt(process.env.RFB_LOOKUP_TIMEOUT_MS || '20000', 10);

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function enabled() {
  return String(process.env.LEAD_ENRICHMENT_ENABLED || 'true') === 'true';
}

// ---------------------------------------------------------------------------
// Fila in-process + dedup de prospects em processamento
// ---------------------------------------------------------------------------
const _queue = [];
let _active = 0;
const _inFlight = new Map();

function enqueue(job) {
  return new Promise((resolve, reject) => {
    _queue.push({ job, resolve, reject });
    _drain();
  });
}

function _drain() {
  while (_active < CONCURRENCY && _queue.length) {
    const { job, resolve, reject } = _queue.shift();
    _active++;
    job()
      .then(resolve, reject)
      .finally(() => {
        _active--;
        _drain();
      });
  }
}

// ---------------------------------------------------------------------------
// Similaridade de nomes (razão social vs. nome da planilha)
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = /\b(ltda|limitada|s\.?\/?a\.?|s\.?a|me|mei|epp|eireli|eireli\.?|ss|inc|corp|llc)\b/g;

function nameTokens(name) {
  return String(name || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

// Palavras genéricas de razão social — não servem como âncora de identidade
// ("MARISPAN INDÚSTRIA" vs "IMPLEMENTOS MARISPAN": INDÚSTRIA não diferencia).
const GENERIC_WORDS = new Set(
  [
    'INDUSTRIA', 'INDUSTRIAL', 'INDUSTRIAS', 'COMERCIO', 'COMERCIAL', 'SERVICOS', 'SERVICO',
    'METALURGICA', 'EQUIPAMENTOS', 'EQUIPAMENTO', 'DISTRIBUIDORA', 'REPRESENTACOES',
    'REPRESENTACAO', 'IMPORTADORA', 'EXPORTADORA', 'MATERIAIS', 'PRODUTOS', 'PRODUTO',
    'TRANSPORTES', 'TRANSPORTE', 'AGRICOLA', 'AGRICOLAS', 'BRASIL', 'BRASILEIRA',
  ]
);

/**
 * Similaridade 0..1: Jaccard de tokens + bônus de ancoragem quando um token
 * RARO do nome-alvo (não-genérico, ≥5 letras) aparece no candidato — razões
 * sociais reais diferem muito do nome abreviado da planilha, mas a âncora
 * ("MARISPAN") quase sempre está lá.
 */
function nameSimilarity(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  let score = inter / union;

  const nb = [...tb].join(' ');
  let anchor = 0;
  for (const t of ta) {
    if (t.length >= 5 && !GENERIC_WORDS.has(t) && nb.includes(t)) {
      anchor = 0.72;
      if (tb.has(t)) anchor = 0.8; // âncora compartilhada como token exato
      break;
    }
  }
  score = Math.max(score, anchor);
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Extração de CNPJs de texto (snippets de busca)
// ---------------------------------------------------------------------------

const CNPJ_REGEX = /\d{2}\.?\s?\d{3}\.?\s?\d{3}\/?\s?\d{4}\s?-?\s?\d{2}/g;

function extractCnpjCandidates(text) {
  const out = [];
  for (const match of String(text || '').match(CNPJ_REGEX) || []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 14 && csvImport.isValidCnpj(digits) && !out.includes(digits)) {
      out.push(digits);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDL (People Data Labs)
// ---------------------------------------------------------------------------

let _pdlNextAt = 0;
function pdlThrottle() {
  const now = Date.now();
  const wait = Math.max(0, _pdlNextAt - now);
  _pdlNextAt = now + wait + PDL_MIN_INTERVAL_MS;
  return wait;
}

async function pdlRequest(path, params, { timeoutMs = 25000 } = {}) {
  if (!PDL_API_KEY) throw new Error('PDL_API_KEY ausente');
  const wait = pdlThrottle();
  if (wait) await new Promise((r) => setTimeout(r, wait));

  const qs = new URLSearchParams({ ...params, pretty: 'false' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${PDL_BASE}${path}?${qs}`, {
      signal: controller.signal,
      headers: { 'X-Api-Key': PDL_API_KEY },
    });
    if (res.status === 404) return null; // sem match — não é erro
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`pdl HTTP ${res.status}: ${(json && json.message) || ''}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Empresa por nome (+cidade). Resposta PDL company vem no topo do JSON.
 * Com `strict`, erros de provider (chave ausente, HTTP != 200/404, rede)
 * PROPAGAM — só match inexistente (HTTP 404) retorna null. Sem strict
 * (legado), qualquer falha vira null.
 */
async function pdlCompanyEnrich({ companyName, city }, { strict = false } = {}) {
  const params = { name: companyName, country: 'br' };
  if (city) params.locality = city;
  const json = await pdlRequest('/v5/company/enrich', params)
    .catch((err) => {
      if (strict) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'PROVIDER_UNAVAILABLE' });
      return null;
    });
  if (!json || !json.id) return null;
  return {
    pdl_id: json.id,
    name: json.display_name || json.name,
    website: json.website || null,
    linkedin_url: json.linkedin_url || null,
    facebook_url: json.facebook_url || null,
    twitter_url: json.twitter_url || null,
    industry: json.industry_v2 || json.industry || null,
    size: json.size || null,
    employee_count: json.employee_count || null,
    founded: json.founded || null,
    locality: json.location?.locality || null,
    region: json.location?.region || null,
  };
}

/**
 * Pessoa por e-mail OU por nome+empresa (PDL v5 person/enrich).
 * Resposta PDL person vem aninhada em `data`.
 */
async function pdlPersonEnrich({ email, contactName, companyName, city } = {}) {
  let params = null;
  if (email) {
    params = { email };
  } else if (contactName) {
    const parts = String(contactName).trim().split(/\s+/);
    params = {
      first_name: parts[0],
      ...(parts.length > 1 ? { last_name: parts[parts.length - 1] } : {}),
      ...(companyName ? { company: companyName } : {}),
      ...(city ? { locality: city } : {}),
      country: 'br',
    };
  }
  if (!params) return null;
  const json = await pdlRequest('/v5/person/enrich', params).catch(() => null);
  const p = json && json.data ? json.data : null;
  if (!p || (!p.full_name && !p.job_title && !p.linkedin_url)) return null;
  return {
    full_name: p.full_name || null,
    job_title: p.job_title || null,
    job_company_name: p.job_company_name || null,
    linkedin_url: p.linkedin_url || null,
    facebook_url: p.facebook_url || null,
    twitter_url: p.twitter_url || null,
    personal_phones: Array.isArray(p.personal_phones) ? p.personal_phones.slice(0, 3) : null,
  };
}

// ---------------------------------------------------------------------------
// RESOLUÇÃO DE CNPJ
// ---------------------------------------------------------------------------

function scoreCandidate(prospect, cand) {
  const target = prospect.companyName || '';
  const name = cand.legalName || cand.tradeName || '';
  let score = nameSimilarity(target, name);
  if (cand.tradeName) score = Math.max(score, nameSimilarity(target, cand.tradeName));
  if (prospect.city && cand.city) {
    const a = nameTokens(prospect.city).join(' ');
    const b = nameTokens(cand.city).join(' ');
    if (a && b && (a.includes(b) || b.includes(a))) score = Math.min(1, score + 0.12);
  }
  return score;
}

/**
 * Resolve o CNPJ de um lead. `deps` injetável para testes.
 * Retorna { cnpj, source, confidence, matchedName } ou null.
 */
async function resolveCnpj({ companyName, city, state }, deps = {}) {
  const getCompanyByCnpj = deps.getCompanyByCnpj || mcpCnpj.getCompanyByCnpj;
  const search = deps.searxSearch || searxSearch;
  if (!companyName) return null;

  const cityTokens = nameTokens(city || '').filter((t) => t.length >= 4);
  const anchorTokens = nameTokens(companyName).filter(
    (t) => t.length >= 5 && !GENERIC_WORDS.has(t)
  );

  // a) SearXNG: busca rápida (<10s) — candidatos saem dos snippets, com DV
  //    validado; cada candidato é confirmado na RFB (point lookup, timeout
  //    curto). Sem confirmação RFB possível, aceita o snippet com âncora do
  //    nome, preferindo os que também citam a cidade (homônimas são o
  //    principal risco).
  try {
    const queries = [`"${companyName}" CNPJ`];
    if (city) queries.push(`"${companyName}" ${city} CNPJ`);
    const results = [];
    let cityConfirmed = false;
    for (const q of queries) {
      const r = await search(q).catch(() => []);
      results.push(...r);
      // Antecipa a 2ª query apenas se já há candidato com âncora do nome E
      // cidade confirmada no snippet.
      cityConfirmed = results.some((x) => {
        const snippet = `${x.title} ${x.content}`.toUpperCase();
        return (
          extractCnpjCandidates(snippet).length &&
          cityTokens.every((t) => snippet.includes(t)) &&
          anchorTokens.some((t) => snippet.includes(t))
        );
      });
      if (cityConfirmed || !cityTokens.length) break;
    }
    const text = results.map((r) => `${r.title} ${r.content} ${r.url}`).join(' \n ');
    const candidates = extractCnpjCandidates(text).slice(0, 4);
    let best = null;
    for (const cnpj of candidates) {
      const company = await withTimeout(
        getCompanyByCnpj(cnpj).catch(() => null),
        RFB_LOOKUP_TIMEOUT_MS,
        'rfb-lookup'
      );
      if (company) {
        const score = scoreCandidate({ companyName, city }, company);
        if (!best || score > best.score) best = { score, company };
      }
    }
    if (best && best.score >= RESOLVE_NAME_THRESHOLD_SEARX) {
      return {
        cnpj: best.company.cnpj,
        source: 'searxng+rfb',
        confidence: Number(best.score.toFixed(2)),
        matchedName: best.company.legalName || best.company.tradeName,
      };
    }

    const scoredSnippets = [];
    for (const r of results) {
      const snippet = `${r.title} ${r.content}`;
      const upper = snippet.toUpperCase();
      if (!anchorTokens.some((t) => upper.includes(t))) continue;
      const cnpj = extractCnpjCandidates(snippet).find((c) => candidates.includes(c));
      if (!cnpj) continue;
      const cityMatch = cityTokens.length > 0 && cityTokens.every((t) => upper.includes(t));
      scoredSnippets.push({ cnpj, title: r.title, cityMatch });
    }
    scoredSnippets.sort((a, b) => Number(b.cityMatch) - Number(a.cityMatch));
    if (scoredSnippets.length) {
      const pick = scoredSnippets[0];
      return {
        cnpj: pick.cnpj,
        source: 'searxng',
        confidence: pick.cityMatch ? 0.65 : 0.55,
        matchedName: pick.title.slice(0, 120),
      };
    }
  } catch (err) {
    console.warn(`[lead-enrichment] busca SearXNG falhou: ${err.message}`);
  }

  // b) Base RFB local — busca full-text por nome (lenta: >45s no MCP atual),
  //    fica como último recurso com timeout generoso.
  const searchFn = deps.searchCompanies || (mcpCnpj.isMcpConfigured() ? mcpCnpj.searchCompanies : null);
  if (searchFn) {
    try {
      const candidates = await withTimeout(
        searchFn({ query: companyName, limit: 15 }),
        RFB_SEARCH_TIMEOUT_MS,
        'rfb-search'
      );
      let best = null;
      for (const cand of candidates || []) {
        const score = scoreCandidate({ companyName, city }, cand);
        if (!best || score > best.score) best = { score, cand };
      }
      if (best && best.score >= RESOLVE_NAME_THRESHOLD_RFB) {
        return {
          cnpj: best.cand.cnpj,
          source: 'rfb',
          confidence: Number(best.score.toFixed(2)),
          matchedName: best.cand.legalName || best.cand.tradeName,
        };
      }
    } catch (err) {
      console.warn(`[lead-enrichment] busca RFB falhou: ${err.message}`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// SCANS PROFUNDOS (premium) — jurídico e notícias via SearXNG.
// Não substituem consulta oficial: levantam INDÍCIOS com links para
// revisão humana, gravados em enrichmentSummary.
// ---------------------------------------------------------------------------

async function legalScan({ companyName, cnpj }) {
  const queries = [
    `"${companyName}" processo judicial`,
    cnpj ? `CNPJ ${cnpj} ação judicial` : `"${companyName}" ação trabalhista`,
  ];
  const links = [];
  for (const q of queries) {
    const results = await searxSearch(q, { limit: 5 }).catch(() => []);
    for (const r of results) {
      if (!links.some((l) => l.url === r.url)) {
        links.push({ title: r.title.slice(0, 140), url: r.url, snippet: r.content.slice(0, 200) });
      }
    }
    if (links.length >= 4) break;
  }
  return links.slice(0, 5);
}

async function newsScan({ companyName }) {
  const results = await searxSearch(`"${companyName}" (notícia OR investimento OR expansão OR faturamento)`, {
    limit: 6,
  }).catch(() => []);
  return results.slice(0, 4).map((r) => ({
    title: r.title.slice(0, 140),
    url: r.url,
    snippet: r.content.slice(0, 200),
  }));
}

/**
 * Logo público a partir do domínio (Google Favicons, sem chave).
 * Clearbit Logo foi descontinuado (logo.clearbit.com fora do DNS desde 2025).
 */
function logoForDomain(domain) {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

// ---------------------------------------------------------------------------
// FLUXO PRINCIPAL
// ---------------------------------------------------------------------------

/**
 * Entrada do lead (sem CNPJ) na esteira: marca 'pending', enfileira o
 * processamento e retorna imediatamente (fire-and-forget p/ o HTTP).
 */
function requestLeadEnrichment(prisma, prospect) {
  return prisma.prospect
    .update({
      where: { id: prospect.id },
      data: { enrichmentStatus: 'pending', enrichmentSource: 'lead-enrichment', enrichmentError: null },
    })
    .then((marked) => {
      // dedup: já processando este prospect → só devolve o estado pendente
      if (_inFlight.has(prospect.id)) return marked;
      const job = enqueue(() => _process(prisma, prospect.id))
        .catch((err) => console.error(`[lead-enrichment] erro no prospect ${prospect.id}:`, err.message))
        .finally(() => _inFlight.delete(prospect.id));
      _inFlight.set(prospect.id, job);
      return marked;
    });
}

async function _process(prisma, prospectId) {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect || prospect.cnpj) return; // outro fluxo resolveu entre a fila e agora

  const resolved = await resolveCnpj({
    companyName: prospect.companyName,
    tradeName: prospect.tradeName,
    city: prospect.city,
    state: prospect.state,
  }).catch(() => null);

  if (resolved) {
    try {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          cnpj: resolved.cnpj,
          taxIdType: 'br_cnpj',
          enrichmentSource: `cnpj-resolver:${resolved.source}`,
          enrichmentSummary: {
            ...(prospect.enrichmentSummary || {}),
            cnpj_resolution: {
              source: resolved.source,
              confidence: resolved.confidence,
              matched_name: resolved.matchedName,
              resolved_at: new Date().toISOString(),
            },
          },
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        // CNPJ já pertence a outro lead deste org (unicidade por org)
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            enrichmentStatus: 'unavailable',
            enrichmentSource: 'lead-enrichment',
            enrichmentError: 'CNPJ resolvido, mas já cadastrado em outro lead da sua lista',
          },
        });
        return;
      }
      throw err;
    }

    const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
    // Score sobe já na resolução (identificador + sinais do import)
    const { recalcLeadScore } = require('./opportunity-score');
    await recalcLeadScore(prisma, fresh).catch((err) =>
      console.error('[lead-enrichment] recalc pós-resolução falhou:', err.message)
    );
    const orgPlan = await plan.getOrgPlan(prisma, fresh.orgId);

    // PREMIUM: esteira profunda (worker NATS com OSINT; fallback BrasilAPI).
    // TRIAL: básico — firmografia oficial BrasilAPI.
    if (orgPlan === 'premium' && natsEnrichment.isNatsEnabled()) {
      const eventId = await natsEnrichment.requestEnrichment(prisma, fresh);
      if (eventId) return;
    }
    const cnpjEnrichment = require('./cnpj-enrichment');
    await cnpjEnrichment.enrichProspectWithCnpj(prisma, fresh).catch((err) =>
      console.error(`[lead-enrichment] fallback BrasilAPI falhou ${prospect.id}:`, err.message)
    );
    return;
  }

  const orgPlan = await plan.getOrgPlan(prisma, prospect.orgId);
  await _deepEnrichWithoutCnpj(prisma, prospect, { orgPlan });
}

/**
 * Sem CNPJ encontrado. PREMIUM: PDL (empresa + pessoa), scans jurídico e de
 * notícias (SearXNG) e logo. TRIAL: marca indisponível com upsell —
 * enriquecimento avançado é exclusivo do plano Premium.
 */
async function _deepEnrichWithoutCnpj(prisma, prospect, { orgPlan = 'trial', deps = {} } = {}) {
  if (orgPlan !== 'premium') {
    const nextStatus = pipelineTransitions.statusAfterEnrichment(
      { ...prospect, enrichmentStatus: 'unavailable' },
      orgPlan
    );
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        enrichmentStatus: 'unavailable',
        enrichmentSource: 'lead-enrichment',
        enrichmentError: 'CNPJ não localizado. Enriquecimento avançado (redes sociais, contatos, jurídico, notícias) é exclusivo do plano Premium.',
        // Feature 005 (FR-004): enriquecimento concluído — card avança.
        ...(nextStatus
          ? { status: nextStatus, ...(nextStatus === 'deep_analysis' ? { analysisStatus: 'not_started' } : {}) }
          : {}),
      },
    });
    // Score honesto mesmo no trial: pontua com os sinais já coletados.
    const { recalcLeadScore } = require('./opportunity-score');
    await recalcLeadScore(prisma, prospect).catch(() => {});
    return;
  }

  const summaryLead = {};
  let found = false;

  const src = {
    pdlCompanyEnrich: deps.pdlCompanyEnrich || pdlCompanyEnrich,
    pdlPersonEnrich: deps.pdlPersonEnrich || pdlPersonEnrich,
    legalScan: deps.legalScan || legalScan,
    newsScan: deps.newsScan || newsScan,
    enqueueAnalysis: deps.enqueueAnalysis || null,
  };

  if (PDL_API_KEY) {
    const company = await src.pdlCompanyEnrich({
      companyName: prospect.companyName,
      city: prospect.city,
    }).catch(() => null);
    if (company) {
      found = true;
      summaryLead.company = company;
      summaryLead.linkedin = company.linkedin_url;
    }

    const person = await src.pdlPersonEnrich({
      email: prospect.cnpjEmail,
      contactName: prospect.contactName,
      companyName: prospect.companyName,
      city: prospect.city,
    }).catch(() => null);
    if (person) {
      found = true;
      summaryLead.person = person;
    }
  }

  const legal = await src.legalScan({ companyName: prospect.companyName, cnpj: prospect.cnpj }).catch(() => []);
  if (legal.length) {
    found = found || legal.length > 0;
    summaryLead.legal = legal;
  }

  const news = await src.newsScan({ companyName: prospect.companyName }).catch(() => []);
  if (news.length) {
    summaryLead.news = news;
    found = true;
  }

  const domain = prospect.domain || (summaryLead.company && summaryLead.company.website) || null;

  // Feature 005 (FR-004): enriquecimento concluído — o card avança sozinho
  // (premium → "Análise profunda"; demais planos → "Prontas para contato").
  const nextStatus = pipelineTransitions.statusAfterEnrichment(
    { ...prospect, enrichmentStatus: found ? 'partial' : 'unavailable' },
    orgPlan
  );
  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      domain,
      logoUrl: prospect.logoUrl || logoForDomain(domain),
      // Contact name descoberto no PDL preenche o campo quando vazio.
      contactName: prospect.contactName || (summaryLead.person && summaryLead.person.full_name) || null,
      enrichmentStatus: found ? 'partial' : 'unavailable',
      enrichmentSource: found ? 'lead-enrichment:pdl' : 'lead-enrichment',
      enrichmentError: found
        ? null
        : 'CNPJ não localizado nas bases consultadas; sem dados externos adicionais',
      enrichmentSummary: { ...(prospect.enrichmentSummary || {}), lead_enrichment: summaryLead },
      ...(nextStatus
        ? { status: nextStatus, ...(nextStatus === 'deep_analysis' ? { analysisStatus: 'not_started' } : {}) }
        : {}),
    },
  });

  // Score final com todos os sinais coletados (PDL, scans, contatos).
  const fresh = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  const { recalcLeadScore } = require('./opportunity-score');
  await recalcLeadScore(prisma, fresh).catch((err) =>
    console.error('[lead-enrichment] recalc final falhou:', err.message)
  );

  // Feature 005 (FR-005): card pousou em "Análise profunda" — dispara a
  // análise de IA. Fire-and-forget: falha aqui não afeta o enriquecimento.
  if (nextStatus === 'deep_analysis' && fresh) {
    try {
      const enqueue = src.enqueueAnalysis
        ? src.enqueueAnalysis
        : async (p) => {
            const runner = require('./deep-analysis').getSharedRunner(prisma);
            return runner.enqueue(p, { trigger: 'auto' });
          };
      const enqueued = await enqueue(fresh);
      if (enqueued && enqueued.started) enqueued.done.catch(() => {});
    } catch (analysisErr) {
      console.error('[lead-enrichment] gatilho da análise profunda falhou:', analysisErr.message);
    }
  }
}

module.exports = {
  enabled,
  requestLeadEnrichment,
  resolveCnpj,
  _deepEnrichWithoutCnpj,
  extractCnpjCandidates,
  nameSimilarity,
  searxSearch,
  pdlCompanyEnrich,
  pdlPersonEnrich,
  legalScan,
  newsScan,
  logoForDomain,
};
