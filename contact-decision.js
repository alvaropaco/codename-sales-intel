/**
 * Painel de decisão de contato do lead (feature 003): substitui as notas
 * genéricas Potencial/Prontidão/Lançamento por métricas que embasam a decisão
 * comercial de entrar em contato ou não — Atingibilidade ("consigo chegar?"),
 * Momento ("agora é hora?") e uma recomendação única e explicável.
 *
 * Puro e determinístico (mesmo padrão de opportunity-score.js): computa
 * on-read a partir de evidências já persistidas (Prospect + perfil do grafo).
 * Nenhuma rede, nenhum LLM, nenhuma migração. O payload gerado NUNCA contém
 * valores de e-mail/telefone — apenas existência, classificação e confiança
 * (contracts: specs/003-contact-decision-metrics/contracts/api.md).
 */
'use strict';

// ── Pesos de Atingibilidade (soma 100) ─────────────────────────────────────
// Canal antes de tudo: sem canal utilizável não há contato.
const REACH_WEIGHTS = {
  corporate_email: 40, // e-mail no domínio próprio do lead
  generic_email: 10,   // e-mail de provedor gratuito ou de contabilidade
  phone: 25,           // telefone no cadastro CNPJ ou capturado
  whatsapp: 10,        // WhatsApp capturado no enriquecimento
  enriched_email: 15,  // e-mail adicional capturado pelo enriquecimento (PDL)
};

// ── Pesos de Momento (soma 100; oficiais = 35, digitais = 65) ──────────────
const TIMING_WEIGHTS = {
  active_status: 25,     // situação cadastral ATIVA na Receita
  website_active: 20,    // site no ar
  corporate_email: 10,   // e-mail corporativo funcionando
  social: 10,            // presença social capturada
  growth_stack: 15,      // ferramentas de marketing/vendas/analytics
  tech_any: 5,           // qualquer tecnologia detectada
  recent: 10,            // CNPJ aberto há menos de 2 anos
  momentum_positive: 5,  // momentum positivo no score_breakdown
};

// Denominador da renormalização do Momento para leads sem CNPJ (FR-018):
// apenas os pesos digitais (100 − situação cadastral 25 − recentidade 10).
const TIMING_DIGITAL_SUBTOTAL = 65;

// ── Pesos dos fatores da recomendação ──────────────────────────────────────
const FACTOR_WEIGHTS = {
  reachability: 40,
  timing: 35,
  fit: 15,        // aderência: score_breakdown.setor + porte renormalizados
  risk: 10,       // 100 − creditRiskScore
};

// Veredito: média ponderada ≥65 → abordar agora; ≥40 → prioridade menor.
const VERDICT_THRESHOLDS = { contact_now: 65, contact_lower_priority: 40 };
// Níveis das métricas: ≥70 Alta, ≥45 Média, >0 Baixa.
const LEVEL_THRESHOLDS = { high: 70, medium: 45 };
// Evidência com captura mais antiga que isso recebe selo de desatualização.
const STALE_AFTER_DAYS = 90;

const MAX_FACTOR_RAW_FIT = 16; // SIGNAL_WEIGHTS.setor (8) + SIGNAL_WEIGHTS.porte (8)

// ── Helpers ─────────────────────────────────────────────────────────────────

const { classifyEmailDomain, isActive } = require('./opportunity-score');

const GROWTH_STACK_CATEGORIES = new Set(['analytics', 'marketing', 'crm', 'communications']);
const DAY_MS = 24 * 60 * 60 * 1000;

