/**
 * ai-campaign.js — Gerador de campanha com IA (feature PREMIUM).
 *
 * Um clique: a IA lê o contexto comercial da org (org-context.js — pilar 1),
 * cria a estratégia da campanha (nome/objetivo/oferta), salva as campanhas
 * (email e/ou WhatsApp, conforme contas conectadas) e INICIA os disparos para
 * TODOS os leads em status "Prontos para contato" (Prospect.status='qualified').
 *
 * Mensagem única por lead:
 *   - Email: a campanha nasce SEM template custom → processPrepare gera via IA
 *     por lead (comportamento existente de outreach-workers.js).
 *   - WhatsApp: step criado com aiPersonalized=true → whatsapp-workers.js gera
 *     mensagem única por lead; messageTemplate é o fallback garantido.
 *
 * Guardas (todas com fallback determinístico — a feature nunca "quebra"):
 *   - Premium obrigatório (defesa em profundidade; o endpoint também checa).
 *   - Limite diário por org (AI_CAMPAIGN_DAILY_LIMIT, default 3).
 *   - Sem canal conectado / sem lead pronto → erro de domínio (HTTP-mapeável).
 *   - LLM indisponível/alias inexistente → estratégia determinística.
 *
 * Modelo: AI_CAMPAIGN_LLM_MODEL (melhor/barato do cluster LiteLLM, ex.
 * deepseek/deepseek-chat) com fallback para LITELLM_MODEL dentro do
 * llm-client.js.
 */
const llm = require('./llm-client');
const orgContext = require('./org-context');
const { validateTemplateMessage, renderTemplate } = require('./whatsapp-utils');
const metrics = require('./metrics');

const AI_CAMPAIGN_DAILY_LIMIT = Number(process.env.AI_CAMPAIGN_DAILY_LIMIT || 3);

// Limite de comprimento da mensagem base WhatsApp (deixa folga para a
// personalização por lead antes do guard de 600 chars do worker).
const BASE_MESSAGE_MAX_LEN = 400;

/** Erro de domínio com código e status HTTP (o endpoint só repassa). */
class AiCampaignError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Premium = Organization.plan 'premium' (mesma definição de applySubscriptionState). */
async function isPremiumOrg(prisma, orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true },
  });
  return Boolean(org && String(org.plan || '').toLowerCase() === 'premium');
}

/**
 * Canais disponíveis para a campanha: conta de email conectada e/ou conta
 * WhatsApp CONNECTED (a mais antiga de cada, que é a conta "principal").
 */
