/**
 * Outreach Worker Processors — Bull queue handlers for the 4 queues.
 *
 * Queue: outreach:prepare
 *   Loads lead → generates AI email → saves OutreachMessage → schedules send.
 *
 * Queue: outreach:message-send
 *   Checks rate limit → sends via Gmail API → updates status → schedules follow-up.
 *
 * Queue: outreach:gmail-sync
 *   Checks mailbox via History API → detects replies → updates contacts.
 *
 * NOTE: PrismaClient is NOT serializable. Workers re-create it from DATABASE_URL.
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { createWorker, registerWorker } = require('./outreach-queues');
const { listHistory } = require('./gmail-api');
const { sendEmailForAccount } = require('./email-provider');
const { checkLimit, calculateDelay, getConfig: getRateConfig } = require('./outreach-rate-limiter');
const { renderTemplate } = require('./whatsapp-utils');
const orgContext = require('./org-context');
const metrics = require('./metrics');

// Lazy singleton — workers share one connection pool
let _prisma = null;
function getPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// ─── Lightweight AI message generator ────────────────────────────
/**
 * Gera o email de outreach com os 3 pilares de contexto:
 *   1. Empresa da org (org-context.js: produto, modelo, diferenciais, site/CTA)
 *   2. Proposta da campanha (objetivo/oferta)
 *   3. Histórico de contato (follow-up referencia os toques anteriores)
 * O HTML (com pixel de tracking da PLATAFORMA, não da org) é montado
 * server-side — o modelo só devolve subject/body, para não vazar domínio
 * alheio no corpo.
 */
function buildOutreachPrompt({ lead, orgCtx, campaign, seq = 1, history = [] }) {
  const followup = seq > 1;
  const historyBlock = followup && history.length
    ? [
        '== HISTÓRICO DE CONTATO ==',
        `Este é o FOLLOW-UP #${seq} (até 4 toques no total). Toques anteriores:`,
        ...history.map((m, i) => `${i + 1}. Assunto: "${m.subject}"${m.status && /OPENED/.test(m.status) ? ' (aberto pelo lead)' : ''}`),
        'REGRA DE FOLLOW-UP: NÃO repita o mesmo conteúdo/ângulo dos toques anteriores;',
        'referencie de forma breve e natural que você já escreveu antes e traga um ângulo novo',
        '(outro benefício do contexto, caso de uso ou pergunta objetiva). Sem cobrança ou culpa.',
        '',
      ]
    : [];

  const campaignBlock = orgContext.renderCampaignBlock(campaign);

  return [
    `Você é um vendedor da ${orgContext.sellerIdentity(orgCtx)}. Escreva um email B2B em português brasileiro.`,
    '',
    '== CONTEXTO DA NOSSA EMPRESA ==',
    orgCtx.renderForPrompt(),
    '',
    ...(campaignBlock ? [campaignBlock, ''] : []),
    '== PROSPECTO ==',
    `- Empresa: ${lead.companyName}${lead.tradeName ? ` (${lead.tradeName})` : ''}`,
    `- Segmento: ${lead.industry || 'N/A'}`,
    `- Localização: ${lead.city ? [lead.city, lead.state].filter(Boolean).join('/') : 'N/A'}`,
    `- Colaboradores: ${lead.employees || 'N/A'}`,
    `- Faturamento estimado: R$ ${(lead.revenueEstimate || 0).toLocaleString('pt-BR')}`,
    '',
    ...historyBlock,
    'REGRAS:',
    '- Use apenas fatos presentes nos dados acima (empresa, campanha, histórico). Não invente informações, preços, prazos ou promessas.',
    '- Não cite nomes de plataformas/empresas que não estejam no contexto e não inclua links que não estejam nele.',
    '- Tom humano e direto, sem parecer template.',
    '',
    'Retorne SOMENTE JSON válido:',
    '{',
    '  "subject": "Assunto curto (máx 60 caracteres)",',
    '  "body": "Corpo em texto plano",',
    '  "reasoning_facts": ["fato1", "fato2"]',
    '}',
  ].filter((l) => l !== undefined).join('\n');
}

/** Corpo texto plano → HTML mínimo (o pixel é injetado depois pelo prepare). */
function plainBodyToHtml(body) {
  return `<p>${String(body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')}</p>`;
}

