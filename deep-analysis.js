'use strict';

/**
 * deep-analysis.js — Análise Profunda de Lead por IA (feature 005,
 * specs/005-deep-lead-analysis). Submete o lead enriquecido a um modelo de IA
 * que cruza o CONTEXTO COMERCIAL DA ORGANIZAÇÃO (org-context.js a partir de
 * CommercialSettings) com os DADOS CAPTURADOS DO LEAD, emitindo o veredito
 * final: score (0–100), contato sim/não e resumo com impressões (FR-006/007).
 *
 * Decisões de design (research.md): roda IN-PROCESS na plataforma via
 * llm-client.js (R1); gatilho idempotente por enrichmentVersion (R6);
 * uma execução ativa por lead; falha NUNCA move o card (FR-015); o prompt
 * NUNCA contém valores crus de e-mail/telefone (padrão da feature 003).
 *
 * O runner recebe dependências injetadas (prisma, callLlm, getOrgPlan,
 * onMetric) para testes sem rede/banco — padrão qualification.js.
 */

const { callLlm, parseJsonLoose } = require('./llm-client');
const { classifyEmailDomain } = require('./opportunity-score');
const { computeContactDecision } = require('./contact-decision');
const { buildOrgContext } = require('./org-context');
const { getOrgPlan } = require('./plan');

// deepseek-v4-flash é reasoning: os tokens de raciocínio entram na mesma
// cota do JSON. Em produção, 2000 truncou ~10% das respostas (finish por
// comprimento → JSON inválido); 6000 cobre os casos longos com folga.
const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 45000;

// Chaves do enrichmentSummary consideradas seguras para o prompt (sem PII).
const SAFE_SUMMARY_KEYS = [
  'technologies',
  'tech_count',
  'social_platforms',
  'growth_tools',
  'website_active',
  'has_website',
  'domain_status',
];

const SYSTEM_PROMPT = [
  'Você é um analista de pré-vendas B2B sênior. Analise o lead fornecido CONTRA o contexto comercial da organização e emita um veredito final sobre se faz sentido entrar em contato com ele.',
  '',
  'Regras absolutas:',
  '- Baseie-se SOMENTE nos dados fornecidos. Não invente informações sobre o lead nem sobre a organização.',
  '- Se o contexto da organização estiver marcado como NÃO CONFIGURADO, NÃO afirme nada sobre o negócio dela — analise apenas os dados do lead.',
  '- Se os dados do lead forem escassos ou o enriquecimento falhou, diga isso explicitamente nas impressões em vez de deduzir.',
  '- Escreva em português do Brasil.',
  '',
  'Responda APENAS com um objeto JSON no formato:',
  '{',
  '  "score_final": <número inteiro de 0 a 100>,',
  '  "veredito": "contact" | "no_contact",',
  '  "resumo": "<resumo completo do lead: quem é, por que interessa (ou não) a esta organização, e o que sustenta o veredito>",',
  '  "impressoes": ["<impressão da IA sobre o lead>", "..."],',
  '  "fatores_pro": ["<fator a favor do contato>", "..."],',
  '  "fatores_con": ["<fator contra o contato>", "..."]',
  '}',
].join('\n');

/**
 * Evidência de contato SEM PII: apenas existência/classificação dos canais
 * (mesma garantia de privacidade do painel de decisão da feature 003).
 * Domínio "own" = próprio da empresa (corporativo); "free"/"accounting" =
 * genérico/provedor ou contabilidade terceirizada.
 */
function extractContactEvidence(prospect) {
  const p = prospect || {};
  const domainClass = p.cnpjEmail ? classifyEmailDomain(p.cnpjEmail) : null;
  const phones = Array.isArray(p.cnpjPhones) ? p.cnpjPhones.filter(Boolean) : [];
  return {
    email_corporativo: domainClass === 'own',
    email_generico: domainClass === 'free' || domainClass === 'accounting',
    telefone: phones.length > 0,
  };
}

/**
 * Monta o prompt da análise. O bloco de contexto da org vem de
 * org-context.js — inclui a degradação honesta quando não configurado (FR-017).
 */
