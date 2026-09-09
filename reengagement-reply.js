/**
 * reengagement-reply.js — resposta rápida do agente quando o LEAD RESPONDE.
 *
 * O reengajamento (reengagement-agent.js) manda a mensagem; quando o lead
 * responde, ESTE módulo continua a conversa em segundos (em vez de esperar um
 * humano entrar no inbox): responde as dúvidas de forma natural e conduz o
 * lead ao objetivo da org/campanha de origem (contexto de CADA cliente —
 * ver org-context.js; a IA fala do negócio da org, nunca do "produto B2Base").
 *
 * Disparo: whatsapp-engine.handleMessageEvent enfileira whatsapp:reengage-reply
 * (jobId determinístico = idempotência contra reentregas do webhook/NATS).
 *
 * Pipeline do processador:
 *   → guarda dura (re-leitura do estado no banco: opt-out, pause, DNC, tetos)
 *   → só conversa conduzida pelo agente (última outbound = REENGAGEMENT/AI_REPLY;
 *     e, se REENGAGE_REPLY_INCLUDE_CAMPAIGN=true, também CAMPAIGN. Se um humano
 *     respondeu por último, a conversa é dele — não entramos)
 *   → context assembly (empresa da org + campanha de origem + lead + histórico)
 *     → 1 chamada LiteLLM
 *   → Policy Guard (blocklist, tamanho, dedupe) → fila whatsapp:send
 *
 * Modos (REENGAGE_REPLY_MODE): auto (envia) | shadow (só registra). O modo
 * suggest NÃO se aplica: resposta instantânea não espera aprovação humana.
 *
 * Config por env (Infisical/k8s):
 *   REENGAGE_REPLY_ENABLED              — "false" força off; default segue REENGAGE_ENABLED
 *   REENGAGE_REPLY_MODE                 — auto | shadow (default = REENGAGE_MODE se auto, senão shadow)
 *   REENGAGE_REPLY_INCLUDE_CAMPAIGN     — "true" também responde leads que reagem a CAMPAIGN
 *   REENGAGE_REPLY_MAX_PER_CONVERSATION — teto de respostas de IA por conversa (default 8)
 *   REENGAGE_REPLY_DAILY_CAP            — teto global de respostas de IA/dia (default 60)
 *   REENGAGE_REPLY_MIN_DELAY_SEC        — atraso mínimo "humano" antes de responder (default 5)
 *   REENGAGE_REPLY_JITTER_SEC           — jitter somado ao atraso (default 10)
 *   REENGAGE_LLM_MODEL                  — modelo no gateway LiteLLM (compartilhado com o agente)
 */
const { PrismaClient } = require('@prisma/client');
const { registerProcessor } = require('./outreach-queues');
const { getWhatsAppQueues } = require('./whatsapp-queues');
const { BLOCKLIST, normalizeForCompare } = require('./whatsapp-utils');
const orgContext = require('./org-context');

const QUEUES = Object.freeze({
  REENGAGE_REPLY: 'whatsapp:reengage-reply',
});

// Fontes de outbound que caracterizam uma conversa conduzida por automação.
// CAMPAIGN entra só com REENGAGE_REPLY_INCLUDE_CAMPAIGN=true (mensagens de
// sequência de campanha: o lead respondeu ao disparo → a IA continua usando a
// proposta da campanha). MANUAL (humano) NUNCA vira conversa do agente.
const AGENT_SOURCES = Object.freeze(['REENGAGEMENT', 'AI_REPLY']);
const CAMPAIGN_SOURCE = 'CAMPAIGN';

