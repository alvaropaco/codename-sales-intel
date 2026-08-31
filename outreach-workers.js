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
 * Generate outreach email content using the existing LiteLLM gateway
 * connected to a local quantized model (Qwen, Llama, etc).
 */
async function generateOutreachMessage(prisma, { lead, seq = 1 }) {
  const litellmUrl = process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmModel = process.env.LITELLM_MODEL || 'qwen/qwen2.5-7b-instruct';

  // Fetch org commercial profile for value proposition context
  let valueProp = '';
  try {
    const settings = await prisma.commercialSettings.findFirst({
      where: { orgId: lead.orgId },
      select: { valueProposition: true },
    });
    valueProp = settings?.valueProposition || '';
  } catch (_) {
    // skip
  }

  const prompt = [
    `Você é um assistente de vendas B2B do B2Base. Escreva um email frio em português brasileiro.`,
    ``,
    `DADOS DO PROSPECTO:`,
    `- Empresa: ${lead.companyName}${lead.tradeName ? ` (${lead.tradeName})` : ''}`,
    `- Segmento: ${lead.industry || 'N/A'}`,
    `- Localização: ${lead.city ? [lead.city, lead.state].filter(Boolean).join('/') : 'N/A'}`,
    `- Colaboradores: ${lead.employees || 'N/A'}`,
    `- Faturamento estimado: R$ ${(lead.revenueEstimate || 0).toLocaleString('pt-BR')}`,
    valueProp ? `- Nossa proposta de valor: ${valueProp}` : '',
    ``,
    `REGRA: Use apenas fatos presentes nos dados acima. Não invente informações.`,
    ``,
    `Retorne SOMENTE JSON válido:`,
    `{`,
    `  "subject": "Assunto curto (máx 60 caracteres)",`,
    `  "body": "Corpo em texto plano",`,
    `  "htmlBody": "Corpo HTML com pixel de tracking: <img src=\"https://b2base.net/t/o/{tracking-token}.gif\" width=\"1\" height=\"1\">",`,
    `  "reasoning_facts": ["fato1", "fato2"]`,
    `}`,
  ].join('\n');

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
            content: 'Você é um assistente de vendas B2B. Responda APENAS com JSON válido.',
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

    return {
      subject: parsed.subject || 'Uma oportunidade para ' + lead.companyName,
      body: parsed.body || '',
      htmlBody: parsed.htmlBody || '',
      reasoningFacts: parsed.reasoning_facts || [],
    };
  } catch (err) {
    console.error('[outreach] AI generation failed, using template fallback:', err.message);

    return _templateFallback(lead, valueProp);
  }
}

/**
 * Template-based fallback when AI is unavailable.
 */
function _templateFallback(lead, valueProp) {
  const vp = valueProp || 'encontrar e qualificar leads com mais eficiência';
  const body = `Olá,\n\nEspero que esteja bem!\n\nConheço a ${lead.companyName} e sei que empresas do segmento ${lead.industry || 'de negócios'} costumam enfrentar desafios na identificação de oportunidades.\n\nNossa plataforma de inteligência de dados ajuda times comerciais a ${vp}.\n\nGostaria de agendar uma conversa rápida de 15 min para apresentar como funciona?\n\nAbs.,\nEquipe B2Base`;

  const html = `<p>Olá,</p><p>Espero que esteja bem!</p><p>Conheço a <strong>${lead.companyName}</strong> e sei que empresas do segmento <em>${lead.industry || 'de negócios'}</em> costumam enfrentar desafios na identificação de oportunidades.</p><p>Nossa plataforma de inteligência de dados ajuda times comerciais a ${vp}.</p><p>Gostaria de agendar uma conversa rápida de 15 min para apresentar como funciona?</p><p>Abraços,<br/>Equipe B2Base</p><img src="https://b2base.net/t/o/{tracking-token}.gif" width="1" height="1" alt="" />`;

  return {
    subject: `Uma oportunidade para ${lead.companyName}`,
    body,
    htmlBody: html,
    reasoningFacts: [`Referência a ${lead.companyName}`, `Segmento: ${lead.industry || 'geral'}`],
  };
}

// ─── QUEUE: outreach:prepare ──────────────────────────────────────
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
    select: { outreachSequence: true },
  });

  const nextSequence = Math.max(existing?.outreachSequence || 0, followupSequence || 1);

  // Upsert outreach_contact
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

  // Check if contact already sent → skip
  if (contact.status === 'SENT' || contact.status === 'REPLIED') {
    console.log(`[prepare] contact ${contact.id} already ${contact.status}, skipping`);
    return { skipped: true, contactId: contact.id };
  }

  // Conteúdo: template custom da campanha (suíte multicanal) quando
  // configurado; senão geração via IA com fallback de template.
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  let generated;
  if (campaign?.emailTemplateSubject && campaign?.emailTemplateBody) {
    const { renderTemplate } = require('./whatsapp-utils');
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
    generated = await generateOutreachMessage(prisma, { lead, seq: contact.outreachSequence });
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
  await sendQueue.add(
    { messageId: message.id },
    { delay: delaySeconds * 1000, attempts: 3, backoff: { type: 'exponential', delay: 60 * 1000 } }
  );

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
      },
    },
  });

  console.log(`[prepare] ✓ message ${message.id} scheduled (token: ${trackingToken})`);
  return { messageId: message.id, contactId: contact.id };
}

// ─── QUEUE: outreach:message-send ─────────────────────────────────
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
    const { createQueue } = require('./outreach-queues');
    const sendQueue = createQueue('outreach:message-send', {
      redis: process.env.REDIS_URL?.replace('redis://', '') || 'localhost:6379',
    });
    await sendQueue.add({ messageId }, { delay: rateLimit.retryIn });
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
    await prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: 'FAILED', error: 'No recipient email found' },
    });
    throw new Error('No recipient email found');
  }

  // Build MIME and send (provider-agnostic: gmail OAuth, SMTP ou Resend)
  const messageIdHeader = crypto.randomUUID();
  const result = await sendEmailForAccount(prisma, message.contact.emailAccount_id, {
    to: recipientEmail,
    subject: message.subject,
    body: message.body,
    htmlBody: message.htmlBody,
    messageId: messageIdHeader,
  });

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

  const queue = createQueue('outreach:prepare');
  const jobIds = [];

  for (let i = 0; i < prospectIds.length; i++) {
    const job = await queue.add(
      {
        prospectId: prospectIds[i],
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

  return { campaignId, jobsQueued: jobIds.length, jobIds };
}

module.exports = {
  processPrepare,
  processSend,
  processSync,
  registerAllWorkers,
  startOutreachCampaign,
  generateOutreachMessage,
  getPrisma,
};
