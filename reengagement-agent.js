/**
 * reengagement-agent.js — agente de reengajamento de conversas WhatsApp.
 *
 * Reativa conversas com leads que ENGAJARAM (≥1 resposta inbound) e esfriaram:
 * a última mensagem é nossa e ficou sem resposta por ≥ REENGAGE_COOLDOWN_HOURS.
 *
 * Pipeline (tudo neste processo, filas Bull no Redis compartilhado):
 *   whatsapp:reengage-scan (repeatable, 15min)
 *     → query determinística de candidatos (sem LLM)
 *     → enfileira whatsapp:reengage (jobId determinístico = idempotência)
 *   whatsapp:reengage
 *     → guarda dura (re-leitura do estado no banco)
 *     → context assembly (B2Base + org + lead + histórico + exemplos MCP)
 *     → 1 chamada LiteLLM com JSON estrito (decisão + mensagem)
 *     → Policy Guard determinístico (veto duro)
 *     → shadow: só loga | auto: cria WhatsAppMessage source=REENGAGEMENT
 *       → fila whatsapp:send existente (WAHA, acks, JID, rate limit)
 *
 * Config por env (Infisical/k8s):
 *   REENGAGE_ENABLED          — liga o agente (default false)
 *   REENGAGE_MODE             — shadow | auto (default shadow: nunca envia)
 *   REENGAGE_MAX_ATTEMPTS     — tentativas por ciclo (default 3)
 *   REENGAGE_MAX_TOTAL        — teto vitalício por conversa (default 6)
 *   REENGAGE_COOLDOWN_HOURS   — silêncio mínimo p/ considerar fria (default 48)
 *   REENGAGE_MIN_GAP_HOURS    — intervalo mínimo entre avaliações/envios (default 24)
 *   REENGAGE_DAILY_CAP        — máx. de mensagens de reengajamento/dia (default 12)
 *   REENGAGE_SCAN_INTERVAL_MIN— período do scan (default 15)
 *   REENGAGE_LLM_MODEL        — modelo no gateway LiteLLM (default = LITELLM_MODEL)
 *   REENGAGE_MCP_EXAMPLES     — "false" desativa exemplos do CNPJ MCP
 */
const { PrismaClient } = require('@prisma/client');
const { registerProcessor } = require('./outreach-queues');
const { getWhatsAppQueues } = require('./whatsapp-queues');
const { isContactable } = require('./whatsapp-engine');
const b2baseContext = require('./b2base-context');
const mcpCnpj = require('./mcp-cnpj');

const QUEUES = Object.freeze({
  REENGAGE_SCAN: 'whatsapp:reengage-scan',
  REENGAGE: 'whatsapp:reengage',
});

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const CONFIG = Object.freeze({
  enabled: process.env.REENGAGE_ENABLED === 'true',
  mode: process.env.REENGAGE_MODE === 'auto' ? 'auto' : 'shadow',
  maxAttempts: envInt('REENGAGE_MAX_ATTEMPTS', 3),
  maxTotal: envInt('REENGAGE_MAX_TOTAL', 6),
  cooldownHours: envInt('REENGAGE_COOLDOWN_HOURS', 48),
  minGapHours: envInt('REENGAGE_MIN_GAP_HOURS', 24),
  dailyCap: envInt('REENGAGE_DAILY_CAP', 12),
  scanIntervalMin: envInt('REENGAGE_SCAN_INTERVAL_MIN', 15),
  batchSize: 10,
  llmModel: process.env.REENGAGE_LLM_MODEL || process.env.LITELLM_MODEL || 'qwen/qwen2.5-7b-instruct',
  mcpExamples: process.env.REENGAGE_MCP_EXAMPLES !== 'false',
});

let _prisma = null;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

const log = (...args) => console.log('[reengage]', ...args);

// ─── Detecção determinística de candidatos ───────────────────────────────────