function buildPrompt({ orgContext, prospect, enrichmentSummary, contactDecision, deterministicScore } = {}) {
  const p = prospect || {};
  const ctx = orgContext && typeof orgContext.renderForPrompt === 'function'
    ? orgContext.renderForPrompt()
    : '(NÃO CONFIGURADO — o cliente não descreveu o próprio negócio na plataforma.)\nNÃO invente nome de empresa, produto, serviço, diferenciais, site ou preços.';

  const summary = {};
  for (const key of SAFE_SUMMARY_KEYS) {
    if (enrichmentSummary && enrichmentSummary[key] != null) summary[key] = enrichmentSummary[key];
  }

  const payload = {
    contexto_da_organizacao: ctx,
    lead: {
      empresa: p.companyName || null,
      nome_fantasia: p.tradeName || null,
      setor: p.industry || null,
      cidade: p.city || null,
      estado: p.state || null,
      funcionarios: p.employees != null ? p.employees : null,
      receita_estimada: p.revenueEstimate != null ? p.revenueEstimate : null,
      cnpj_aberto_em: p.cnpjOpenedAt || null,
      natureza_juridica: p.cnpjLegalNature || null,
      situacao_enriquecimento: p.enrichmentStatus || null,
      evidencias_de_contato: extractContactEvidence(p),
      canais_ja_contactados: Array.isArray(p.contactedChannels) ? p.contactedChannels : [],
      presenca_digital: summary,
    },
    sinais_deterministicos: {
      score_oportunidade_deterministico: deterministicScore != null ? deterministicScore : null,
      decisao_de_contato: contactDecision || null,
    },
  };

  return { system: SYSTEM_PROMPT, user: JSON.stringify(payload) };
}

function asStringArray(value) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

/**
 * Valida e normaliza a saída do modelo (R4). Aceita string JSON (com ou sem
 * cercas de código) ou objeto. Lança em qualquer desvio — o chamador marca a
 * análise como failed e NUNCA aplica um resultado inválido.
 */
function validateResult(raw) {
  const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('deep_analysis: resultado do modelo não é um JSON válido');
  }

  const score = Number(parsed.score_final);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('deep_analysis: score_final inválido (precisa ser número entre 0 e 100)');
  }

  const verdict = parsed.veredito;
  if (verdict !== 'contact' && verdict !== 'no_contact') {
    throw new Error('deep_analysis: veredito inválido (esperado "contact" ou "no_contact")');
  }

  const summary = String(parsed.resumo || '').trim();
  if (!summary) throw new Error('deep_analysis: resumo vazio');

  const impressions = asStringArray(parsed.impressoes);
  const factorsPro = asStringArray(parsed.fatores_pro);
  const factorsCon = asStringArray(parsed.fatores_con);
  if (!impressions || !factorsPro || !factorsCon) {
    throw new Error('deep_analysis: impressoes/fatores_pro/fatores_con precisam ser listas de strings');
  }

  return {
    finalScore: Math.round(score),
    verdict,
    summary,
    impressions,
    factorsPro,
    factorsCon,
  };
}

/**
 * Para onde o lead vai com o veredito concluído: aprovado → "Prontas para
 * contato" (FR-009); reprovado → "Descartados" (FR-010).
 */
function verdictStatusAfter(verdict) {
  if (verdict === 'contact') return 'qualified';
  if (verdict === 'no_contact') return 'discarded';
  throw new Error(`deep_analysis: veredito desconhecido (${verdict})`);
}

function classifyFailure(err) {
  const msg = String((err && err.message) || err || '');
  if (/timeout/i.test(msg)) return 'timeout';
  if (/deep_analysis:/i.test(msg)) return 'invalid_result';
  if (/ENRICHMENT_QUOTA|quota/i.test(msg)) return 'quota';
  return 'llm_error';
}

/**
 * Runner da análise com dependências injetadas. `enqueue` é o gatilho único
 * (auto pós-enriquecimento/entrada na coluna; manual = reexecução, FR-014);
 * `reconcile` re-despacha execuções presas no boot (R6).
 */
