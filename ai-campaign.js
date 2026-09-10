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

const AI_CAMPAIGN_DAILY_LIMIT = Number(process.env.AI_CAMPAIGN_DAILY_LIMIT || 3);

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
      opportunityScore: true,
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
  const prospectIds = prospects.map((p) => p.id);
  const leadSamples = prospects.slice(0, 10);

  // 5. Estratégia (IA, com fallback determinístico).
  const strategy = await generateCampaignStrategy({ orgCtx, channels, leadCount: prospects.length, leadSamples });

  // 6. Cria as campanhas (salvas sempre — requisito "IA cria, salva").
  const result = {
    emailCampaignId: null,
    whatsappCampaignId: null,
    channels,
    leadCount: prospects.length,
    enrolled: { email: 0, whatsapp: 0 },
    contextConfigured: Boolean(orgCtx.configured),
    strategy,
    launchErrors: [],
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
        // SEM emailTemplateSubject/Body de propósito: processPrepare gera
        // mensagem ÚNICA por lead com IA (requisito da feature).
      },
    });
    result.emailCampaignId = emailCampaign.id;
  }

  let waCampaign = null;
  if (channels.includes('whatsapp')) {
    const fallbackTemplate = buildWhatsAppFallbackTemplate(orgCtx, strategy);
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
        steps: {
          create: {
            orderIndex: 0,
            messageTemplate: fallbackTemplate,
            aiPersonalized: true, // mensagem única por lead; template acima é o fallback
            delayMinutes: 0,
          },
        },
      },
    });
    result.whatsappCampaignId = waCampaign.id;
  }

  // 7. Lança (snapshot: leads qualificados agora). startOutreachCampaign e
  //    startCampaign já filtram leads já contactados, opt-outs e sem telefone.
  const { startOutreachCampaign } = require('./outreach-workers');
  const whatsappWorkers = require('./whatsapp-workers');

  if (emailCampaign) {
    try {
      const launched = await startOutreachCampaign(
        prisma, emailCampaign.id, prospectIds, emailAccount.id, userId || null
      );
      result.enrolled.email = launched && Number.isInteger(launched.jobsQueued)
        ? launched.jobsQueued
        : prospects.length;
    } catch (err) {
      console.error('[ai-campaign] falha ao lançar canal email:', err.message);
      result.launchErrors.push(`email: ${err.message}`);
      await prisma.outreachCampaign.update({
        where: { id: emailCampaign.id },
        data: { status: 'paused' },
      }).catch(() => {});
    }
  }

  if (waCampaign) {
    try {
      const launched = await whatsappWorkers.startCampaign(prisma, {
        campaignId: waCampaign.id,
        prospectIds,
        orgId,
      });
      result.enrolled.whatsapp = launched && Number.isInteger(launched.jobsQueued)
        ? launched.jobsQueued
        : prospects.length;
    } catch (err) {
      console.error('[ai-campaign] falha ao lançar canal whatsapp:', err.message);
      result.launchErrors.push(`whatsapp: ${err.message}`);
      await prisma.whatsAppCampaign.update({
        where: { id: waCampaign.id },
        data: { status: 'PAUSED' },
      }).catch(() => {});
    }
  }

  console.log(
    `[ai-campaign] org ${orgId}: campanha IA criada e lançada ` +
    `(canais=${channels.join('+')}, leads=${prospects.length}, ` +
    `email=${result.emailCampaignId || '-'}, wa=${result.whatsappCampaignId || '-'})`
  );
  return result;
}

/**
 * Template WhatsApp de FALLBACK (usado só quando a geração por lead falha).
 * Identidade da org em texto fixo + placeholders suportados por renderTemplate.
 */
function buildWhatsAppFallbackTemplate(orgCtx, strategy) {
  const nome = (orgCtx && orgCtx.nome) || 'nossa empresa';
  const valor = (orgCtx && (orgCtx.propostaValor || orgCtx.oQueE)) || null;
  const pergunta = (orgCtx && orgCtx.ctaGoal) || (strategy && strategy.objective) || 'posso te mostrar como funciona em uma conversa rápida?';
  const perg = pergunta.endsWith('?') ? pergunta : `${pergunta}?`;
  // Valor entra como frase própria (valueProposition costuma vir como
  // sentença imperativa — "Troque o contador..."), não como complemento.
  const meio = valor ? `${valor.charAt(0).toUpperCase()}${valor.slice(1)}. ` : '';
  return `Olá {{firstName}}, tudo bem? Sou da ${nome}. ${meio}${perg}`.slice(0, 400);
}

module.exports = {
  AiCampaignError,
  isPremiumOrg,
  detectChannels,
  generateCampaignStrategy,
  createAndLaunchAiCampaign,
};