/**
 * Candidatos = conversas com engajamento passado (≥1 inbound), última mensagem
 * OUTBOUND sem resposta, frias por ≥ cooldown, dentro dos tetos e sem DNC.
 * Retorna apenas o que cabe no cap diário restante.
 *
 * Os cutoffs são calculados em JS (Date) e passados como parâmetros — evita
 * aritmética de interval com placeholder no Postgres.
 */
async function findCandidates(prisma, limit) {
  const cooldownCutoff = new Date(Date.now() - CONFIG.cooldownHours * 60 * 60 * 1000);
  const gapCutoff = new Date(Date.now() - CONFIG.minGapHours * 60 * 60 * 1000);
  return prisma.$queryRaw`
    SELECT c.id,
           c."orgId",
           c."prospectId",
           c."phoneNumber",
           c."chatId",
           c."lastMessageAt",
           c."lastInboundMessageAt",
           c."reengageAttempts",
           c."reengageTotal"
    FROM "WhatsAppConversation" c
    LEFT JOIN "LeadChannelState" l
           ON l."prospectId" = c."prospectId" AND l.channel = 'whatsapp'
    WHERE c.status NOT IN ('OPTED_OUT', 'PAUSED')
      AND c."prospectId" IS NOT NULL
      AND c."automationPausedAt" IS NULL
      AND c."lastMessageAt" IS NOT NULL
      AND c."lastMessageAt" < ${cooldownCutoff}
      AND (c."lastReengageAt" IS NULL OR c."lastReengageAt" < ${gapCutoff})
      AND c."reengageAttempts" < ${CONFIG.maxAttempts}
      AND c."reengageTotal" < ${CONFIG.maxTotal}
      AND (l.status IS NULL OR l.status = 'active')
      AND EXISTS (SELECT 1 FROM "WhatsAppMessage" m
                  WHERE m."conversationId" = c.id AND m.direction = 'INBOUND')
      AND (SELECT m.direction FROM "WhatsAppMessage" m
           WHERE m."conversationId" = c.id
           ORDER BY m."createdAt" DESC
           LIMIT 1) = 'OUTBOUND'
    ORDER BY c."lastMessageAt" ASC
    LIMIT ${limit}
  `;
}

async function reengagementSentToday(prisma) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.whatsAppMessage.count({
    where: { source: 'REENGAGEMENT', direction: 'OUTBOUND', createdAt: { gte: startOfDay } },
  });
}

// ─── Processador: whatsapp:reengage-scan ─────────────────────────────────────