function createDeepAnalysisRunner({
  prisma,
  callLlm: llmCall = callLlm,
  getOrgPlan: getPlan = getOrgPlan,
  onMetric,
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!prisma) throw new Error('deep_analysis: prisma é obrigatório');

  const inFlight = new Set(); // um run ativo por lead (single-pod; índice parcial no DB reforça)

  const metric = (name, labels) => {
    if (typeof onMetric === 'function') {
      try { onMetric(name, labels || {}); } catch (_) { /* métrica nunca derruba a análise */ }
    }
  };

  /**
   * Executa a análise de uma linha `running` já criada e aplica o resultado.
   */
  async function run(row, prospect) {
    const startedAt = now();
    try {
      const [org, settings] = await Promise.all([
        prisma.organization.findUnique({ where: { id: prospect.orgId } }).catch(() => null),
        prisma.commercialSettings.findUnique({ where: { orgId: prospect.orgId } }).catch(() => null),
      ]);
      const orgContext = buildOrgContext({ orgName: (org && org.name) || null, settings });

      let contactDecision = null;
      try {
        contactDecision = computeContactDecision(prospect, null);
      } catch (_) { /* painel 003 é insumo opcional — ausência não bloqueia */ }

      const { system, user } = buildPrompt({
        orgContext,
        prospect,
        enrichmentSummary: prospect.enrichmentSummary || {},
        contactDecision,
        deterministicScore: prospect.opportunityScore,
      });

      const { content, model } = await llmCall({
        system,
        user,
        temperature: DEFAULT_TEMPERATURE,
        maxTokens: DEFAULT_MAX_TOKENS,
        jsonMode: true,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        tag: 'deep-analysis',
        ...(process.env.DEEP_ANALYSIS_LLM_MODEL ? { model: process.env.DEEP_ANALYSIS_LLM_MODEL } : {}),
      });

      const result = validateResult(content);
      const orgContextConsidered = Boolean(orgContext && orgContext.configured);
      const completedAt = now();

      const updatedRow = await prisma.deepAnalysis.update({
        where: { id: row.id },
        data: {
          status: 'completed',
          finalScore: result.finalScore,
          verdict: result.verdict,
          summary: result.summary,
          impressions: result.impressions,
          factorsPro: result.factorsPro,
          factorsCon: result.factorsCon,
          orgContextConsidered,
          modelVersion: model || null,
          completedAt,
          errorMessage: null,
        },
      });

      // Aplicação do veredito (FR-008/009/010): score da IA vira o exibido,
      // lead avança para Prontas para contato ou desce para Descartados.
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          status: verdictStatusAfter(result.verdict),
          analysisStatus: 'completed',
          verdict: result.verdict,
          opportunityScore: result.finalScore,
          currentDeepAnalysisId: updatedRow.id,
        },
      });

      metric('completed', { verdict: result.verdict });
      metric('duration_seconds', { seconds: (completedAt - startedAt) / 1000 });
      logger.info &&
        logger.info(
          `[deep-analysis] lead ${prospect.id} concluída: score=${result.finalScore} veredito=${result.verdict}` +
          ` contexto_org=${orgContextConsidered ? 'ok' : 'ausente'}`
        );
      return { ok: true };
    } catch (err) {
      const reason = classifyFailure(err);
      try {
        await prisma.deepAnalysis.update({
          where: { id: row.id },
          data: { status: 'failed', errorMessage: String((err && err.message) || err) },
        });
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: { analysisStatus: 'failed' },
        });
      } catch (persistErr) {
        logger.error && logger.error(`[deep-analysis] falha ao persistir erro do lead ${prospect.id}:`, persistErr.message);
      }
      metric('failed', { reason });
      logger.warn && logger.warn(`[deep-analysis] lead ${prospect.id} falhou (${reason}):`, err.message);
      return { ok: false, reason };
    }
  }

  /**
   * Gatilho único da análise. Retorna { started, done } ou { skipped, reason }.
   * Idempotente por enrichmentVersion no gatilho automático (princípio II);
   * reexecução manual (trigger 'manual') substitui a vigente (FR-014) e é
   * bloqueada apenas se já houver execução ativa.
   */
  async function enqueue(prospect, { trigger = 'auto' } = {}) {
    if (!prospect || prospect.status !== 'deep_analysis') {
      return { skipped: true, reason: 'status' };
    }
    const plan = await getPlan(prisma, prospect.orgId);
    if (plan !== 'premium') {
      metric('skipped', { reason: 'plan' });
      return { skipped: true, reason: 'plan' };
    }
    if (inFlight.has(prospect.id)) {
      return { skipped: true, reason: 'running' };
    }

    const enrichmentVersion = Number(prospect.enrichmentVersion || 0);
    if (trigger === 'auto') {
      const existing = await prisma.deepAnalysis.findFirst({
        where: { prospectId: prospect.id, enrichmentVersion },
      });
      if (existing) {
        return { skipped: true, reason: `already_${existing.status}` };
      }
    } else {
      const running = await prisma.deepAnalysis.findFirst({
        where: { prospectId: prospect.id, status: 'running' },
      });
      if (running) return { skipped: true, reason: 'running' };
    }

    const row = await prisma.deepAnalysis.create({
      data: {
        prospectId: prospect.id,
        orgId: prospect.orgId,
        status: 'running',
        modelVersion: null,
        finalScore: null,
        verdict: null,
        summary: null,
        errorMessage: null,
        completedAt: null,
        enrichmentVersion,
        deterministicScore: prospect.opportunityScore != null ? prospect.opportunityScore : null,
      },
    });
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { analysisStatus: 'running' },
    });
    metric('started');
    logger.info &&
      logger.info(`[deep-analysis] lead ${prospect.id} enfileirada (trigger=${trigger}, v${enrichmentVersion})`);

    const done = run(row, prospect).finally(() => inFlight.delete(prospect.id));
    return { started: true, done };
  }

  /**
   * Reconciliação no boot (R6, padrão resumePendingEnrichments): leads presos
   * em "Análise profunda" com execução interrompida são re-despachados; leads
   * parados em not_started (release em ondas) são enfileirados.
   */
  async function reconcile({ limit } = {}) {
    if (process.env.DEEP_ANALYSIS_RECONCILE_ON_BOOT === 'false') {
      return { disabled: true, reconciled: 0, remaining: 0 };
    }
    const take = limit != null ? limit : Number(process.env.DEEP_ANALYSIS_RECONCILE_LIMIT) || 100;
    const stuck = await prisma.prospect.findMany({
      where: { status: 'deep_analysis', analysisStatus: 'running' },
      orderBy: { createdAt: 'asc' },
      take,
    });
    const waiting = await prisma.prospect.findMany({
      where: { status: 'deep_analysis', analysisStatus: 'not_started' },
      orderBy: { createdAt: 'asc' },
      take,
    });

    let reconciled = 0;
    for (const p of stuck) {
      if (inFlight.has(p.id)) continue;
      const runningRow = await prisma.deepAnalysis.findFirst({
        where: { prospectId: p.id, status: 'running' },
      });
      if (runningRow) {
        await prisma.deepAnalysis.update({
          where: { id: runningRow.id },
          data: { status: 'failed', errorMessage: 'Execução interrompida por restart — re-despachada na reconciliação.' },
        });
      }
      const result = await enqueue(p, { trigger: 'manual' });
      if (result.started) {
        reconciled += 1;
        await result.done.catch(() => {});
      }
    }
    for (const p of waiting) {
      if (inFlight.has(p.id)) continue;
      const result = await enqueue(p, { trigger: 'auto' });
      if (result.started) {
        reconciled += 1;
        await result.done.catch(() => {});
      }
    }
    return { reconciled, remaining: 0 };
  }

  return { enqueue, reconcile, runNow: run };
}