function agentSources() {
  return CONFIG.includeCampaign ? [...AGENT_SOURCES, CAMPAIGN_SOURCE] : AGENT_SOURCES;
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveEnabled() {
  if (process.env.REENGAGE_REPLY_ENABLED === 'false') return false;
  if (process.env.REENGAGE_REPLY_ENABLED === 'true') return true;
  return process.env.REENGAGE_ENABLED === 'true';
}

function resolveMode() {
  const explicit = process.env.REENGAGE_REPLY_MODE;
  if (explicit === 'auto') return 'auto';
  // Suggest não se aplica a resposta instantânea; qualquer outro valor = shadow.
  if (!explicit && process.env.REENGAGE_MODE === 'auto') return 'auto';
  return 'shadow';
}

const CONFIG = Object.freeze({
  enabled: resolveEnabled(),
  mode: resolveMode(),
  includeCampaign: process.env.REENGAGE_REPLY_INCLUDE_CAMPAIGN === 'true',
  maxRepliesPerConversation: envInt('REENGAGE_REPLY_MAX_PER_CONVERSATION', 8),
  dailyCap: envInt('REENGAGE_REPLY_DAILY_CAP', 60),
  minDelaySec: envInt('REENGAGE_REPLY_MIN_DELAY_SEC', 5),
  jitterSec: envInt('REENGAGE_REPLY_JITTER_SEC', 10),
  llmModel: process.env.REENGAGE_LLM_MODEL || process.env.LITELLM_MODEL || 'qwen/qwen2.5-7b-instruct',
});

let _prisma = null;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

const log = (...args) => console.log('[reengage-reply]', ...args);

const EVENT_STATUS = Object.freeze({
  GENERATED: 'GENERATED',
  SENT: 'SENT',
  REFUSED_IA: 'REFUSED_IA',
  BLOCKED_GUARD: 'BLOCKED_GUARD',
  FAILED: 'FAILED',
});
const REPLY_STRATEGY = 'CONTINUAR_CONVERSA';
const MAX_LEN = 600;

// ─── Enfileiramento (chamado pelo whatsapp-engine no inbound) ────────────────

/**
 * Enfileira a resposta, se a funcionalidade estiver ligada. Leve de propósito:
 * as guardas duras (estado atual do banco) rodam no processador, já que entre o
 * webhook e a execução o lead/humano pode mudar o estado da conversa.
 */
async function enqueueReply(prisma, { conversationId, inboundMessageId }) {
  if (!CONFIG.enabled || !inboundMessageId) return null;
  const delayMs = (CONFIG.minDelaySec + Math.floor(Math.random() * CONFIG.jitterSec)) * 1000;
  await getWhatsAppQueues().reengageReply.add(
    { conversationId, inboundMessageId },
    {
      // jobId determinístico: reentrega do webhook/NATS não duplica a resposta.
      jobId: `reengage-reply:${inboundMessageId}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 15000 },
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
  return { queued: true, delayMs };
}

// ─── Guarda dura (re-leitura do estado) ──────────────────────────────────────

/**
 * A conversa só é respondida pelo agente se for conduzida por ele: a última
 * OUTBOUND tem de ser REENGAGEMENT/AI_REPLY e a última mensagem (aguardando
 * resposta) tem de ser a INBOUND do lead. Se um humano respondeu por último,
 * a conversa é do operador — o agente não entra.
 */
async function replyGuard(prisma, { conversation, inboundMessage }) {
  if (!inboundMessage || inboundMessage.direction !== 'INBOUND' || !inboundMessage.content) {
    return { allowed: false, reason: 'no_inbound_text' };
  }
  if (conversation.automationPausedAt) return { allowed: false, reason: 'paused' };
  if (['OPTED_OUT', 'PAUSED'].includes(conversation.status)) {
    return { allowed: false, reason: `conversation_${conversation.status}` };
  }
  if (conversation.prospectId) {
    const state = await prisma.leadChannelState.findUnique({
      where: { prospectId_channel: { prospectId: conversation.prospectId, channel: 'whatsapp' } },
    });
    if (state && state.status !== 'active') return { allowed: false, reason: 'do_not_contact' };
  }

  const last = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!last || last.direction !== 'INBOUND') {
    // Alguém (humano ou envio atrasado) já respondeu depois do lead: aborta.
    return { allowed: false, reason: 'already_answered' };
  }

  const lastOutbound = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conversation.id, direction: 'OUTBOUND' },
    orderBy: { createdAt: 'desc' },
  });
  if (!lastOutbound || !agentSources().includes(lastOutbound.source)) {
    return { allowed: false, reason: 'not_agent_conversation' };
  }

  // Conversa de campanha: carrega a proposta da campanha de origem (pilar 2)
  // para o prompt responder no contexto do que foi ofertado ao lead.
  let originCampaign = null;
  if (lastOutbound.source === CAMPAIGN_SOURCE && lastOutbound.campaignContactId) {
    const campaignContact = await prisma.whatsAppCampaignContact.findUnique({
      where: { id: lastOutbound.campaignContactId },
      select: { campaign: { select: { id: true, name: true, objective: true, offer: true, ctaUrl: true } } },
    });
    originCampaign = campaignContact ? campaignContact.campaign : null;
  }

  const aiReplies = await prisma.whatsAppMessage.count({
    where: { conversationId: conversation.id, source: 'AI_REPLY' },
  });
  if (aiReplies >= CONFIG.maxRepliesPerConversation) {
    return { allowed: false, reason: 'max_replies_per_conversation' };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await prisma.whatsAppMessage.count({
    where: { source: 'AI_REPLY', direction: 'OUTBOUND', createdAt: { gte: startOfDay } },
  });
  if (sentToday >= CONFIG.dailyCap) {
    return { allowed: false, reason: 'daily_cap_reached' };
  }

  return { allowed: true, lastMessage: last, lastOutbound, campaign: originCampaign };
}

// ─── Context assembly ────────────────────────────────────────────────────────

function contactName(prospect) {
  const partners = Array.isArray(prospect.cnpjPartners) ? prospect.cnpjPartners : [];
  const raw = (partners[0] && partners[0].name) || prospect.tradeName || prospect.companyName || '';
  if (!raw) return null;
  const first = String(raw).trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function renderTranscript(messages, lastInboundId) {
  return messages
    .map((m) => {
      const who = m.direction === 'INBOUND' ? 'LEAD' : 'NÓS';
      const marker = m.id === lastInboundId ? ' ← RESPONDA A ESTA' : '';
      return `${who} (${m.createdAt.toISOString().slice(0, 16)}Z): ${m.content || `[${m.type}]`}${marker}`;
    })
    .join('\n');
}

function buildReplyPrompt({ prospect, orgCtx, campaign, messages, lastInboundId }) {
  const contact = prospect ? contactName(prospect) : null;
  const location = prospect ? [prospect.city, prospect.state].filter(Boolean).join('/') : '';
  const partners = prospect && Array.isArray(prospect.cnpjPartners) ? prospect.cnpjPartners : [];

  const leadBlock = prospect
    ? [
        '== LEAD ==',
        `Contato: ${contact || 'desconhecido'}`,
        `Empresa: ${prospect.companyName}${prospect.tradeName ? ` (${prospect.tradeName})` : ''}`,
        `Segmento: ${prospect.industry || 'N/A'}`,
        `Cidade/UF: ${location || 'N/A'}`,
        partners.length ? `Sócios: ${partners.map((p) => p.name).filter(Boolean).join(', ')}` : '',
      ]
    : [
        '== LEAD ==',
        'Dados da empresa DESCONHECIDOS (chat sem cadastro vinculado).',
        'NÃO invente nem use nome do contato, empresa ou segmento — baseie-se apenas no histórico abaixo.',
      ];

  const campaignBlock = orgContext.renderCampaignBlock(campaign);
  const cta = orgContext.effectiveCtaText(orgCtx, campaign);

  return [
    `Você é um vendedor da ${orgContext.sellerIdentity(orgCtx)} respondendo um lead no WhatsApp.`,
    'O lead ACABOU de mandar uma mensagem. Responda de forma natural e humana e conduza',
    'a conversa para o objetivo abaixo.',
    '',
    '== OBJETIVO (SEMPRE) ==',
    cta,
    '',
    '== CONTEXTO DA NOSSA EMPRESA ==',
    orgCtx.renderForPrompt(),
    '',
    ...(campaignBlock ? [campaignBlock, ''] : []),
    ...leadBlock,
    '',
    '== HISTÓRICO DA CONVERSA (mais antiga → mais recente) ==',
    renderTranscript(messages, lastInboundId),
    '',
    '== ESTILO — CRÍTICO, NÃO PODE PARECER ROBÔ ==',
    '- Português do Brasil informal de WhatsApp, como um vendedor de verdade: "vc", "pra", "tá".',
    '- CURTO: 1 a 3 frases, no máximo 400 caracteres. Nada de listas, markdown ou tom de e-mail.',
    '- Responda PRIMEIRO o que o lead perguntou; o convite/objetivo vem depois, encaixado naturalmente.',
    '- Não se apresente como "assistente virtual" ou "IA". Sem "Prezado", sem saudação longa, no máximo 1 emoji.',
    '- No máximo UMA pergunta.',
    '',
    '== RESTRIÇÕES ==',
    '- Use SOMENTE o contexto da empresa, da campanha e o histórico acima. NUNCA invente preços, planos, descontos, prazos, garantias, integrações, resultados ou links.',
    '- Se perguntarem algo fora do contexto (ex.: preço exato), seja leve e honesto ("essa parte eu confirmo certinho pra vc") e conduza para o objetivo.',
    '- Se a mensagem não pede resposta de verdade (ex.: só "ok", "👍"), pode curtir o retorno e reforçar o convite — ou recusar (should_send=false) se for claramente desnecessário.',
    '',
    'Responda SOMENTE com JSON válido:',
    '{ "should_send": true, "message": "texto da resposta", "reason": "1 frase" }',
  ].filter((l) => l !== undefined).join('\n');
}

async function callLlm(prompt) {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  try {
    const res = await fetch(`${litellmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LITELLM_API_KEY ? { Authorization: `Bearer ${process.env.LITELLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: CONFIG.llmModel,
        messages: [
          { role: 'system', content: 'Você é um vendedor brasileiro respondendo clientes no WhatsApp. Responda APENAS com JSON válido.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`LiteLLM HTTP ${res.status}`);
    const json = await res.json();
    const content = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
    return JSON.parse(content);
  } catch (err) {
    log(`LLM indisponível: ${err.message}`);
    return null;
  }
}

// ─── Guard de conteúdo + fallback ────────────────────────────────────────────

async function replyContentGuard(prisma, conversation, messageText) {
  const content = String(messageText || '').trim();
  if (!content) return { pass: false, reason: 'empty' };
  if (content.length > MAX_LEN) return { pass: false, reason: 'too_long' };
  if (BLOCKLIST.test(content)) return { pass: false, reason: 'blocked_claim' };

  // Não repete a última mensagem automatizada desta conversa (o lead percebe
  // quando o robô manda o mesmo texto duas vezes).
  const previous = await prisma.whatsAppMessage.findMany({
    where: { conversationId: conversation.id, source: { in: agentSources() } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { content: true },
  });
  const normalized = normalizeForCompare(content);
  if (previous.some((p) => normalizeForCompare(p.content) === normalized)) {
    return { pass: false, reason: 'duplicate_content' };
  }
  return { pass: true, content };
}

/**
 * Fallback pré-aprovado (LLM caiu/JSON inválido/mensagem vetada): sempre
 * conduz ao objetivo da org (site) sem prometer nada fora do contexto.
 */
function fallbackReply(prospect, variant = 0, orgCtx = null) {
  const site = orgCtx && orgCtx.site;
  const templates = site
    ? [
        `Consigo te explicar por aqui mesmo! O caminho mais rápido é acessar ${site} — é rapidinho e você já consegue adiantar hoje. Qualquer dúvida me chama aqui 👍`,
        `Boa! Dá uma olhada em ${site} — leva pouco tempo e já te adianta. Aí a gente conversa do que fizer sentido pra vc 😉`,
      ]
    : [
        'Consigo te explicar por aqui mesmo! Me conta o que você precisa que eu te oriento no próximo passo 👍',
        'Boa! Quer que eu te explique como funciona na prática? Me diz o seu cenário que eu já te adianto 😉',
      ];
  const contact = prospect ? contactName(prospect) : null;
  const base = templates[Math.abs(variant) % templates.length];
  return contact ? `${contact}, ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
}

// ─── Processador: whatsapp:reengage-reply ────────────────────────────────────

async function recordEvent(prisma, { conversation, reason, content, origin, status, sentMessageId, campaign, orgConfigured }) {
  return prisma.whatsAppReengagementEvent.create({
    data: {
      orgId: conversation.orgId,
      conversationId: conversation.id,
      prospectId: conversation.prospectId || null,
      attempt: 0, // 0 = resposta a inbound (não é tentativa de reengajamento frio)
      strategy: REPLY_STRATEGY,
      reason: reason || null,
      content: content || null,
      origin: origin || null,
      mode: CONFIG.mode,
      status,
      sentMessageId: sentMessageId || null,
      context: {
        orgId: conversation.orgId,
        orgConfigured: Boolean(orgConfigured),
        campaignId: (campaign && campaign.id) || null,
        campaignName: (campaign && campaign.name) || null,
        includeCampaign: CONFIG.includeCampaign,
      },
    },
  });
}

async function processReengageReply(job) {
  if (!CONFIG.enabled) return { disabled: true };
  const { conversationId, inboundMessageId } = job.data;
  const prisma = getPrisma();

  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return { skipped: 'conversation_not_found' };

  const inboundMessage = await prisma.whatsAppMessage.findUnique({ where: { id: inboundMessageId } });
  const guard = await replyGuard(prisma, { conversation, inboundMessage });
  if (!guard.allowed) return { skipped: guard.reason };

  const prospect = conversation.prospectId
    ? await prisma.prospect.findUnique({ where: { id: conversation.prospectId } })
    : null;
  const orgCtx = await orgContext.loadOrgContext(prisma, conversation.orgId);

  const history = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  history.reverse();

  const prompt = buildReplyPrompt({
    prospect,
    orgCtx,
    campaign: guard.campaign,
    messages: history,
    lastInboundId: guard.lastMessage.id,
  });
  const decision = await callLlm(prompt);

  let messageText = null;
  let origin = 'fallback';
  let reason = null;
  let refusedByAi = false;
  let blockedAiMessage = null;

  if (decision && decision.should_send === false) {
    refusedByAi = true;
    reason = decision.reason || 'ia_refused';
  } else if (decision && decision.message) {
    const guardResult = await replyContentGuard(prisma, conversation, decision.message);
    if (guardResult.pass) {
      messageText = guardResult.content;
      origin = 'ai';
      reason = decision.reason || null;
    } else {
      blockedAiMessage = String(decision.message);
      reason = `guard_${guardResult.reason}`;
    }
  } else {
    reason = 'llm_unavailable';
  }

  if (!messageText && !refusedByAi) {
    messageText = fallbackReply(prospect, history.length, orgCtx);
    origin = 'fallback';
  }

  if (refusedByAi) {
    await recordEvent(prisma, { conversation, reason, origin: 'ai', status: EVENT_STATUS.REFUSED_IA, campaign: guard.campaign, orgConfigured: orgCtx.configured });
    log(`decisão: NÃO responder ${conversationId} (${reason})`);
    return { decided: false, reason };
  }

  if (blockedAiMessage) {
    await recordEvent(prisma, { conversation, reason, content: blockedAiMessage, origin: 'ai', status: EVENT_STATUS.BLOCKED_GUARD, campaign: guard.campaign, orgConfigured: orgCtx.configured });
  }

  // Final check de concorrência: um operador pode ter respondido pelo inbox
  // enquanto a IA gerava (ou o lead mandou outra mensagem). Só respondemos se
  // a bola ainda está com a gente (última mensagem = INBOUND).
  const last = await prisma.whatsAppMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
  });
  if (!last || last.direction !== 'INBOUND') {
    return { skipped: 'already_answered_during_generation' };
  }

  const message = await prisma.whatsAppMessage.create({
    data: {
      conversationId,
      orgId: conversation.orgId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: messageText,
      status: 'PENDING',
      source: 'AI_REPLY',
    },
  });

  await getWhatsAppQueues().send.add(
    { messageId: message.id },
    { attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
  );

  await recordEvent(prisma, { conversation, reason, content: messageText, origin, status: EVENT_STATUS.SENT, sentMessageId: message.id, campaign: guard.campaign, orgConfigured: orgCtx.configured });
  log(`respondido (origem=${origin}${guard.campaign ? ', campanha' : ''}) para ${prospect ? prospect.companyName : '(sem cadastro)'}: ${messageText.slice(0, 80)}...`);
  return { sent: true, messageId: message.id, origin };
}

// ─── Registro/boot ───────────────────────────────────────────────────────────

async function startReengagementReply() {
  if (!CONFIG.enabled) {
    log('desabilitado (REENGAGE_REPLY_ENABLED=false ou REENGAGE_ENABLED != true)');
    return { enabled: false };
  }
  registerProcessor(QUEUES.REENGAGE_REPLY, processReengageReply, 1);
  log(`✓ ativo (mode=${CONFIG.mode}, max/conversa=${CONFIG.maxRepliesPerConversation}, cap diário=${CONFIG.dailyCap}, delay=${CONFIG.minDelaySec}+${CONFIG.jitterSec}s, responde campanha=${CONFIG.includeCampaign ? 'sim' : 'não'})`);
  return { enabled: true, mode: CONFIG.mode };
}

module.exports = {
  CONFIG,
  AGENT_SOURCES,
  CAMPAIGN_SOURCE,
  agentSources,
  processReengageReply,
  enqueueReply,
  replyGuard,
  buildReplyPrompt,
  fallbackReply,
  startReengagementReply,
};