async function generateOutreachMessage(prisma, { lead, seq = 1, campaign = null, orgCtx = null, history = [] }) {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmModel = process.env.LITELLM_MODEL || 'qwen/qwen2.5-7b-instruct';

  // Contexto da org (empresa do cliente) — pilar 1. Se o chamador já trouxe,
  // evita re-consulta (processPrepare reusa para o fallback).
  let ctx = orgCtx;
  if (!ctx) {
    try {
      ctx = await orgContext.loadOrgContext(prisma, lead.orgId);
    } catch (_) {
      ctx = orgContext.buildOrgContext({ orgName: null, settings: null });
    }
  }

  const prompt = buildOutreachPrompt({ lead, orgCtx: ctx, campaign, seq, history });

  try {
    const res = await fetch(`${litellmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LITELLM_API_KEY
          ? { Authorization: `Bearer ${process.env.LITELLM_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: litellmModel,
        messages: [
          {
            role: 'system',
            content: 'Você é um vendedor B2B brasileiro. Responda APENAS com JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`LiteLLM HTTP ${res.status}`);

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);

    const subject = parsed.subject || (seq > 1 ? `Retomando o contato: ${lead.companyName}` : `Uma oportunidade para ${lead.companyName}`);
    const body = parsed.body || '';
    return {
      subject,
      body,
      htmlBody: plainBodyToHtml(body),
      reasoningFacts: parsed.reasoning_facts || [],
    };
  } catch (err) {
    console.error('[outreach] AI generation failed, using template fallback:', err.message);

    return _templateFallback(lead, ctx, seq, history);
  }
}

/**
 * Template-based fallback when AI is unavailable — identidade e valor vêm do
 * CONTEXTO DA ORG (nunca "Equipe B2Base" para outra empresa).
 */
function _templateFallback(lead, orgCtx, seq = 1, history = []) {
  const nome = orgContext.sellerIdentity(orgCtx);
  const assinatura = `Equipe ${nome}`;
  const valor = (orgCtx && (orgCtx.propostaValor || orgCtx.oQueE)) || 'ajudar empresas a encontrar e converter mais oportunidades';
  const followup = seq > 1;

  const body = followup
    ? `Olá,\n\nPassando para retomar minha mensagem anterior sobre ${lead.companyName}. Se fizer sentido, posso mostrar ${valor} na prática e responder suas dúvidas.\n\nSe agora não for o momento, sem problema — me avisa e não insisto mais.\n\nAbraços,\n${assinatura}`
    : `Olá,\n\nEspero que esteja bem!\n\nConheço a ${lead.companyName} e sei que empresas do segmento ${lead.industry || 'de negócios'} costumam enfrentar desafios para crescer.\n\nTrabalho com ${valor}. Gostaria de agendar uma conversa rápida de 15 min para ver se faz sentido para vocês?\n\nAbraços,\n${assinatura}`;

  const html = plainBodyToHtml(body);

  return {
    subject: followup ? `Retomando o contato: ${lead.companyName}` : `Uma oportunidade para ${lead.companyName}`,
    body,
    htmlBody: html,
    reasoningFacts: [`Referência a ${lead.companyName}`, `Segmento: ${lead.industry || 'geral'}`, followup ? `followup_seq_${seq}` : 'first_touch'],
  };
}

// ─── QUEUE: outreach:prepare ──────────────────────────────────────

/**
 * Decide se um job prepare deve ser ignorado:
 * - Lançamento (primeiro toque) com contato prévio nesta campanha → NUNCA
 *   reenrola. Antes o upsert resetava SENT/REPLIED para SCHEDULED e o check
 *   pós-upsert lia o status já sobrescrito (código morto) — relançar a
 *   campanha reenviava a mensagem pro mesmo lead. Falha tem retry próprio
 *   (/api/outreach/dispatches/retry reusa a própria mensagem).
 * - Follow-up cujo contato virou terminal DURANTE o delay (ex.: lead
 *   respondeu no intervalo) → cancela (o upsert clobberia REPLIED→SCHEDULED).
 * Retorna null para prosseguir, ou o motivo do skip.
 */
function _prepareSkipReason(existing, isFollowup) {
  if (!existing) return null;
  if (!isFollowup) return 'already_enrolled';
  if (['REPLIED', 'UNSUBSCRIBED', 'CANCELLED'].includes(existing.status)) return 'terminal_status';
  return null;
}

async function processPrepare(job) {
  const { prospectId, campaignId, emailAccountId, tenantId, _isFollowup, followupSequence } = job.data;

  console.log(`[prepare] job ${job.id} — prospect ${prospectId}, seq ${followupSequence || 1}`);

  const prisma = getPrisma();

  // Load lead
  const lead = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!lead) throw new Error(`Prospect ${prospectId} not found`);

  // Load existing contact (if any) so we can compute the next outreach
  // sequence without referencing the not-yet-assigned `contact` variable
  // (previously this upsert referenced `contact.outreachSequence` inside its
  // own `update` object, which is evaluated before the assignment completes
  // and threw "Cannot access 'contact' before initialization").
  const existing = await prisma.outreachContact.findUnique({
    where: {
      prospectId_campaignId: { prospectId, campaignId },
    },
    select: { outreachSequence: true, status: true },
  });

  // Idempotência de lançamento/follow-up (ver _prepareSkipReason): o lead
  // nunca recebe dois primeiros toques na mesma campanha, e follow-up de
  // contato terminal é cancelado em vez de ressuscitar o status.
  const skipReason = _prepareSkipReason(existing, Boolean(_isFollowup));
  if (skipReason) {
    console.log(`[prepare] prospect ${prospectId} em ${campaignId}: skip (${skipReason}, status ${existing.status})`);
    return { skipped: true, reason: skipReason, status: existing.status };
  }

  // Upsert outreach_contact. Chegando aqui: ou o contato é novo, ou é
  // follow-up de contato não-terminal (SENT → próxima sequência volta a
  // SCHEDULED, o fluxo normal da sequência).
  const nextSequence = Math.max(existing?.outreachSequence || 0, followupSequence || 1);
  let contact = await prisma.outreachContact.upsert({
    where: {
      prospectId_campaignId: { prospectId, campaignId },
    },
    create: {
      campaignId,
      prospectId,
      emailAccount_id: emailAccountId || null,
      status: 'SCHEDULED',
      outreachSequence: nextSequence,
      scheduledAt: new Date(Date.now() + 60 * 1000), // 1 min min
    },
    update: {
      status: 'SCHEDULED',
      outreachSequence: nextSequence,
      scheduledAt: new Date(Date.now() + 60 * 1000),
    },
  });

  // Conteúdo: template custom da campanha (suíte multicanal) quando
  // configurado; senão geração via IA com fallback de template. A IA recebe os
  // 3 pilares de contexto: empresa da org, proposta da campanha e histórico.
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  const orgCtx = await orgContext.loadOrgContext(prisma, lead.orgId);
  const history = await prisma.outreachMessage.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  let generated;
  if (campaign?.emailTemplateSubject && campaign?.emailTemplateBody) {
    generated = {
      subject: renderTemplate(campaign.emailTemplateSubject, lead),
      body: renderTemplate(campaign.emailTemplateBody, lead),
      htmlBody: `<p>${renderTemplate(campaign.emailTemplateBody, lead)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br/>')}</p>`,
      reasoningFacts: ['campaign_template'],
    };
  } else {
    generated = await generateOutreachMessage(prisma, {
      lead,
      seq: contact.outreachSequence,
      campaign,
      orgCtx,
      history,
    });
  }

  // Add tracking pixel
  const trackingToken = crypto.randomUUID();
  const htmlWithPixel = generated.htmlBody.includes('{tracking-token}')
    ? generated.htmlBody.replace('{tracking-token}', trackingToken)
    : `${generated.htmlBody}<img src="https://b2base.net/t/o/${trackingToken}.gif" width="1" height="1" alt="" />`;

  // Create outreach_message (calculateDelay retorna segundos)
  const delaySeconds = calculateDelay(getRateConfig());
  const message = await prisma.outreachMessage.create({
    data: {
      contactId: contact.id,
      subject: generated.subject,
      body: generated.body,
      htmlBody: htmlWithPixel,
      status: 'SCHEDULED',
      generatedAt: new Date(),
      scheduledFor: new Date(Date.now() + delaySeconds * 1000),
      trackingToken,
      aiReasoningFacts: generated.reasoningFacts,
    },
  });

  // Enfileira o envio respeitando o delay de rate-limit calculado
  const { createQueue } = require('./outreach-queues');
  const sendQueue = createQueue('outreach:message-send', {
    redis: process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379',
  });
  await _enqueueSend(sendQueue, message.id, delaySeconds * 1000);

  // Create outreach_event
  await prisma.outreachEvent.create({
    data: {
      contactId: contact.id,
      messageId: message.id,
      type: 'email_scheduled',
      status: 'scheduled',
      details: {
        subject: generated.subject,
        sequence: contact.outreachSequence,
        scheduledFor: message.scheduledFor,
        campaignId: campaign ? campaign.id : campaignId,
        campaignName: campaign ? campaign.name : null,
        aiContext: {
          orgConfigured: orgCtx.configured,
          followup: contact.outreachSequence > 1,
          historyCount: history.length,
        },
      },
    },
  });

  console.log(`[prepare] ✓ message ${message.id} scheduled (token: ${trackingToken})`);
  return { messageId: message.id, contactId: contact.id };
}

// ─── QUEUE: outreach:message-send ─────────────────────────────────

/**
 * Enfileira envio com jobId = messageId (dedupe natural: se já existe job
 * vivo para a mensagem, add() devolve o existente em vez de duplicar). Jobs
 * mortos (failed/completed) com o mesmo id são removidos antes — sem isso o
 * add() é ignorado e a mensagem ficaria presa para sempre.
 *
 * `dedupe: false` (usado no reenvio pós-rate-limit DENTRO do próprio job):
 * o dedupe encontraria o job ATIVO em execução e adicionaria nada — o
 * "retrying in Xms" nunca era criado e a mensagem congelava em SCHEDULED
 * até o boot seguinte. Com dedupe off, o jobId é auto-gerado (novo job de
 * verdade); duplicatas inofensivas são cortadas pelo check de idempotência
 * (status SENT) no início do processador.
 */
async function _enqueueSend(sendQueue, messageId, delayMs = 0, { dedupe = true } = {}) {
  if (dedupe) {
    const existing = await sendQueue.getJob(messageId).catch(() => null);
    if (existing) {
      const state = await existing.getState().catch(() => null);
      if (['delayed', 'waiting', 'active', 'waiting-children', 'prioritized'].includes(state)) {
        return existing; // já está na fila — não duplica
      }
      await existing.remove().catch(() => {});
    }
  }
  return sendQueue.add(
    { messageId },
    {
      ...(dedupe ? { jobId: messageId } : {}),
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60 * 1000 },
      removeOnComplete: true,
    }
  );
}

/**
 * Revitalização de mensagens órfãs no boot: SCHEDULED com scheduledFor já
 * vencido e sem job vivo na fila Bull. Acontece quando os workers ficam fora
 * do ar entre o agendamento e a hora do envio (ex.: CrashLoop de deploy) ou
 * quando o job esgota as tentativas — sem isto a linha fica "aguardando"
 * para sempre no histórico.
 */
async function requeueStuckScheduledMessages() {
  try {
    const prisma = getPrisma();
    const { createQueue } = require('./outreach-queues');
    const sendQueue = createQueue('outreach:message-send', {
      redis: process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379',
    });

    const stuck = await prisma.outreachMessage.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: { lt: new Date(Date.now() - 60 * 1000) },
      },
      select: { id: true },
      take: 500,
    });

    let requeued = 0;
    for (const m of stuck) {
      // dedupe OFF: o dedupe por jobId pode sofrer no-op silencioso contra
      // referências mortas do ciclo anterior (o log dizia "reenfileirada"
      // mas a mensagem ficava sem job). Duplicata inofensiva: o processador
      // aborta com already_sent se a mensagem já saiu de SCHEDULED.
      await _enqueueSend(sendQueue, m.id, 0, { dedupe: false });
      requeued += 1;
    }

    if (stuck.length > 0) {
      console.log(`[outreach] requeue: ${requeued}/${stuck.length} mensagem(ns) SCHEDULED vencida(s) reenfileirada(s) no boot`);
    }
    return requeued;
  } catch (err) {
    console.error('[outreach] requeue de SCHEDULED vencidas falhou:', err.message);
    return 0;
  }
}