async function detectChannels(prisma, orgId) {
  const [emailAccount, waAccount] = await Promise.all([
    prisma.emailAccount.findFirst({
      where: { tenantId: orgId, status: 'connected' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.whatsAppAccount.findFirst({
      where: { orgId, status: 'CONNECTED' },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const channels = [];
  if (emailAccount) channels.push('email');
  if (waAccount) channels.push('whatsapp');
  return { channels, emailAccount: emailAccount || null, waAccount: waAccount || null };
}

/** Máx. de campanhas IA por dia — janela do dia corrente (fuso do servidor). */
async function assertDailyLimit(prisma, orgId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const created = await prisma.outreachCampaign.count({
    where: { tenantId: orgId, source: 'ai', createdAt: { gte: startOfDay } },
  });
  if (created >= AI_CAMPAIGN_DAILY_LIMIT) {
    throw new AiCampaignError(
      'AI_CAMPAIGN_LIMIT',
      `Limite de ${AI_CAMPAIGN_DAILY_LIMIT} campanhas de IA por dia atingido. Tente novamente amanhã.`,
      429
    );
  }
}

// ─── Estratégia da campanha (1 chamada LLM) ───────────────────────

function buildStrategyPrompt({ orgCtx, channels, leadCount, leadSamples }) {
  const sampleLines = leadSamples.map((l) => {
    const local = [l.city, l.state].filter(Boolean).join('/');
    return `- ${l.companyName}${l.industry ? ` — segmento ${l.industry}` : ''}${local ? ` — ${local}` : ''}`;
  });

  return [
    'Você é um estrategista de vendas B2B brasileiro. Crie a estratégia de uma',
    'campanha de prospecção por email e/ou WhatsApp para a empresa abaixo.',
    '',
    '== CONTEXTO DA NOSSA EMPRESA ==',
    orgCtx.renderForPrompt(),
    '',
    `== CANAIS DA CAMPANHA == ${channels.join(' + ')}`,
    `== PÚBLICO-ALVO == ${leadCount} leads prontos para contato (pré-qualificados por enriquecimento de CNPJ). Amostra:`,
    ...sampleLines,
    '',
    'REGRAS:',
    '- Use apenas fatos do contexto acima; NÃO invente produto, preço, prazo ou promessa.',
    '- "name": nome curto e comercial da campanha (máx. 60 caracteres, sem aspas).',
    '- "objective": objetivo concreto (ex.: agendar uma conversa de 15 min, conseguir resposta).',
    '- "offer": em 1-2 frases, o valor/oferta a apresentar ao lead nesta campanha.',
    contextWarningLine(orgCtx),
    '',
    'Retorne SOMENTE JSON válido:',
    '{ "name": "...", "objective": "...", "offer": "..." }',
  ].join('\n');
}

function contextWarningLine(orgCtx) {
  return orgCtx && orgCtx.configured
    ? '- A campanha deve soar como a EMPRESA do contexto (nunca mencione a plataforma).'
    : '- Contexto não configurado: seja genérico e honesto, sem inventar dados da empresa.';
}

function sanitizeStrategy(raw) {
  const clean = (v, max) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
  };
  if (!raw || typeof raw !== 'object') return null;
  const name = clean(raw.name, 80);
  if (!name) return null;
  return {
    name,
    objective: clean(raw.objective, 500),
    offer: clean(raw.offer, 500),
  };
}

/** Fallback determinístico (LLM indisponível) — identidade vem do contexto da org. */
function fallbackStrategy(orgCtx) {
  const nome = (orgCtx && orgCtx.nome) || 'Campanha IA';
  const valor = (orgCtx && (orgCtx.propostaValor || orgCtx.oQueE)) || null;
  return {
    name: `Campanha IA — ${nome}`.slice(0, 80),
    objective: (orgCtx && orgCtx.ctaGoal) || 'Agendar uma conversa rápida com o lead',
    offer: valor ? `Apresentar como ${nome} ajuda na prática: ${valor}`.slice(0, 500) : null,
    fallbackUsed: true,
  };
}

async function generateCampaignStrategy({ orgCtx, channels, leadCount, leadSamples }) {
  try {
    const { content } = await llm.callLlm({
      system: 'Você é um estrategista de vendas B2B brasileiro. Responda APENAS com JSON válido.',
      user: buildStrategyPrompt({ orgCtx, channels, leadCount, leadSamples }),
      temperature: 0.6,
      maxTokens: 500,
      model: llm.premiumModel(),
      tag: 'ai-campaign:strategy',
    });
    const strategy = sanitizeStrategy(llm.parseJsonLoose(content));
    if (!strategy) throw new Error('estratégia inválida/sem nome');
    return { ...strategy, fallbackUsed: false };
  } catch (err) {
    console.error('[ai-campaign] geração de estratégia falhou, usando fallback:', err.message);
    return fallbackStrategy(orgCtx);
  }
}

// ─── Orquestrador: cria + lança ───────────────────────────────────

/**
 * Fluxo completo. Lança AiCampaignError para condições de domínio; falhas de
 * LANÇAMENTO de um canal não derrubam o outro (vêm em `launchErrors`).
 *
 * @returns {{
 *   emailCampaignId: string|null, whatsappCampaignId: string|null,
 *   channels: string[], leadCount: number, enrolled: {email: number, whatsapp: number},
 *   contextConfigured: boolean, strategy: object, launchErrors: string[]
 * }}
 */
async function createAndLaunchAiCampaign(prisma, { orgId, userId } = {}) {
  if (!orgId) throw new AiCampaignError('UNAUTHORIZED', 'Organização não identificada.', 401);

  // 0. Premium (defesa em profundidade — o endpoint também valida).
  if (!(await isPremiumOrg(prisma, orgId))) {
    throw new AiCampaignError(
      'PREMIUM_REQUIRED',
      'A campanha com IA está disponível apenas no plano Premium.',
      403
    );
  }

  // 1. Guarda de abuso.
  await assertDailyLimit(prisma, orgId);

  // 2. Contexto da org (pilar 1 dos prompts). Sem contexto configurado segue
  //    com degradação honesta (prompts não inventam dados).
  const orgCtx = await orgContext.loadOrgContext(prisma, orgId);

  // 3. Canais.
  const { channels, emailAccount, waAccount } = await detectChannels(prisma, orgId);
  if (!channels.length) {
    throw new AiCampaignError(
      'NO_CHANNEL_AVAILABLE',
      'Conecte uma conta de email ou WhatsApp antes de gerar a campanha com IA.',
      400
    );
  }

  // 4. Leads "Prontos para contato" (melhor score primeiro — com rate limit,
  //    os melhores leads recebem os primeiros envios do dia).
  const prospects = await prisma.prospect.findMany({
    where: { orgId, status: 'qualified' },
    select: {
      id: true, companyName: true, tradeName: true, industry: true,
      city: true, state: true, employees: true, revenueEstimate: true,
      opportunityScore: true, contactName: true,
    },
    orderBy: { opportunityScore: 'desc' },
  });
  if (!prospects.length) {
    throw new AiCampaignError(
      'NO_READY_LEADS',
      'Nenhum lead em "Prontos para contato" no momento.',
      400
    );
  }
  const leadSamples = prospects.slice(0, 10);

  // 5. Estratégia (IA, com fallback determinístico) — metadados internos da
  //    campanha (objective/offer NUNCA entram no corpo das mensagens).
  const strategy = await generateCampaignStrategy({ orgCtx, channels, leadCount: prospects.length, leadSamples });

  // 6. Mensagem base por whitelist do perfil comercial (FR-002/FR-006): o
  //    corpo composto usa só nome comercial + proposta de valor. objective,
  //    ctaGoal e offer ficam como metadados/instruções para a IA por lead.
  const waBase = composeBaseFromProfile(orgCtx);
  if (channels.includes('whatsapp') && !waBase) {
    throw new AiCampaignError(
      'NO_PROFILE_CONTEXT',
      'Não foi possível compor a mensagem base: complete o perfil comercial da organização.',
      409
    );
  }
  const emailBase = composeEmailBaseFromProfile(orgCtx);

  // 7. Cria as campanhas em AGUARDANDO APROVAÇÃO (FR-009): nada é enfileirado
  //    aqui — o tenant vê a prévia e aprova via POST /api/ai/campaigns/approve.
  const result = {
    status: 'pending_approval',
    emailCampaignId: null,
    whatsappCampaignId: null,
    channels,
    leadCount: prospects.length,
    contextConfigured: Boolean(orgCtx.configured),
    strategy,
  };

  let emailCampaign = null;
  if (channels.includes('email')) {
    emailCampaign = await prisma.outreachCampaign.create({
      data: {
        tenantId: orgId,
        name: strategy.name,
        description: 'Campanha criada automaticamente pela IA.',
        objective: strategy.objective,
        offer: strategy.offer,
        status: 'draft',
        trigger: 'manual',
        source: 'ai',
        channels,
        autoActive: false,
        emailAccountId: emailAccount.id,
        whatsappAccountId: waAccount ? waAccount.id : null,
        approvedAt: null,
        // Base composta do perfil (visível/editável/aprovável pelo tenant);
        // sem perfil configurado, template fica null e o prepare usa a IA
        // por lead como hoje.
        emailTemplateSubject: emailBase ? emailBase.subject : null,
        emailTemplateBody: emailBase ? emailBase.body : null,
      },
    });
    result.emailCampaignId = emailCampaign.id;
  }

  let waCampaign = null;
  if (channels.includes('whatsapp')) {
    waCampaign = await prisma.whatsAppCampaign.create({
      data: {
        orgId,
        name: strategy.name,
        objective: strategy.objective,
        offer: strategy.offer,
        ctaUrl: orgCtx.site || null,
        whatsappAccountId: waAccount.id,
        status: 'DRAFT',
        source: 'ai',
        approvedAt: null,
        steps: {
          create: {
            orderIndex: 0,
            messageTemplate: waBase,
            aiPersonalized: true, // mensagem única por lead; base acima é o fallback
            delayMinutes: 0,
          },
        },
      },
    });
    result.whatsappCampaignId = waCampaign.id;
  }

  // 8. Prévia renderizada com um lead REAL da org (FR-009/SC-005).
  const sample = prospects[0];
  result.preview = {
    sampleProspect: {
      id: sample.id,
      companyName: sample.companyName,
      contactName: sample.contactName || null,
    },
    whatsapp: waBase
      ? { message: renderTemplate(waBase, sample), aiPersonalized: true }
      : null,
    email: emailBase
      ? {
          subject: renderTemplate(emailBase.subject, sample),
          body: renderTemplate(emailBase.body, sample),
        }
      : null,
  };

  console.log(
    `[ai-campaign] org ${orgId}: campanha IA criada (aguardando aprovação) ` +
    `(canais=${channels.join('+')}, leads=${prospects.length}, ` +
    `email=${result.emailCampaignId || '-'}, wa=${result.whatsappCampaignId || '-'})`
  );
  return result;
}

// ─── Aprovação da mensagem base e lançamento (FR-009, 007) ────────────────

/**
 * Aprova a mensagem base da campanha IA e LANÇA os disparos. Único caminho
 * de lançamento do fluxo IA — a criação apenas salva (decisão Q4: aprovação
 * obrigatória única por campanha).
 *
 * @param {object} [launchers] injeção p/ testes: { outreach, whatsapp }
 */
async function approveAiCampaign(prisma, { orgId, userId, outreachCampaignId, whatsappCampaignId, edits = {} } = {}, launchers = {}) {
  if (!orgId) throw new AiCampaignError('UNAUTHORIZED', 'Organização não identificada.', 401);
  if (!(await isPremiumOrg(prisma, orgId))) {
    throw new AiCampaignError('PREMIUM_REQUIRED', 'A campanha com IA está disponível apenas no plano Premium.', 403);
  }
  if (!outreachCampaignId && !whatsappCampaignId) {
    throw new AiCampaignError('NO_CAMPAIGNS', 'Nenhuma campanha informada para aprovação.', 400);
  }

  // Posse (isolamento por org) + origem IA.
  const emailCampaign = outreachCampaignId
    ? await prisma.outreachCampaign.findFirst({ where: { id: outreachCampaignId, tenantId: orgId, source: 'ai' } })
    : null;
  if (outreachCampaignId && !emailCampaign) {
    throw new AiCampaignError('CAMPAIGN_NOT_FOUND', 'Campanha de email não encontrada.', 404);
  }
  const waCampaign = whatsappCampaignId
    ? await prisma.whatsAppCampaign.findFirst({ where: { id: whatsappCampaignId, orgId, source: 'ai' } })
    : null;
  if (whatsappCampaignId && !waCampaign) {
    throw new AiCampaignError('CAMPAIGN_NOT_FOUND', 'Campanha de WhatsApp não encontrada.', 404);
  }
  if ((emailCampaign && emailCampaign.approvedAt) || (waCampaign && waCampaign.approvedAt)) {
    throw new AiCampaignError('ALREADY_APPROVED', 'Esta campanha já foi aprovada.', 409);
  }
  // Aprovar É um caminho de disparo (FR-008): campanha retida pelo saneamento
  // exige revalidação (rederivar/editar) antes — o BLOCKLIST não detecta eco
  // de texto interno, então a retenção não pode ser ignorada aqui.
  if ((emailCampaign && emailCampaign.needsReview) || (waCampaign && waCampaign.needsReview)) {
    throw new AiCampaignError(
      'CAMPAIGN_REVIEW_REQUIRED',
      'Esta campanha foi retida para revisão do template. Rederive ou edite a mensagem base antes de aprovar.',
      409
    );
  }

  // Edições opcionais da base na UI passam pelo MESMO guard de ingestão.
  const { whatsappMessageTemplate, emailTemplateSubject, emailTemplateBody } = edits || {};
  if (whatsappMessageTemplate !== undefined) {
    const guard = validateTemplateMessage(whatsappMessageTemplate);
    if (!guard.ok) {
      throw new AiCampaignError('TEMPLATE_REJECTED', `Mensagem do WhatsApp rejeitada (${guard.reason}).`, 400);
    }
  }
  for (const [field, value] of [['emailTemplateSubject', emailTemplateSubject], ['emailTemplateBody', emailTemplateBody]]) {
    if (value !== undefined) {
      const guard = validateTemplateMessage(value, { maxLength: 5000 });
      if (!guard.ok) {
        throw new AiCampaignError('TEMPLATE_REJECTED', `Template de email rejeitado (${guard.reason}).`, 400);
      }
    }
  }
  if (waCampaign && whatsappMessageTemplate !== undefined) {
    const step = await prisma.whatsAppSequenceStep.findFirst({
      where: { campaignId: waCampaign.id, orderIndex: 0 },
    });
    if (step) {
      await prisma.whatsAppSequenceStep.update({ where: { id: step.id }, data: { messageTemplate: whatsappMessageTemplate } });
    }
  }
  if (emailCampaign && (emailTemplateSubject !== undefined || emailTemplateBody !== undefined)) {
    await prisma.outreachCampaign.update({
      where: { id: emailCampaign.id },
      data: {
        ...(emailTemplateSubject !== undefined ? { emailTemplateSubject } : {}),
        ...(emailTemplateBody !== undefined ? { emailTemplateBody } : {}),
      },
    });
  }

  // Snapshot de leads na APROVAÇÃO (não na criação).
  const prospects = await prisma.prospect.findMany({
    where: { orgId, status: 'qualified' },
    select: { id: true },
    orderBy: { opportunityScore: 'desc' },
  });
  if (!prospects.length) {
    throw new AiCampaignError('NO_READY_LEADS', 'Nenhum lead em "Prontos para contato" no momento.', 400);
  }
  const prospectIds = prospects.map((p) => p.id);

  // Aprovação registrada ANTES do lançamento (auditoria: aprovado pode ter
  // lançamento parcial; tenant reativa pelo canal afetado).
  const approvedAt = new Date();
  const enrolled = { email: 0, whatsapp: 0 };
  const launchErrors = [];

  const outreachLauncher = launchers.outreach || require('./outreach-workers').startOutreachCampaign;
  const waLauncher = launchers.whatsapp || require('./whatsapp-workers').startCampaign;

  if (emailCampaign) {
    await prisma.outreachCampaign.update({ where: { id: emailCampaign.id }, data: { approvedAt } });
    try {
      const launched = await outreachLauncher(prisma, emailCampaign.id, prospectIds, emailCampaign.emailAccountId, userId || null);
      enrolled.email = launched && Number.isInteger(launched.jobsQueued) ? launched.jobsQueued : prospectIds.length;
    } catch (err) {
      console.error('[ai-campaign] falha ao lançar canal email:', err.message);
      launchErrors.push(`email: ${err.message}`);
      await prisma.outreachCampaign.update({ where: { id: emailCampaign.id }, data: { status: 'paused' } }).catch(() => {});
    }
  }

  if (waCampaign) {
    await prisma.whatsAppCampaign.update({ where: { id: waCampaign.id }, data: { approvedAt } });
    try {
      const launched = await waLauncher(prisma, { campaignId: waCampaign.id, prospectIds, orgId });
      enrolled.whatsapp = launched && Number.isInteger(launched.jobsQueued) ? launched.jobsQueued : prospectIds.length;
    } catch (err) {
      console.error('[ai-campaign] falha ao lançar canal whatsapp:', err.message);
      launchErrors.push(`whatsapp: ${err.message}`);
      await prisma.whatsAppCampaign.update({ where: { id: waCampaign.id }, data: { status: 'PAUSED' } }).catch(() => {});
    }
  }

  console.log(
    `[ai-campaign] org ${orgId}: campanha IA APROVADA e lançada ` +
    `(email=${emailCampaign ? emailCampaign.id : '-'}, wa=${waCampaign ? waCampaign.id : '-'}, ` +
    `erros=${launchErrors.length})`
  );
  const status = launchErrors.length ? 'launched_with_errors' : 'launched';
  metrics.incAiCampaignApproval(status);
  return {
    status,
    approvedAt: approvedAt.toISOString(),
    enrolled,
    launchErrors,
  };
}

// ─── Composição de base por whitelist do perfil comercial (007) ─────────────
// SUBSTITUI buildWhatsAppFallbackTemplate (removida): o corpo da mensagem é
// montado EXCLUSIVAMENTE com campos lead-facing do perfil da org (nome
// comercial e proposta de valor). objective/ctaGoal/offer são INSTRUÇÕES
// internas — nunca entram no texto enviado ao lead (FR-002). O convite final
// é neutro e honesto; a personalização do CTA fica para a IA por lead.
function _capitalize(value) {
  const s = String(value || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function _baseParts(orgCtx) {
  const nome = String((orgCtx && orgCtx.nome) || '').trim();
  if (!nome) return null;
  const valor = String((orgCtx && (orgCtx.propostaValor || orgCtx.oQueE)) || '').trim();
  return { nome, valor };
}

function _truncateSafe(text, maxLen) {
  let out = text.length > maxLen ? text.slice(0, maxLen) : text;
  if (out.length < text.length) {
    const cut = out.lastIndexOf(' ');
    if (cut > 40) out = out.slice(0, cut);
  }
  // Nunca deixar placeholder truncado (vazaria "{{firstNa" ao lead).
  const lastClosed = out.lastIndexOf('}}');
  const dangling = out.indexOf('{{', lastClosed === -1 ? 0 : lastClosed + 2);
  if (dangling !== -1 && !out.slice(dangling).includes('}}')) out = out.slice(0, dangling);
  return out.trim();
}

/**
 * Mensagem base do WhatsApp a partir do perfil comercial da org.
 * `requireConfigured`: quando true, exige perfil configurado (usado no
 * fallback de email — sem insumo do tenant, NADA é enviado). No fluxo IA o
 * padrão é false: a identidade (nome da org) é sempre real, então a base
 * degrada honestamente para saudação + convite neutro.
 * Retorna null quando não há como compor.
 */
function composeBaseFromProfile(orgCtx, { requireConfigured = false } = {}) {
  if (!orgCtx) return null;
  if (requireConfigured && !orgCtx.configured) return null;
  const parts = _baseParts(orgCtx);
  if (!parts) return null;
  const valorSentence = parts.valor
    ? `${_capitalize(parts.valor)}${/[.!?]$/.test(parts.valor) ? '' : '.'} `
    : '';
  const base = _truncateSafe(
    `Olá {{firstName}}, tudo bem? Aqui é o(a) ${parts.nome}. ${valorSentence}Faz sentido conversarmos por alguns minutos?`,
    BASE_MESSAGE_MAX_LEN
  );
  const guard = validateTemplateMessage(base);
  return guard.ok ? base : null;
}

/**
 * Base de EMAIL (subject + body em texto plano) a partir do perfil comercial.
 * Mesmas regras da composeBaseFromProfile; placeholders {{firstName}} são
 * resolvidos pelo renderTemplate no prepare. Retorna null quando não há como
 * compor (sem perfil configurado no modo estrito ou sem nome de org).
 */
function composeEmailBaseFromProfile(orgCtx, { requireConfigured = false } = {}) {
  if (!orgCtx) return null;
  if (requireConfigured && !orgCtx.configured) return null;
  const parts = _baseParts(orgCtx);
  if (!parts) return null;
  const valorPara = parts.valor
    ? ` ${_capitalize(parts.valor)}${/[.!?]$/.test(parts.valor) ? '' : '.'}`
    : '';
  const subject = _truncateSafe(
    parts.valor ? _capitalize(parts.valor) : `Contato de ${parts.nome}`,
    78
  );
  const body = [
    'Olá {{firstName}}, tudo bem?',
    '',
    `Aqui é o(a) ${parts.nome}.${valorPara}`,
    '',
    'Faz sentido conversarmos por alguns minutos?',
    '',
    `Equipe ${parts.nome}`,
  ].join('\n');
  const guard = validateTemplateMessage(body, { maxLength: 5000 });
  if (!guard.ok) return null;
  const subjectGuard = validateTemplateMessage(subject, { maxLength: 78 });
  return subjectGuard.ok ? { subject, body } : null;
}

// ─── Saneamento de campanhas legadas (FR-008, US4) ─────────────────────────

// Marcadores de texto INTERNO que jamais devem constar numa mensagem ao lead
// (a linha 101 do prompt de estratégia era a fonte do eco no incidente).
const INTERNAL_LEAK_MARKERS = [
  'pre-qualificados por enriquecimento de cnpj',
  'leads prontos para contato',
  'pre-qualificados',
  'enriquecimento de cnpj',
  'decisores dos',
];

function _normalizeForLeak(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta template sintetizado com conteúdo interno (ex.: objective/ctaGoal
 * ecoados no corpo). Conservador: marcadores explícitos OU eco textual do
 * objetivo da campanha (normalizado, ≥ 30 chars). Nulo = template limpo.
 */
function detectSyntheticTemplate(template, campaign) {
  const normalized = _normalizeForLeak(template);
  if (!normalized) return null;
  for (const marker of INTERNAL_LEAK_MARKERS) {
    if (normalized.includes(marker)) return 'synthetic_template_leak';
  }
  const objective = _normalizeForLeak(campaign && campaign.objective);
  if (objective && objective.length >= 30 && normalized.includes(objective)) {
    return 'synthetic_template_leak';
  }
  return null;
}

/**
 * Varredura idempotente das campanhas IA legadas: template com texto interno
 * → `needsReview` + retenção (PAUSED). Campanhas manuais/[auto] NUNCA são
 * alteradas (zero falso positivo). Não corrige nada silenciosamente (Q2): a
 * revalidação é sempre ação do tenant (rederivar ou editar).
 */
async function sanitizeLegacyCampaigns(prisma) {
  const stats = { scanned: 0, retained: 0 };

  const waCampaigns = await prisma.whatsAppCampaign.findMany({ where: { source: 'ai' }, include: { steps: true } });
  for (const campaign of waCampaigns) {
    stats.scanned += 1;
    if (campaign.needsReview) continue; // idempotência
    const polluted = (campaign.steps || []).some((step) => detectSyntheticTemplate(step.messageTemplate, campaign));
    if (!polluted) continue;
    const data = { needsReview: true, reviewReason: 'synthetic_template_leak' };
    if (campaign.status === 'RUNNING' || campaign.status === 'SCHEDULED') {
      data.status = 'PAUSED';
      data.pausedAt = new Date();
    }
    await prisma.whatsAppCampaign.update({ where: { id: campaign.id }, data });
    metrics.incCampaignReview('detected');
    stats.retained += 1;
    console.warn(`[sanitize-legacy] campanha WA ${campaign.id} (org ${campaign.orgId}) retida: template com texto interno`);
  }

  const emailCampaigns = await prisma.outreachCampaign.findMany({ where: { source: 'ai' } });
  for (const campaign of emailCampaigns) {
    stats.scanned += 1;
    if (campaign.needsReview) continue;
    const haystack = [campaign.emailTemplateSubject, campaign.emailTemplateBody].filter(Boolean).join('\n');
    if (!detectSyntheticTemplate(haystack, campaign)) continue;
    const data = { needsReview: true, reviewReason: 'synthetic_template_leak' };
    if (campaign.status === 'active') data.status = 'paused';
    await prisma.outreachCampaign.update({ where: { id: campaign.id }, data });
    metrics.incCampaignReview('detected');
    stats.retained += 1;
    console.warn(`[sanitize-legacy] campanha email ${campaign.id} (org ${campaign.tenantId}) retida: template com texto interno`);
  }

  return stats;
}

// ─── Rederivação da mensagem base (atalho de revalidação — Q2/FR-008) ──────

/**
 * Regenera a mensagem base do WhatsApp a partir do perfil comercial e limpa
 * a retenção. NÃO reativa a campanha — reativação é sempre ação explícita.
 */
async function rederiveWhatsAppBase(prisma, { orgId, campaignId } = {}) {
  if (!orgId) throw new AiCampaignError('UNAUTHORIZED', 'Organização não identificada.', 401);
  const campaign = await prisma.whatsAppCampaign.findFirst({ where: { id: campaignId, orgId } });
  if (!campaign) throw new AiCampaignError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.', 404);
  const orgCtx = await orgContext.loadOrgContext(prisma, orgId);
  const base = composeBaseFromProfile(orgCtx, { requireConfigured: true });
  if (!base) {
    throw new AiCampaignError('NO_PROFILE_CONTEXT', 'Complete o perfil comercial da organização antes de rederivar a mensagem.', 409);
  }
  const step = await prisma.whatsAppSequenceStep.findFirst({ where: { campaignId: campaign.id, orderIndex: 0 } });
  if (!step) throw new AiCampaignError('CAMPAIGN_NOT_FOUND', 'Campanha sem etapas de sequência.', 404);
  await prisma.whatsAppSequenceStep.update({ where: { id: step.id }, data: { messageTemplate: base } });
  await prisma.whatsAppCampaign.update({ where: { id: campaign.id }, data: { needsReview: false, reviewReason: null } });
  console.log(`[ai-campaign] org ${orgId}: base do WhatsApp rederivada na campanha ${campaign.id}`);
  return { id: campaign.id, needsReview: false, messageTemplate: base, status: campaign.status };
}

/**
 * Regenera o template de email (subject + body) a partir do perfil comercial.
 * Mesmas regras da rederivação do WhatsApp.
 */
async function rederiveEmailBase(prisma, { orgId, campaignId } = {}) {
  if (!orgId) throw new AiCampaignError('UNAUTHORIZED', 'Organização não identificada.', 401);
  const campaign = await prisma.outreachCampaign.findFirst({ where: { id: campaignId, tenantId: orgId } });
  if (!campaign) throw new AiCampaignError('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.', 404);
  const orgCtx = await orgContext.loadOrgContext(prisma, orgId);
  const base = composeEmailBaseFromProfile(orgCtx, { requireConfigured: true });
  if (!base) {
    throw new AiCampaignError('NO_PROFILE_CONTEXT', 'Complete o perfil comercial da organização antes de rederivar o template.', 409);
  }
  await prisma.outreachCampaign.update({
    where: { id: campaign.id },
    data: {
      emailTemplateSubject: base.subject,
      emailTemplateBody: base.body,
      needsReview: false,
      reviewReason: null,
    },
  });
  console.log(`[ai-campaign] org ${orgId}: template de email rederivado na campanha ${campaign.id}`);
  return { id: campaign.id, needsReview: false, subject: base.subject, body: base.body, status: campaign.status };
}

module.exports = {
  AiCampaignError,
  isPremiumOrg,
  detectChannels,
  generateCampaignStrategy,
  createAndLaunchAiCampaign,
  approveAiCampaign,
  composeBaseFromProfile,
  composeEmailBaseFromProfile,
  detectSyntheticTemplate,
  sanitizeLegacyCampaigns,
  rederiveWhatsAppBase,
  rederiveEmailBase,
};