function clamp100(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function levelFor(score) {
  if (score == null) return 'unknown';
  if (score >= LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isStaleSince(date, now) {
  return date != null && now.getTime() - date.getTime() > STALE_AFTER_DAYS * DAY_MS;
}

function summaryOf(prospect) {
  const s = prospect.enrichmentSummary;
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

function rawCnpjOf(prospect) {
  const raw = prospect.cnpjRawData;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function phonesOf(prospect) {
  let phones = prospect.cnpjPhones;
  if (typeof phones === 'string') {
    try {
      phones = JSON.parse(phones);
    } catch {
      phones = [];
    }
  }
  return Array.isArray(phones) ? phones : [];
}

function normalizeKey(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Enriquecimento concluído (ou parcial) = esteira já consultou as fontes. */
function summaryEnrichmentDone(prospect) {
  return ['enriched', 'partial'].includes(String(prospect.enrichmentStatus || ''));
}

function emailClassificationOf(cls) {
  // classifyEmailDomain → own|free|accounting|null ; contrato → corporate|generic|third_party|unknown
  if (cls === 'own') return 'corporate';
  if (cls === 'free') return 'generic';
  if (cls === 'accounting') return 'third_party';
  return 'unknown';
}

// ── Canais de contato (extrai e deduplica; nunca exporta valores) ──────────

function extractChannels(prospect, graphProfile) {
  const channels = [];
  const seenEmails = new Set();
  const seenPhones = new Map();

  const pushEmail = (value, classification, confidence, source, date) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@') || seenEmails.has(normalized)) return;
    seenEmails.add(normalized);
    channels.push({
      type: 'email',
      classification,
      confidence,
      source,
      date,
      isCorporate: classification === 'corporate',
    });
  };

  const pushPhone = (value, type, confidence, source, date) => {
    const key = normalizeKey(value);
    if (!key) return;
    const existing = seenPhones.get(key);
    if (existing) {
      // Enriquecimento classificando o mesmo número como WhatsApp é mais
      // informativo que o telefone cru do cadastro — atualiza o canal.
      if (type === 'whatsapp' && existing.type === 'phone') {
        existing.type = 'whatsapp';
        if (confidence > existing.confidence) existing.confidence = confidence;
      }
      return;
    }
    const channel = { type, classification: 'unknown', confidence, source, date };
    seenPhones.set(key, channel);
    channels.push(channel);
  };

  const cadastroDate = toDate(prospect.updatedAt);
  const cnpjEmail = String(prospect.cnpjEmail || '').trim();
  if (cnpjEmail) {
    pushEmail(cnpjEmail, emailClassificationOf(classifyEmailDomain(cnpjEmail)), 0.8, 'cnpj', cadastroDate);
  }
  for (const phone of phonesOf(prospect)) pushPhone(phone, 'phone', 0.7, 'cnpj', cadastroDate);

  const points = graphProfile?.profile?.contact_points;
  const graphDate = toDate(graphProfile?.enrichedAt);
  if (Array.isArray(points)) {
    for (const point of points) {
      const type = String(point?.type || '').toLowerCase();
      const confidence = typeof point?.confidence === 'number' ? point.confidence : 0.5;
      if (type === 'email') {
        pushEmail(point.value, emailClassificationOf(classifyEmailDomain(point.value)), confidence, 'enrichment', graphDate);
      } else if (type === 'whatsapp') {
        pushPhone(point.value, 'whatsapp', confidence, 'enrichment', graphDate);
      } else if (type === 'phone') {
        pushPhone(point.value, 'phone', confidence, 'enrichment', graphDate);
      }
    }
  }
  return channels;
}

// ── Atingibilidade (FR-002) ────────────────────────────────────────────────

function computeReachability({ prospect, graphProfile }, now) {
  const channels = extractChannels(prospect, graphProfile);
  const summary = summaryOf(prospect);
  const evidence = [];
  const cadastroDate = toDate(prospect.updatedAt);

  // FR-008: sem nenhuma fonte consultável, "unknown" — nunca um número baixo
  // que simule medição de um lead ainda não enriquecido.
  const hasCadastro =
    Boolean(String(prospect.cnpjEmail || '').trim()) || phonesOf(prospect).length > 0;
  if (!hasCadastro && !graphProfile && !summaryEnrichmentDone(prospect)) {
    return {
      level: 'unknown',
      score: null,
      usableChannel: false,
      recommendedChannel: null,
      channels: [],
      evidence: [],
      basis: { prospect: true, graph: graphProfile != null, graph_available: graphProfile != null },
      stale: false,
    };
  }

  const corporate = channels.find((c) => c.type === 'email' && c.isCorporate);
  const generic = channels.find((c) => c.type === 'email' && !c.isCorporate);
  const extraEmails = channels.filter((c) => c.type === 'email' && c !== corporate && c !== generic);
  const whatsapp = channels.find((c) => c.type === 'whatsapp');
  // WhatsApp implica telefonia: o mesmo número atende chamada e mensagem.
  const phone = channels.find((c) => c.type === 'phone') || whatsapp;
  const scoredDates = []; // datas das evidências que pontuaram (base do selo de stale)

  let score = 0;
  if (corporate) {
    score += REACH_WEIGHTS.corporate_email;
    scoredDates.push(corporate.date || cadastroDate);
    evidence.push({
      key: 'corporate_email', label: 'E-mail corporativo próprio',
      detail: 'canal recomendado', confidence: corporate.confidence,
      date: corporate.date || cadastroDate,
    });
  }
  if (generic) {
    score += REACH_WEIGHTS.generic_email;
    scoredDates.push(generic.date || cadastroDate);
    evidence.push({
      key: 'generic_email',
      label: generic.classification === 'third_party' ? 'E-mail de contabilidade/terceirizado' : 'E-mail de provedor gratuito',
      detail: 'sem domínio próprio do lead', confidence: generic.confidence,
      date: generic.date || cadastroDate,
    });
  }
  if (extraEmails.length > 0) {
    score += REACH_WEIGHTS.enriched_email;
    scoredDates.push(extraEmails[0].date);
    evidence.push({
      key: 'enriched_email', label: 'E-mail capturado no enriquecimento',
      detail: `${extraEmails.length} adicional(is)`, confidence: extraEmails[0].confidence, date: extraEmails[0].date,
    });
  }
  if (whatsapp) {
    score += REACH_WEIGHTS.whatsapp;
    scoredDates.push(whatsapp.date);
    evidence.push({ key: 'whatsapp', label: 'WhatsApp capturado', detail: 'canal de mensagem direta', confidence: whatsapp.confidence, date: whatsapp.date });
  }
  if (phone) {
    score += REACH_WEIGHTS.phone;
    scoredDates.push(phone.date);
    evidence.push({
      key: 'phone', label: phone.source === 'cnpj' ? 'Telefone no cadastro CNPJ' : 'Telefone capturado no enriquecimento',
      detail: `${channels.filter((c) => c.type !== 'email').length} telefone(s)/WhatsApp`,
      confidence: phone.confidence, date: phone.date,
    });
  }

  score = clamp100(score);
  const usableChannel = channels.length > 0;
  if (!usableChannel) {
    evidence.push({
      key: 'no_channel', label: 'Nenhum canal de contato capturado',
      detail: 'nenhuma fonte encontrou e-mail, telefone ou WhatsApp',
    });
  }

  let recommendedChannel = null;
  if (corporate) recommendedChannel = 'email';
  else if (whatsapp) recommendedChannel = 'whatsapp';
  else if (generic || extraEmails.length > 0) recommendedChannel = 'email';
  else if (phone) recommendedChannel = 'phone';

  return {
    level: levelFor(score),
    score,
    usableChannel,
    recommendedChannel,
    channels: channels.map(({ type, classification, confidence }) => ({ type, classification, confidence })),
    evidence,
    basis: { prospect: true, graph: graphProfile != null, graph_available: graphProfile != null },
    // FR-016: stale = alguma evidência que PONTUOU é antiga (não oculta valor).
    stale: scoredDates.filter(Boolean).some((d) => isStaleSince(d, now)),
  };
}

// ── Momento (FR-003, FR-018) ───────────────────────────────────────────────

function computeTiming({ prospect, graphProfile }, now) {
  const summary = summaryOf(prospect);
  const breakdown = summary.score_breakdown && typeof summary.score_breakdown === 'object' ? summary.score_breakdown : {};
  const profile = graphProfile?.profile || null;
  const evidence = [];
  const summaryDate = toDate(prospect.enrichedAt);
  const graphDate = toDate(graphProfile?.enrichedAt);
  const cadastroDate = toDate(prospect.updatedAt);
  const scoredDates = []; // datas das evidências que pontuaram (base do selo de stale)

  let score = 0;

  // Situação cadastral (sinal oficial mais forte — empresa viva).
  const cnpjData = rawCnpjOf(prospect);
  let inactive = null;
  const hasSituacao = Boolean(cnpjData && (cnpjData.situacao_cadastral != null || cnpjData.descricao_situacao_cadastral));

  // FR-008: sem evidência digital nem oficial, "unknown" — nunca número baixo.
  const digitalEvidence =
    summary.website_active != null || summary.corporate_email != null || Number(summary.tech_count) > 0 || graphProfile != null;
  const officialEvidence = hasSituacao || Boolean(toDate(prospect.cnpjOpenedAt));
  if (!digitalEvidence && !officialEvidence) {
    return {
      level: 'unknown',
      score: null,
      inactive: null,
      missingOfficialSignals: prospect.cnpj ? [] : ['situacao_cadastral', 'cnpj_age'],
      evidence,
      basis: { prospect: true, graph: graphProfile != null, graph_available: graphProfile != null },
      stale: false,
    };
  }

  if (hasSituacao) {
    inactive = !isActive(cnpjData);
    if (inactive) {
      evidence.push({
        key: 'inactive_status', label: 'Situação cadastral irregular',
        detail: String(cnpjData.descricao_situacao_cadastral || 'não ativa na Receita'), date: cadastroDate,
      });
    } else {
      score += TIMING_WEIGHTS.active_status;
      scoredDates.push(cadastroDate);
      evidence.push({ key: 'active_status', label: 'Situação cadastral ativa', detail: 'Receita Federal', date: cadastroDate });
    }
  }

  // Site no ar.
  if (summary.website_active != null) {
    if (summary.website_active) {
      score += TIMING_WEIGHTS.website_active;
      scoredDates.push(summaryDate);
      evidence.push({ key: 'website_active', label: 'Site no ar', detail: 'domínio ativo e acessível', date: summaryDate });
    } else {
      evidence.push({ key: 'website_inactive', label: 'Site fora do ar', detail: 'risco de empresa parada', date: summaryDate });
    }
  }

  // E-mail corporativo funcionando.
  if (summary.corporate_email === true) {
    score += TIMING_WEIGHTS.corporate_email;
    scoredDates.push(summaryDate);
    evidence.push({ key: 'corporate_email', label: 'E-mail corporativo funcionando', detail: 'caixa ativa no domínio próprio', date: summaryDate });
  }

  // Presença social.
  const socialKeys = profile?.social && typeof profile.social === 'object' ? Object.keys(profile.social) : [];
  if (socialKeys.length > 0) {
    score += TIMING_WEIGHTS.social;
    scoredDates.push(graphDate);
    evidence.push({ key: 'social', label: 'Presença social ativa', detail: socialKeys.join(', '), date: graphDate });
  }

  // Stack de crescimento (marketing/vendas/analytics) — empresa investindo.
  const techs = Array.isArray(profile?.technologies) ? profile.technologies : [];
  const growthFound = techs.filter((t) => GROWTH_STACK_CATEGORIES.has(String(t?.category || '').toLowerCase()));
  if (growthFound.length > 0) {
    score += TIMING_WEIGHTS.growth_stack;
    scoredDates.push(graphDate);
    evidence.push({
      key: 'growth_stack', label: 'Ferramentas de marketing/vendas',
      detail: growthFound.map((t) => t.name || t.category).filter(Boolean).slice(0, 3).join(', '), date: graphDate,
    });
  }

  // Qualquer tecnologia detectada.
  const techCount = Number(summary.tech_count) > 0 ? Number(summary.tech_count) : techs.length;
  if (techCount > 0) {
    score += TIMING_WEIGHTS.tech_any;
    scoredDates.push(graphDate || summaryDate);
    evidence.push({ key: 'tech_any', label: 'Tecnologias detectadas', detail: `${techCount} ferramenta(s)`, date: graphDate || summaryDate });
  }

  // Empresa recente (fase de montagem costuma ser receptiva).
  const openedAt = toDate(prospect.cnpjOpenedAt);
  if (openedAt) {
    const ageYears = (now.getTime() - openedAt.getTime()) / (365.25 * DAY_MS);
    if (ageYears < 2) {
      score += TIMING_WEIGHTS.recent;
      scoredDates.push(cadastroDate);
      evidence.push({ key: 'recent', label: 'Empresa recente', detail: 'CNPJ aberto há menos de 2 anos', date: cadastroDate });
    }
  }

  // Momentum do score de sinais.
  if (Number(breakdown.momentum) > 0) {
    score += TIMING_WEIGHTS.momentum_positive;
    scoredDates.push(summaryDate);
    evidence.push({ key: 'momentum_positive', label: 'Sinais de impulso', detail: 'movimentação recente capturada', date: summaryDate });
  }

  // Sem CNPJ (FR-018): renormaliza sobre os pesos digitais e lista os oficiais ausentes.
  const missingOfficialSignals = [];
  if (!prospect.cnpj) {
    missingOfficialSignals.push('situacao_cadastral', 'cnpj_age');
    score = clamp100((score * 100) / TIMING_DIGITAL_SUBTOTAL);
  } else {
    score = clamp100(score);
  }

  return {
    level: levelFor(score),
    score,
    inactive,
    missingOfficialSignals,
    evidence,
    basis: { prospect: true, graph: graphProfile != null, graph_available: graphProfile != null },
    // FR-016: stale = alguma evidência que PONTUOU é antiga (não oculta valor).
    stale: scoredDates.filter(Boolean).some((d) => isStaleSince(d, now)),
  };
}

// ── Recomendação única (FR-004..FR-007, gates FR-014, contexto FR-015) ─────

function contactedChannelsOf(prospect) {
  let channels = prospect.contactedChannels;
  if (typeof channels === 'string') {
    try {
      channels = JSON.parse(channels);
    } catch {
      channels = [];
    }
  }
  return Array.isArray(channels) ? channels.map(String) : [];
}

/** Risco alto: nível explícito ou, na falta dele, terço superior do score. */
function isHighCreditRisk(prospect) {
  if (prospect.creditRiskLevel != null) return prospect.creditRiskLevel === 'high';
  return prospect.creditRiskScore != null && Number(prospect.creditRiskScore) >= 67;
}

function computeRecommendation({ prospect, reachability, timing }) {
  const breakdown = (() => {
    const s = summaryOf(prospect);
    return s.score_breakdown && typeof s.score_breakdown === 'object' ? s.score_breakdown : {};
  })();

  const reachabilityFactor =
    reachability.level === 'unknown'
      ? { weight: FACTOR_WEIGHTS.reachability, value: null, status: 'unknown' }
      : { weight: FACTOR_WEIGHTS.reachability, value: reachability.score, status: 'used' };
  const timingFactor =
    timing.level === 'unknown'
      ? { weight: FACTOR_WEIGHTS.timing, value: null, status: 'unknown' }
      : { weight: FACTOR_WEIGHTS.timing, value: timing.score, status: 'used' };

  const fitRaw = (Number(breakdown.setor) || 0) + (Number(breakdown.porte) || 0);
  const fitFactor =
    fitRaw > 0
      ? { weight: FACTOR_WEIGHTS.fit, value: clamp100((fitRaw / MAX_FACTOR_RAW_FIT) * 100), status: 'used' }
      : { weight: FACTOR_WEIGHTS.fit, value: 50, status: 'neutral' }; // sem perfil comercial configurado

  const riskFactor =
    prospect.creditRiskScore != null
      ? { weight: FACTOR_WEIGHTS.risk, value: clamp100(100 - Number(prospect.creditRiskScore)), status: 'used' }
      : { weight: FACTOR_WEIGHTS.risk, value: 50, status: 'neutral' };

  const factors = {
    reachability: reachabilityFactor,
    timing: timingFactor,
    fit: fitFactor,
    risk: riskFactor,
  };

  // Média ponderada renormalizada: fatores 'unknown' saem do denominador
  // (não penalizam lead por falta de dado — FR-008).
  const available = Object.values(factors).filter((f) => f.status !== 'unknown');
  const totalWeight = available.reduce((acc, f) => acc + f.weight, 0);
  const weighted =
    totalWeight > 0
      ? available.reduce((acc, f) => acc + f.weight * (f.value || 0), 0) / totalWeight
      : 0;

  let verdict =
    weighted >= VERDICT_THRESHOLDS.contact_now
      ? 'contact_now'
      : weighted >= VERDICT_THRESHOLDS.contact_lower_priority
        ? 'contact_lower_priority'
        : 'do_not_prioritize';

  // ── Motivos decisivos (códigos estáveis — contracts/api.md) ──
  const reasons = [];
  const hasCorporate = reachability.channels?.some((c) => c.type === 'email' && c.classification === 'corporate');
  const hasAnyEmail = reachability.channels?.some((c) => c.type === 'email');
  if (hasCorporate) reasons.push({ code: 'corporate_email', detail: 'e-mail no domínio próprio disponível' });
  else if (hasAnyEmail) reasons.push({ code: 'generic_email_only', detail: 'sem e-mail no domínio próprio' });
  if (reachability.usableChannel) {
    reasons.push({ code: 'channels_available', detail: 'canais de contato prontos para uso' });
  }
  const highRisk = isHighCreditRisk(prospect);
  if (timing.inactive) {
    reasons.push({ code: 'inactive_company', detail: 'situação cadastral irregular na Receita' });
  }
  if (highRisk) {
    reasons.push({ code: 'high_credit_risk', detail: 'risco de crédito elevado para este lead' });
  }
  if (timing.level !== 'unknown' && !timing.inactive && (timing.level === 'high' || timing.level === 'medium')) {
    reasons.push({ code: 'good_timing', detail: 'empresa operando e investindo agora' });
  } else if (timing.level === 'low') {
    reasons.push({ code: 'bad_timing', detail: 'poucos sinais de atividade recente' });
  }

  // ── Gates (FR-014): nunca "abordar agora" sem base real ──
  if (reachability.level === 'unknown') {
    reasons.push({ code: 'insufficient_data', detail: 'sem evidências de contato suficientes' });
    if (verdict === 'contact_now') verdict = 'contact_lower_priority';
  }
  if (reachability.level !== 'unknown' && !reachability.usableChannel) {
    reasons.push({ code: 'no_channel', detail: 'capture canais de contato antes de abordar' });
    verdict = 'do_not_prioritize';
  }
  if (verdict === 'contact_now' && (timing.inactive || highRisk)) {
    verdict = 'contact_lower_priority';
  }
  if (timing.inactive && highRisk) {
    verdict = 'do_not_prioritize';
  }

  // ── Próxima ação sugerida (FR-005) ──
  let suggestedAction = null;
  if (reachability.level === 'unknown' || !reachability.usableChannel) {
    suggestedAction = 'enrich_lead';
  } else if (verdict === 'contact_now') {
    if (reachability.recommendedChannel === 'whatsapp') suggestedAction = 'start_whatsapp';
    else if (reachability.recommendedChannel === 'email') suggestedAction = 'start_email';
  } else if (verdict === 'do_not_prioritize' && reachability.usableChannel && !timing.inactive) {
    suggestedAction = 'defer';
  }

  // ── Contexto de contato prévio (FR-015): não altera o veredito ──
  const priorChannels = contactedChannelsOf(prospect);
  const lastContactDate = toDate(prospect.lastContact);
  const advancedStatus = ['contacted', 'proposal', 'closed'].includes(String(prospect.status || ''));
  const contacted = priorChannels.length > 0 || lastContactDate != null || advancedStatus;
  const contactedContext = contacted
    ? {
        contacted: true,
        channels: priorChannels,
        lastContact: lastContactDate
          ? lastContactDate.toISOString()
          : typeof prospect.lastContact === 'string'
            ? prospect.lastContact
            : null,
      }
    : null;

  return { verdict, reasons, factors, suggestedAction, contactedContext };
}

// ── Agregador (payload do endpoint) ────────────────────────────────────────

/**
 * @param {object} prospect linha do Prisma (dados não mascarados)
 * @param {object|null} graphData resultado de enrichment-graph.fetchCompanyGraph
 * @param {Date} [now] injetável para testes
 */
function computeContactDecision(prospect, graphData, now = new Date()) {
  const graphProfile = graphData && typeof graphData === 'object' ? graphData : null;
  const reachability = computeReachability({ prospect, graphProfile }, now);
  const timing = computeTiming({ prospect, graphProfile }, now);
  const recommendation = computeRecommendation({ prospect, reachability, timing });

  const dates = [
    toDate(prospect.enrichedAt),
    toDate(graphProfile?.enrichedAt),
    toDate(prospect.updatedAt),
  ].filter(Boolean);
  const lastEvidenceAt = dates.sort((a, b) => b - a)[0] || null;

  return {
    prospectId: prospect.id,
    generatedAt: now.toISOString(),
    dataRestricted: false, // endpoint sobrescreve conforme o plano
    freshness: {
      stale: reachability.stale || timing.stale,
      lastEvidenceAt: lastEvidenceAt ? lastEvidenceAt.toISOString() : null,
      thresholdDays: STALE_AFTER_DAYS,
    },
    reachability,
    timing,
    recommendation,
  };
}

module.exports = {
  REACH_WEIGHTS,
  TIMING_WEIGHTS,
  TIMING_DIGITAL_SUBTOTAL,
  FACTOR_WEIGHTS,
  VERDICT_THRESHOLDS,
  LEVEL_THRESHOLDS,
  STALE_AFTER_DAYS,
  MAX_FACTOR_RAW_FIT,
  computeReachability,
  computeTiming,
  computeRecommendation,
  computeContactDecision,
};