async function processSend(job) {
  const { messageId } = job.data;

  console.log(`[send] job ${job.id} — message ${messageId}`);

  const prisma = getPrisma();

  const message = await prisma.outreachMessage.findUnique({
    where: { id: messageId },
    include: {
      contact: {
        include: {
          campaign: { select: { tenantId: true } },
        },
      },
    },
  });

  if (!message) {
    console.error(`[send] ✗ message ${messageId} not found`);
    throw new Error(`Message ${messageId} not found`);
  }

  // Check for terminal states on the contact
  if (message.contact.status === 'REPLIED' || message.contact.status === 'UNSUBSCRIBED' || message.contact.status === 'CANCELLED') {
    console.log(`[send] ✗ contact ${message.contactId} in terminal state ${message.contact.status}, cancelling`);
    return { cancelled: true, reason: message.contact.status };
  }

  // Idempotência: evita reenvio duplicado se o job for entregue mais de uma vez.
  if (message.status === 'SENT') {
    return { already_sent: true };
  }

  // Check rate limit
  if (!message.contact.emailAccount_id) {
    throw new Error(`No email account configured for contact ${message.contactId}`);
  }

  const rateLimit = await checkLimit(
    prisma,
    message.contact.emailAccount_id,
    getRateConfig()
  );

  if (!rateLimit.allowed) {
    console.log(`[send] ⊘ rate limited, retrying in ${rateLimit.retryIn}ms`);
    metrics.incEmailRateLimited();
    const { createQueue } = require('./outreach-queues');
    const sendQueue = createQueue('outreach:message-send', {
      redis: process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379',
    });
    // dedupe OFF: o job "atual" é este que está rodando — o dedupe padrão o
    // encontraria e descartaria o reagendamento (bug dos disparos travados
    // em "Agendado").
    await _enqueueSend(sendQueue, messageId, rateLimit.retryIn, { dedupe: false });
    return { retried: true, retryIn: rateLimit.retryIn };
  }

  // Determine recipient
  // `prospect` não é uma relation de OutreachContact no schema; buscamos o
  // email de contato do lead diretamente pelo prospectId do contact.
  const prospect = await prisma.prospect.findUnique({
    where: { id: message.contact.prospectId },
    select: { cnpjEmail: true },
  });
  const recipientEmail =
    prospect?.cnpjEmail ||
    message.body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0];

  if (!recipientEmail) {
    metrics.incEmailFailed();
    await prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED', error: 'No recipient email found' },
    });
    // Falha PERMANENTE (lead sem e-mail): termina sem re-tentar — o throw
    // anterior gastava 3 retries do Bull para o mesmo erro determinístico.
    return { failed: 'no_recipient_email', messageId };
  }

  // Build MIME and send (provider-agnostic: gmail OAuth, SMTP ou Resend)
  const messageIdHeader = crypto.randomUUID();
  let result;
  try {
    result = await sendEmailForAccount(prisma, message.contact.emailAccount_id, {
      to: recipientEmail,
      subject: message.subject,
      body: message.body,
      htmlBody: message.htmlBody,
      messageId: messageIdHeader,
    });
  } catch (err) {
    const errorMsg = String(err?.message || err);
    console.error(`[send] ✗ failed to ${recipientEmail}:`, errorMsg);
    metrics.incEmailFailed();
    // Marca a mensagem/contacto como falha para ficar visível no histórico e
    // permitir retry manual. O job re-lança o erro para o Bull re-tentar com backoff.
    await prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED', error: errorMsg },
    }).catch(() => {});
    await prisma.outreachContact.update({
      where: { id: message.contactId },
      data: { status: 'FAILED' },
    }).catch(() => {});
    await prisma.outreachEvent.create({
      data: {
        contactId: message.contactId,
        messageId,
        type: 'email_failed',
        status: 'failed',
        details: { error: errorMsg },
      },
    }).catch(() => {});
    throw err;
  }

  // Update message → SENT
  // (colunas gmailMessageId/gmailThreadId são históricas: guardam os ids
  // retornados pelo provider que enviou)
  await prisma.outreachMessage.update({
    where: { id: messageId },
    data: {
      status: 'SENT',
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      messageHeaderId: messageIdHeader,
      sentAt: new Date(),
    },
  });
  metrics.incEmailSent();

  // Update contact → SENT
  await prisma.outreachContact.update({
    where: { id: message.contactId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Events: email_sent + email_delivered_inferred
  await prisma.outreachEvent.createMany({
    data: [
      {
        contactId: message.contactId,
        messageId,
        type: 'email_sent',
        status: 'sent',
        details: { providerMessageId: result.messageId, providerThreadId: result.threadId },
      },
      {
        contactId: message.contactId,
        messageId,
        type: 'email_delivered_inferred',
        status: 'delivered',
      },
    ],
  });

  // Schedule follow-up if appropriate
  await _scheduleFollowup(prisma, message.contactId);

  // Sinaliza o lead como contatado (canal email) — badge "Contatado" na UI
  const { markContacted } = require('./campaign-suite');
  await markContacted(prisma, message.contact.prospectId, 'email').catch(() => {});

  console.log(`[send] ✓ sent to ${recipientEmail} (provider msg: ${result.messageId})`);
  return { messageId: result.messageId, threadId: result.threadId };
}

// ─── QUEUE: outreach:gmail-sync ───────────────────────────────────
async function processSync(job) {
  const prisma = getPrisma();
  console.log('[gmail-sync] starting mailbox sync');

  // Reply-sync só existe para provider gmail (History API); SMTP/Resend
  // são send-only e são skipados aqui.
  const accounts = await prisma.emailAccount.findMany({
    where: { status: 'connected', provider: 'gmail' },
  });

  let totalReplies = 0;

  for (const account of accounts) {
    const { changes, newHistoryId } = await listHistory(prisma, account.id, account.lastHistoryId);

    for (const change of changes) {
      // Look for label updates (replies often get labels added)
      if (change.messages?.updated) {
        for (const updated of change.messages.updated) {
          const newLabels = updated.labelChanges?.filter((c) => c.labelsAdded) || [];
          const removedLabels = updated.labelChanges?.filter((c) => c.labelsRemoved) || [];

          // Any label change suggests a new message the user interacted with
          if (newLabels.length > 0 || removedLabels.length > 0) {
            const msgData = updated.message;
            const isReply = _isReply(msgData);
            if (isReply) {
              const handled = await _handleReply(prisma, msgData, account.id);
              totalReplies += handled;
            }
          }
        }
      }

      // Also check added messages for potential replies
      if (change.messages?.added) {
        for (const added of change.messages.added) {
          if (!added.message?.id) continue;
          const msgData = await _fetchGmailMessage(prisma, account.id, added.message.id);
          if (msgData && _isReply(msgData)) {
            const handled = await _handleReply(prisma, msgData, account.id);
            totalReplies += handled;
          }
        }
      }
    }

    // Persist last history ID
    if (newHistoryId && newHistoryId !== account.lastHistoryId) {
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { lastHistoryId: newHistoryId },
      });
    }
  }

  console.log(`[gmail-sync] ✓ processed ${accounts.length} accounts, ${totalReplies} replies found`);
  return { processed: accounts.length, replies: totalReplies };
}