async function processScan() {
  if (!CONFIG.enabled) return { disabled: true };
  const prisma = getPrisma();

  const sentToday = await reengagementSentToday(prisma);
  const remaining = CONFIG.dailyCap - sentToday;
  if (remaining <= 0) {
    return { skipped: 'daily_cap_reached', sentToday };
  }

  const candidates = await findCandidates(prisma, Math.min(remaining, CONFIG.batchSize));
  if (candidates.length === 0) return { candidates: 0 };

  const queues = getWhatsAppQueues();
  for (const c of candidates) {
    const attempt = Number(c.reengageAttempts) + 1;
    // jobId determinístico: evita duplicidade entre scans; removeOnComplete
    // permite re-enfileirar a mesma conversa em ciclos futuros.
    await queues.reengage.add(
      { conversationId: c.id, attempt },
      {
        jobId: `reengage:${c.id}:${attempt}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  }

  log(`scan: ${candidates.length} conversa(s) candidata(s) enfileirada(s)`);
  return { candidates: candidates.length };
}

// ─── Guarda de reengajamento (re-leitura — veto duro) ────────────────────────

/**
 * Revalida TUDO no estado atual do banco. O scan pode estar defasado: o lead
 * pode ter respondido entre o scan e a execução — nesse caso, cancela.
 */
async function reengagementGuard(prisma, conversation, attempt) {
  if (attempt > conversation.reengageAttempts + 1) {
    return { allowed: false, reason: 'stale_attempt' };
  }
  if (conversation.reengageAttempts >= CONFIG.maxAttempts) {
    return { allowed: false, reason: 'max_attempts' };
  }
  if (conversation.reengageTotal >= CONFIG.maxTotal) {
    return { allowed: false, reason: 'max_total' };
  }
  if (conversation.automationPausedAt) return { allowed: false, reason: 'paused' };
  if (!conversation.whatsappAccountId) return { allowed: false, reason: 'no_account' };
  if (['OPTED_OUT', 'PAUSED'].includes(conversation.status)) {
    return { allowed: false, reason: `conversation_${conversation.status}` };
  }
  if (!conversation.prospectId || !(await isContactable(prisma, { orgId: conversation.orgId, prospectId: conversation.prospectId }))) {
    return { allowed: false, reason: 'do_not_contact' };
  }

  // A última mensagem tem de ser NOSSA e ter ficado sem resposta por ≥ cooldown.
  // Se o lead respondeu (última = INBOUND), a conversa voltou a viva — cancela.
  const last = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!last || last.direction !== 'OUTBOUND') {
    return { allowed: false, reason: 'lead_responded' };
  }
  const lastAt = conversation.lastMessageAt || last.createdAt;
  const cooldownMs = CONFIG.cooldownHours * 60 * 60 * 1000;
  if (Date.now() - new Date(lastAt).getTime() < cooldownMs) {
    return { allowed: false, reason: 'cooldown' };
  }

  // Gap mínimo desde a última decisão/envio do agente.
  if (conversation.lastReengageAt) {
    const gapMs = CONFIG.minGapHours * 60 * 60 * 1000;
    if (Date.now() - new Date(conversation.lastReengageAt).getTime() < gapMs) {
      return { allowed: false, reason: 'min_gap' };
    }
  }

  return { allowed: true, lastMessage: last };
}

// ─── Context assembly ────────────────────────────────────────────────────────

function contactName(prospect) {
  // Mesma convenção do first touch: primeiro nome do primeiro sócio (dados CNPJ).
  const partners = Array.isArray(prospect.cnpjPartners) ? prospect.cnpjPartners : [];
  const raw = (partners[0] && partners[0].name) || prospect.tradeName || prospect.companyName || '';
  if (!raw) return 'Olá';
  const first = String(raw).trim().split(/\s+/)[0];
  // Dados da Receita vêm em MAIÚSCULAS — normaliza para "Antonio".
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function renderTranscript(messages) {
  return messages
    .map((m) => `${m.direction === 'INBOUND' ? 'LEAD' : 'NÓS'} (${m.createdAt.toISOString().slice(0, 16)}Z): ${m.content || `[${m.type}]`}`)
    .join('\n');
}

const STRATEGIES = Object.freeze({
  1: {
    id: 'RETOMAR_CONTEXTO',
    goal:
      'Retomar exatamente de onde a conversa parou (o lead demonstrou interesse e recebeu a resposta/link). ' +
      'Pergunte com naturalidade se ele conseguiu ver/avançar. NÃO reintroduza o B2Base do zero.',
  },
  2: {
    id: 'VALOR_NOVO',
    goal:
      'Trazer valor NOVO e concreto: se houver empresas-exemplo abaixo, ofereça mostrar empresas reais ' +
      'do segmento/cidade dele que caberiam no perfil de prospecção dele. A mensagem deve demonstrar o produto.',
  },
  3: {
    id: 'REFRAME_E_ENCERRAMENTO',
    goal:
      'Última tentativa. Recadastre o valor em uma frase (não é lista de empresas; é encontrar empresas com o perfil certo e transformar em oportunidade) ' +
      'e encerre com elegância dizendo que não vai mais incomodar — que se quiser testar, é só chamar aqui.',
  },
});

function buildPrompt({ prospect, settings, conversation, messages, attempt, examples }) {
  const strategy = STRATEGIES[attempt] || STRATEGIES[CONFIG.maxAttempts];
  const contact = contactName(prospect);
  const location = [prospect.city, prospect.state].filter(Boolean).join('/');
  const partners = Array.isArray(prospect.cnpjPartners) ? prospect.cnpjPartners : [];

  const lines = [
    'Você é o agente comercial do B2Base no WhatsApp. Sua tarefa: decidir se devemos enviar uma',
    'mensagem de reengajamento para este lead e escrevê-la. A conversa esfriou: a última mensagem foi',
    'nossa e ele não respondeu.',
    '',
    '== CONTEXTO DO PRODUTO ==',
    b2baseContext.renderForPrompt(),
    '',
    '== NOSSA OPERAÇÃO (o cliente B2Base que está conversando) ==',
    settings ? `Proposta de valor: ${settings.valueProposition || 'não informada'}` : 'Proposta de valor: não informada',
    settings ? `Segmentos-alvo: ${JSON.stringify(settings.targetSegments || [])}` : '',
    settings ? `Regiões-alvo: ${JSON.stringify(settings.targetLocations || [])}` : '',
    '',
    '== LEAD ==',
    `Contato: ${contact}`,
    `Empresa: ${prospect.companyName}${prospect.tradeName ? ` (${prospect.tradeName})` : ''}`,
    `Segmento: ${prospect.industry || 'N/A'}`,
    `Cidade/UF: ${location || 'N/A'}`,
    `Porte: ${prospect.employees ? `${prospect.employees} colaboradores` : 'N/A'}`,
    partners.length ? `Sócios: ${partners.map((p) => p.name).filter(Boolean).join(', ')}` : '',
    '',
    '== HISTÓRICO DA CONVERSA (mais antiga → mais recente) ==',
    renderTranscript(messages),
    '',
    '== TENTATIVA ==',
    `Esta é a tentativa ${attempt} de ${CONFIG.maxAttempts} neste ciclo.`,
    `Estratégia obrigatória: ${strategy.id} — ${strategy.goal}`,
    examples && examples.length
      ? `Empresas reais do CNPJ que você pode citar (máx. 2, sem dados de contato delas): ${examples
          .map((e) => `${e.tradeName || e.legalName}${e.city ? ` (${e.city}${e.state ? `/${e.state}` : ''})` : ''}`)
          .join('; ')}`
      : '',
    '',
    '== REGRAS ==',
    '- Português do Brasil, tom humano de WhatsApp, curto: MÁXIMO 500 caracteres.',
    '- No máximo UMA pergunta. Sem "Oi, viu minha mensagem?", sem formalismo de e-mail.',
    '- Use o nome do contato e referencie algo REAL da conversa. Nunca invente fatos, preços, prazos ou promessas.',
    '- Sem emoji em excesso (no máximo 1). Sem saudação longa. Não se apresente como "assistente virtual" ou "IA".',
    '',
    'Responda SOMENTE com JSON válido:',
    '{ "should_send": true|false, "reason": "por que sim/não, em 1 frase", "message": "texto da mensagem (se should_send=true)", "suggested_delay_hours": 48 }',
  ];

  return lines.filter((l) => l !== undefined).join('\n');
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
          { role: 'system', content: 'Você é um agente comercial. Responda APENAS com JSON válido.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 500,
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

// ─── Policy Guard (conteúdo) ─────────────────────────────────────────────────

const BLOCKLIST = /(r\$\s?\d|desconto|grátis|gratis|garantid|promoç|promocao|promoção|hoje apenas|últimas vagas|ultimas vagas)/i;
const MAX_LEN = 600;

function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function contentGuard(prisma, conversation, messageText) {
  const content = String(messageText || '').trim();
  if (!content) return { pass: false, reason: 'empty' };
  if (content.length > MAX_LEN) return { pass: false, reason: 'too_long' };
  if (BLOCKLIST.test(content)) return { pass: false, reason: 'blocked_claim' };

  // Não repete nenhuma mensagem automatizada anterior desta conversa.
  const previous = await prisma.whatsAppMessage.findMany({
    where: { conversationId: conversation.id, source: 'REENGAGEMENT' },
    select: { content: true },
  });
  const normalized = normalizeForCompare(content);
  if (previous.some((p) => normalizeForCompare(p.content) === normalized)) {
    return { pass: false, reason: 'duplicate_content' };
  }
  return { pass: true, content };
}

// ─── Exemplos do CNPJ MCP (tentativa 2, best-effort) ─────────────────────────

async function fetchMcpExamples(prospect) {
  if (!CONFIG.mcpExamples || !mcpCnpj.isMcpConfigured()) return null;
  try {
    const withTimeout = Promise.race([
      mcpCnpj.searchCompanies({
        query: prospect.industry || 'empresas',
        city: prospect.city || undefined,
        state: prospect.state || undefined,
        limit: 3,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
    ]);
    const companies = await withTimeout;
    return (companies || []).filter((c) => c.status === 'active').slice(0, 3);
  } catch (err) {
    log(`exemplos MCP indisponíveis: ${err.message}`);
    return null;
  }
}

// ─── Fallback (templates pré-aprovados, se a IA falhar/recusar) ──────────────

function fallbackMessage(prospect, attempt, examples) {
  const contact = contactName(prospect);
  const segment = prospect.industry ? ` do setor de ${prospect.industry}` : '';
  const city = prospect.city ? ` em ${prospect.city}` : '';
  const examplesLine =
    examples && examples.length
      ? ` Dá até pra citar exemplo: ${examples
          .slice(0, 2)
          .map((e) => e.tradeName || e.legalName)
          .join(' e ')}.`
      : '';

  if (attempt <= 1) {
    return `${contact}, conseguiu dar uma olhada no que te mandei? Qualquer dúvida é só me chamar por aqui que eu te explico rapidinho.`;
  }
  if (attempt === 2) {
    return `${contact}, estava pensando aqui em como isso funciona na prática para empresas${segment}${city}. A ideia é filtrar empresas com o perfil que você procura e já trazer os contatos${examplesLine} Quer que eu te mostre um exemplo?`;
  }
  return `${contact}, talvez eu tenha explicado mal antes: não é uma lista de empresas, é uma ferramenta pra encontrar empresas com as características que você define e transformar isso em oportunidade comercial. Vou parar de te incomodar por aqui — se um dia quiser testar, é só me chamar. 😉`;
}

// ─── Processador: whatsapp:reengage ──────────────────────────────────────────

async function processReengage(job) {
  if (!CONFIG.enabled) return { disabled: true };
  const { conversationId, attempt } = job.data;
  const prisma = getPrisma();

  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return { skipped: 'conversation_not_found' };

  const guard = await reengagementGuard(prisma, conversation, Number(attempt));
  if (!guard.allowed) {
    return { skipped: guard.reason };
  }

  const prospect = await prisma.prospect.findUnique({ where: { id: conversation.prospectId } });
  if (!prospect) return { skipped: 'prospect_not_found' };

  const settings = await prisma.commercialSettings.findUnique({ where: { orgId: conversation.orgId } });

  const history = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  history.reverse();

  const attemptNum = Number(attempt);
  const examples = attemptNum === 2 ? await fetchMcpExamples(prospect) : null;

  const prompt = buildPrompt({ prospect, settings, conversation, messages: history, attempt: attemptNum, examples });
  const decision = await callLlm(prompt);

  // O que a IA decidiu/produziu. Em qualquer falha (LLM down, JSON inválido,
  // should_send=false sem motivo), cai no fallback pré-aprovado — exceto
  // recusa explícita, que é respeitada.
  let messageText = null;
  let origin = 'fallback';
  let reason = null;

  if (decision && decision.should_send === false) {
    reason = decision.reason || 'ia_refused';
  } else if (decision && decision.message) {
    const contentGuardResult = await contentGuard(prisma, conversation, decision.message);
    if (contentGuardResult.pass) {
      messageText = contentGuardResult.content;
      origin = 'ai';
      reason = decision.reason || null;
    } else {
      reason = `guard_${contentGuardResult.reason}`;
    }
  } else {
    reason = 'llm_unavailable';
  }

  if (!messageText && !(decision && decision.should_send === false)) {
    messageText = fallbackMessage(prospect, attemptNum, examples);
    origin = 'fallback';
  }

  const now = new Date();

  // Recusa explícita da IA: registra decisão e adia a próxima avaliação
  // (lastReengageAt atua como gate de gap no scan). Não queima tentativa.
  if (!messageText) {
    await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastReengageAt: now },
    });
    log(`decisão: NÃO enviar ${conversationId} (${reason})`);
    return { decided: false, reason };
  }

  if (CONFIG.mode !== 'auto') {
    // SHADOW: não envia, não queima tentativa — só registra a decisão para
    // auditoria/iteração de prompt (o gap via lastReengageAt evita re-LLM em loop).
    await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastReengageAt: now },
    });
    log(`SHADOW [${STRATEGIES[attemptNum] ? STRATEGIES[attemptNum].id : attemptNum}] ${prospect.companyName}: ${messageText}`);
    return { mode: 'shadow', origin, message: messageText };
  }

  // AUTO: final check de concorrência — o lead pode ter respondido enquanto a
  // IA gerava. Se respondeu, a conversa voltou a ser viva: cancela sem rastro.
  const last = await prisma.whatsAppMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
  });
  if (!last || last.direction !== 'OUTBOUND') {
    return { skipped: 'lead_responded_during_generation' };
  }

  const message = await prisma.whatsAppMessage.create({
    data: {
      conversationId,
      orgId: conversation.orgId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: messageText,
      status: 'PENDING',
      source: 'REENGAGEMENT',
    },
  });

  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: {
      reengageAttempts: { increment: 1 },
      reengageTotal: { increment: 1 },
      lastReengageAt: now,
    },
  });

  await getWhatsAppQueues().send.add(
    { messageId: message.id },
    { attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
  );

  log(`enviado (origem=${origin}, tentativa=${attemptNum}) para ${prospect.companyName}: ${messageText.slice(0, 80)}...`);
  return { sent: true, messageId: message.id, origin };
}

// ─── Registro/boot ───────────────────────────────────────────────────────────

async function startReengagement() {
  if (!CONFIG.enabled) {
    log('desabilitado (REENGAGE_ENABLED != true)');
    return { enabled: false };
  }

  registerProcessor(QUEUES.REENGAGE_SCAN, processScan, 1);
  registerProcessor(QUEUES.REENGAGE, processReengage, 2);

  // Job repeatable do scan. Bull deduplica pelo mesmo `repeat` — chamar no boot
  // é idempotente (mesmo padrão do gmail-sync em outreach-workers.js).
  await getWhatsAppQueues().reengageScan.add(
    {},
    { repeat: { every: CONFIG.scanIntervalMin * 60 * 1000 }, jobId: 'reengage-scan-periodic' }
  );

  log(`✓ ativo (mode=${CONFIG.mode}, cooldown=${CONFIG.cooldownHours}h, maxAttempts=${CONFIG.maxAttempts}, cap diário=${CONFIG.dailyCap})`);
  return { enabled: true, mode: CONFIG.mode };
}

module.exports = {
  CONFIG,
  processScan,
  processReengage,
  reengagementGuard,
  contentGuard,
  findCandidates,
  fallbackMessage,
  buildPrompt,
  startReengagement,
};