/**
 * Wiring de produção: runner real (llm-client + plan.js + métricas prom-client).
 * Usado por server-prod.js e pelos consumidores de enriquecimento.
 */
function createProductionRunner(prisma, logger = console) {
  const metrics = require('./metrics');
  return createDeepAnalysisRunner({
    prisma,
    logger,
    onMetric: (name, labels = {}) => {
      if (!metrics.isEnabled()) return;
      if (name === 'started') metrics.incDeepAnalysisStarted();
      else if (name === 'completed') metrics.incDeepAnalysisCompleted(labels.verdict);
      else if (name === 'failed') metrics.incDeepAnalysisFailed(labels.reason);
      else if (name === 'duration_seconds') metrics.observeDeepAnalysisDuration(labels.seconds);
    },
  });
}

// Runner compartilhado do processo (server-prod e consumidores NATS vivem no
// mesmo processo e compartilham o mesmo PrismaClient).
let _sharedRunner = null;
function getSharedRunner(prisma, logger = console) {
  if (!_sharedRunner) _sharedRunner = createProductionRunner(prisma, logger);
  return _sharedRunner;
}

module.exports = {
  buildPrompt,
  extractContactEvidence,
  validateResult,
  verdictStatusAfter,
  createDeepAnalysisRunner,
  createProductionRunner,
  getSharedRunner,
};