/**
 * Lightweight Gmail message fetch (avoids full client init per call).
 */
async function _fetchGmailMessage(prisma, emailAccountId, messageId) {
  try {
    const { getMessage } = require('./gmail-api');
    return await getMessage(prisma, emailAccountId, messageId);
  } catch {
    return null;
  }
}

/**
 * Check if a Gmail message is a reply to our outreach.
 */
function _isReply(msgData) {
  if (!msgData?.payload?.headers) return false;
  const headers = msgData.payload.headers;
  const map = {};
  headers.forEach((h) => {
    map[(h.name || '').toLowerCase()] = h.value || '';
  });

  // Strong signal: In-Reply-To or References headers
  if (map['in-reply-to'] || map['references']) return true;

  // Medium signal: subject starts with "Re:" and differs from our emails
  const subject = map['subject'] || '';
  if (subject.startsWith('Re:') || subject.startsWith('res:')) return true;

  return false;
}

/**
 * When a reply is found: update contact, log event, cancel pending follow-ups.
 */
async function _handleReply(prisma, msgData, emailAccountId) {
  const headers = msgData?.payload?.headers || [];
  const headerMap = {};
  headers.forEach((h) => {
    headerMap[(h.name || '').toLowerCase()] = h.value || '';
  });

  const from = headerMap['from'] || '';
  const subject = headerMap['subject'] || '';
  const gmailMessageId = msgData?.id || '';
  const threadId = msgData?.threadId || '';

  // Find matching outreach_contact (by gmail thread or by prospect email match)
  const contact = await prisma.outreachContact.findFirst({
    where: {
      status: { notIn: ['REPLIED', 'UNSUBSCRIBED', 'CANCELLED'] },
      OR: [
        { messages: { some: { gmailThreadId: threadId } } },
        // Match by prospect email in Cc/Bcc if thread doesn't match
        { messages: { some: { status: 'SENT' } } },
      ],
    },
  });

  if (!contact) return 0;

  // Validate the reply is not from our own email account
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { email: true },
  });
  if (from.includes(emailAccount?.email || '')) {
    return 0; // self-email, skip
  }

  // Update contact
  await prisma.outreachContact.update({
    where: { id: contact.id },
    data: {
      status: 'REPLIED',
      lastReplyAt: new Date(),
      replyCount: { increment: 1 },
    },
  });

  // Attach gmail thread ID to the first SENT message
  const sentMsg = await prisma.outreachMessage.findFirst({
    where: { contactId: contact.id, status: 'SENT' },
  });
  if (sentMsg && threadId) {
    await prisma.outreachMessage.update({
      where: { id: sentMsg.id },
      data: { gmailThreadId: threadId },
    });
  }

  // Log event
  await prisma.outreachEvent.create({
    data: {
      contactId: contact.id,
      messageId: sentMsg?.id,
      type: 'email_replied',
      status: 'replied',
      details: { from, subject, gmailMessageId },
    },
  });

  // Cancel pending follow-ups for this contact
  await _cancelFollowups(prisma, contact.id);

  console.log(`[reply] ✓ contact ${contact.id} replied (seq ${contact.outreachSequence})`);
  return 1;
}

/**
 * Schedule a follow-up job (BullMQ delayed).
 */
async function _scheduleFollowup(prisma, contactId) {
  const contact = await prisma.outreachContact.findUnique({
    where: { id: contactId },
    include: { campaign: true },
  });

  if (!contact) return;

  // Terminal states → no follow-up
  if (contact.status === 'REPLIED' || contact.status === 'UNSUBSCRIBED' || contact.status === 'CANCELLED') {
    return;
  }

  // Campanhas com template custom (suíte multicanal) são single-shot:
  // reenviar o mesmo template em follow-up seria duplicar a mensagem.
  if (contact.campaign?.emailTemplateBody) {
    return;
  }

  // Max 4 emails total (1 initial + 3 follow-ups)
  const maxSeq = 4;
  if (contact.outreachSequence >= maxSeq) return;

  // Follow-up delays in days: [3, 5, 7]
  const followupDelays = [3, 5, 7];
  const nextSeq = contact.outreachSequence + 1;
  const daysDelay = followupDelays[nextSeq - 2] || 7;
  const delayMs = daysDelay * 24 * 60 * 60 * 1000;

  // Re-use prepare worker for follow-up
  const { createQueue } = require('./outreach-queues');
  const redisUrl = process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379';
  const queue = createQueue('outreach:prepare', { redis: redisUrl });

  await queue.add(
    {
      prospectId: contact.prospectId,
      campaignId: contact.campaignId,
      emailAccountId: contact.emailAccount_id,
      tenantId: contact.campaign.tenantId,
      _isFollowup: true,
      followupSequence: nextSeq,
      contactId,
    },
    { delay: delayMs, attempts: 1 }
  );

  // Log event
  await prisma.outreachEvent.create({
    data: {
      contactId,
      type: 'followup_scheduled',
      status: 'scheduled',
      details: { sequence: nextSeq, delayDays: daysDelay, willRetryAt: new Date(Date.now() + delayMs).toISOString() },
    },
  });

  console.log(`[followup] scheduled seq ${nextSeq} in ${daysDelay} days`);
}

/**
 * Cancel pending follow-up jobs for a contact.
 */
async function _cancelFollowups(prisma, contactId) {
  const { createQueue } = require('./outreach-queues');
  const redisUrl = process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379';
  const queue = createQueue('outreach:prepare', { redis: redisUrl });

  const pending = await queue.getJobs(['delayed']);
  const toRemove = pending.filter((j) => j.data.contactId === contactId);

  if (toRemove.length > 0) {
    await Promise.all(toRemove.map((j) => j.remove()));
    console.log(`[followup] cancelled ${toRemove.length} pending jobs for contact ${contactId}`);
  }

  // Also cancel in send queue
  const sendQueue = createQueue('outreach:message-send', { redis: redisUrl });
  const sendPending = await sendQueue.getJobs(['delayed']);
  const sendToRemove = sendPending.filter((j) => j.data.messageId);

  await prisma.outreachContact.update({
    where: { id: contactId },
    data: { cancelReason: 'replied' },
  });
}

// ─── Worker registration ──────────────────────────────────────────
function registerAllWorkers() {
  const { registerProcessor, createQueue } = require('./outreach-queues');

  registerProcessor('outreach:prepare', processPrepare, 2);
  registerProcessor('outreach:message-send', processSend, 1);
  registerProcessor('outreach:gmail-sync', processSync, 1);

  // Revitaliza mensagens SCHEDULED vencidas cujo job morreu (workers fora do
  // ar no horário agendado, tentativas esgotadas) — sem isto ficam
  // "aguardando" para sempre no histórico.
  void requeueStuckScheduledMessages();

  // Reply-sync periódico (só provider gmail — SMTP/Resend são send-only).
  // Job repetitivo com jobId fixo para não duplicar em restart.
  try {
    const redisUrl = process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379';
    const syncQueue = createQueue('outreach:gmail-sync', { redis: redisUrl });
    void syncQueue.add(
      { periodic: true },
      { repeat: { every: 5 * 60 * 1000 }, jobId: 'gmail-sync-periodic' }
    );
  } catch (err) {
    console.error('[outreach] falha ao agendar gmail-sync periódico:', err.message);
  }

  console.log('[outreach] ✓ all workers registered (3 processors)');
}

// ─── API: Start outreach campaign ─────────────────────────────────
async function startOutreachCampaign(prisma, campaignId, prospectIds, emailAccountId, userId) {
  const { createQueue } = require('./outreach-queues');

  const campaign = await prisma.outreachCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  if (emailAccountId) {
    const acct = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
    if (!acct) throw new Error('Email account not found');
  }

  // Idempotência: lead já inscrito nesta campanha não é reenfileirado — o
  // lançamento é o PRIMEIRO toque (follow-ups têm fluxo próprio e falhas
  // têm retry próprio em /api/outreach/dispatches/retry). O processPrepare
  // barra de novo (backstop contra corrida entre lista e enfileiramento).
  const enrolled = await prisma.outreachContact.findMany({
    where: { campaignId, prospectId: { in: prospectIds } },
    select: { prospectId: true },
  });
  const alreadyEnrolled = new Set(enrolled.map((c) => c.prospectId));
  const freshProspectIds = prospectIds.filter((id) => !alreadyEnrolled.has(id));

  const queue = createQueue('outreach:prepare');
  const jobIds = [];

  for (let i = 0; i < freshProspectIds.length; i++) {
    const job = await queue.add(
      {
        prospectId: freshProspectIds[i],
        campaignId,
        emailAccountId,
        tenantId: campaign.tenantId,
        userId,
      },
      { delay: i * 500, attempts: 2 }
    );
    jobIds.push(job.id);
  }

  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: { status: 'active' },
  });

  if (alreadyEnrolled.size > 0) {
    console.log(`[outreach] lançamento ${campaignId}: ${alreadyEnrolled.size} lead(s) já inscrito(s) ignorado(s)`);
  }

  return { campaignId, jobsQueued: jobIds.length, skippedAlreadyEnrolled: alreadyEnrolled.size, jobIds };
}

module.exports = {
  processPrepare,
  processSend,
  processSync,
  registerAllWorkers,
  requeueStuckScheduledMessages,
  startOutreachCampaign,
  generateOutreachMessage,
  buildOutreachPrompt,
  _templateFallback,
  _enqueueSend,
  getPrisma,
};
