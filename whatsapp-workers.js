/**
 * whatsapp-workers.js — processadores Bull do canal WhatsApp.
 *
 * Filas (definidas em whatsapp-queues.js):
 *   whatsapp:sequence  — avança uma etapa da sequência de um contato de campanha
 *   whatsapp:send      — envia uma mensagem via WAHA (abstração WhatsAppProvider)
 *
 * Fluxo:
 *   Campaign → Eligible Leads → Sequence Engine → Bull → WhatsApp Worker → WAHA
 *
 * Idempotência: um (campaignContactId, stepIndex) produz no máximo uma mensagem;
 * reentregas/restarts não duplicam envios. O worker nunca processa um contato em
 * estado terminal (REPLIED/OPTED_OUT/CANCELLED/COMPLETED).
 */
const { PrismaClient } = require('@prisma/client');
const { getWhatsAppQueues } = require('./whatsapp-queues');
const { registerProcessor } = require('./outreach-queues');
const { WAHAWhatsAppProvider } = require('./waha-provider');
const { checkLimit, calculateDelay } = require('./whatsapp-rate-limiter');
const { toChatId, normalizePhone, renderTemplate } = require('./whatsapp-utils');
const {
  getOrCreateConversation,
  isContactable,
  CONTACT_STATUS,
  CAMPAIGN_STATUS,
  ACCOUNT_STATUS,
} = require('./whatsapp-engine');
const whatsappNats = require('./whatsapp-nats');

let _prisma = null;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

const wahaProvider = WAHAWhatsAppProvider;

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function loadCampaignContact(prisma, contactId) {
  return prisma.whatsAppCampaignContact.findUnique({
    where: { id: contactId },
    include: { campaign: true },
  });
}

async function loadSteps(prisma, campaignId) {
  return prisma.whatsAppSequenceStep.findMany({
    where: { campaignId },
    orderBy: { orderIndex: 'asc' },
  });
}

async function loadAccount(prisma, accountId) {
  if (!accountId) return null;
  return prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
}

/**
 * Marca a campanha como COMPLETED se todos os contatos terminaram.
 */
async function maybeCompleteCampaign(prisma, campaignId) {
  const active = await prisma.whatsAppCampaignContact.count({
    where: { campaignId, status: { in: ['QUEUED', 'SENDING', 'SENT'] } },
  });
  if (active === 0) {
    await prisma.whatsAppCampaign.update({
      where: { id: campaignId },
      data: { status: CAMPAIGN_STATUS.COMPLETED, completedAt: new Date() },
    });
    await whatsappNats.publishEvent('whatsapp.campaigns.completed', { campaignId });
  }
}

// ─── Queue: whatsapp:sequence ────────────────────────────────────────────────
async function processSequence(job) {
  const { contactId, stepIndex } = job.data;
  const prisma = getPrisma();

  const contact = await loadCampaignContact(prisma, contactId);
  if (!contact) return { skipped: 'contact_not_found' };

  const campaign = contact.campaign;
  const prospectId = contact.prospectId;
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return { skipped: 'prospect_not_found' };

  // Guardas de estado.
  if (campaign.status === CAMPAIGN_STATUS.CANCELLED) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contactId },
      data: { status: CONTACT_STATUS.CANCELLED, cancelReason: 'cancelled' },
    });
    return { skipped: 'campaign_cancelled' };
  }
  if (campaign.status === CAMPAIGN_STATUS.PAUSED) {
    // Re-agenda e aguarda o resume.
    await getWhatsAppQueues().sequence.add(
      { contactId, stepIndex, prospectId, campaignId: campaign.id },
      { delay: 60 * 1000, attempts: 1000 }
    );
    return { paused: true };
  }
  if (campaign.status !== CAMPAIGN_STATUS.RUNNING) {
    return { skipped: `campaign_${campaign.status}` };
  }
  if ([CONTACT_STATUS.REPLIED, CONTACT_STATUS.OPTED_OUT, CONTACT_STATUS.CANCELLED, CONTACT_STATUS.COMPLETED].includes(contact.status)) {
    return { skipped: `contact_${contact.status}` };
  }
  if (!(await isContactable(prisma, { orgId: campaign.orgId, prospectId }))) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contactId },
      data: { status: CONTACT_STATUS.CANCELLED, cancelReason: 'do_not_contact' },
    });
    return { skipped: 'do_not_contact' };
  }

  const account = await loadAccount(prisma, campaign.whatsappAccountId);
  if (!account || account.status !== ACCOUNT_STATUS.CONNECTED) {
    return { skipped: 'account_not_connected' };
  }

  const steps = await loadSteps(prisma, campaign.id);
  if (stepIndex >= steps.length) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contactId },
      data: { status: CONTACT_STATUS.COMPLETED },
    });
    await maybeCompleteCampaign(prisma, campaign.id);
    return { completed: true };
  }

  const step = steps[stepIndex];
  const phoneNumber = normalizePhone(contact.phoneNumber);
  if (!phoneNumber) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contactId },
      data: { status: CONTACT_STATUS.CANCELLED, cancelReason: 'no_phone' },
    });
    return { skipped: 'no_phone' };
  }

  // Idempotência por (campaignContactId, stepIndex): nunca re-envia a etapa.
  const existing = await prisma.whatsAppMessage.findUnique({
    where: { campaignContactId_stepIndex: { campaignContactId: contact.id, stepIndex } },
  });
  if (existing) return { skipped: 'already_exists' };

  // Rate limiting (conta + recipiente).
  const limit = await checkLimit(prisma, { whatsappAccountId: account.id, phoneNumber });
  if (!limit.allowed) {
    await getWhatsAppQueues().sequence.add(
      { contactId, stepIndex, prospectId, campaignId: campaign.id },
      { delay: limit.retryIn || calculateDelay(), attempts: 1000 }
    );
    return { rate_limited: true, retryIn: limit.retryIn };
  }

  const content = renderTemplate(step.messageTemplate, prospect);
  if (!content) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contactId },
      data: { status: CONTACT_STATUS.CANCELLED, cancelReason: 'empty_template' },
    });
    return { skipped: 'empty_template' };
  }

  const conversation = await getOrCreateConversation(prisma, {
    orgId: campaign.orgId,
    whatsappAccountId: account.id,
    phoneNumber,
    prospectId,
  });

  const message = await prisma.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      orgId: campaign.orgId,
      campaignContactId: contact.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content,
      status: 'PENDING',
      stepIndex,
    },
  });

  await prisma.whatsAppCampaignContact.update({
    where: { id: contactId },
    data: { status: CONTACT_STATUS.SENDING, currentStepIndex: stepIndex },
  });

  await getWhatsAppQueues().send.add({ messageId: message.id }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 } });

  return { messageId: message.id, stepIndex };
}

// ─── Queue: whatsapp:send ────────────────────────────────────────────────────
async function processSend(job) {
  const { messageId } = job.data;
  const prisma = getPrisma();

  const message = await prisma.whatsAppMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { whatsappAccount: true } } },
  });
  if (!message) throw new Error(`Mensagem ${messageId} não encontrada`);
  if (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'READ') {
    return { already_sent: true };
  }

  const account = message.conversation.whatsappAccount;
  if (!account || account.status !== ACCOUNT_STATUS.CONNECTED) {
    throw new Error('Conta WhatsApp não conectada');
  }

  // Se o contato entrou em estado terminal, cancela o envio.
  if (message.campaignContactId) {
    const contact = await prisma.whatsAppCampaignContact.findUnique({
      where: { id: message.campaignContactId },
    });
    if (contact && [CONTACT_STATUS.REPLIED, CONTACT_STATUS.OPTED_OUT, CONTACT_STATUS.CANCELLED].includes(contact.status)) {
      await prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED', error: 'contact_terminal_state', failedAt: new Date() },
      });
      return { cancelled: true, reason: contact.status };
    }
  }

  const chatId = toChatId(message.conversation.phoneNumber);
  try {
    const result = await wahaProvider.sendText(account.sessionName, chatId, message.content);
    const now = new Date();

    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        providerMessageId: result.providerMessageId,
        sentAt: now,
        error: null,
      },
    });

    await prisma.whatsAppConversation.update({
      where: { id: message.conversationId },
      data: { lastMessageAt: now },
    });

    if (message.campaignContactId) {
      await prisma.whatsAppCampaignContact.update({
        where: { id: message.campaignContactId },
        data: { status: CONTACT_STATUS.SENT, lastSentAt: now },
      });
    }

    await whatsappNats.publishEvent(whatsappNats.SUBJECTS.MESSAGE_SENT, {
      orgId: message.orgId,
      whatsappAccountId: account.id,
      conversationId: message.conversationId,
      messageId: message.id,
      providerMessageId: result.providerMessageId,
    });

    // Agenda o próximo passo da sequência.
    await scheduleNextStep(prisma, message);

    return { providerMessageId: result.providerMessageId };
  } catch (err) {
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED', error: err.message, failedAt: new Date() },
    });
    await whatsappNats.publishEvent(whatsappNats.SUBJECTS.MESSAGE_FAILED, {
      orgId: message.orgId,
      whatsappAccountId: account.id,
      conversationId: message.conversationId,
      messageId: message.id,
      error: err.message,
    });
    throw err; // Bull re-tenta com backoff
  }
}

async function scheduleNextStep(prisma, message) {
  if (!message.campaignContactId || message.stepIndex == null) return;

  const contact = await loadCampaignContact(prisma, message.campaignContactId);
  if (!contact) return;

  const steps = await loadSteps(prisma, contact.campaignId);
  const nextIndex = message.stepIndex + 1;
  if (nextIndex >= steps.length) {
    await prisma.whatsAppCampaignContact.update({
      where: { id: contact.id },
      data: { status: CONTACT_STATUS.COMPLETED },
    });
    await maybeCompleteCampaign(prisma, contact.campaignId);
    return;
  }

  const delayMinutes = steps[nextIndex].delayMinutes || 0;
  await getWhatsAppQueues().sequence.add(
    {
      contactId: contact.id,
      stepIndex: nextIndex,
      prospectId: contact.prospectId,
      campaignId: contact.campaignId,
    },
    { delay: Math.max(1000, delayMinutes * 60 * 1000), attempts: 1000 }
  );
}

// ─── Campanha ────────────────────────────────────────────────────────────────
async function startCampaign(prisma, { campaignId, prospectIds, orgId }) {
  const campaign = await prisma.whatsAppCampaign.findFirst({
    where: { id: campaignId, orgId },
  });
  if (!campaign) throw new Error('Campanha não encontrada');

  const steps = await loadSteps(prisma, campaign.id);
  if (steps.length === 0) throw new Error('Campanha sem etapas de sequência');

  const account = await loadAccount(prisma, campaign.whatsappAccountId);
  if (!account) throw new Error('Campanha sem conta WhatsApp vinculada');
  if (account.status !== ACCOUNT_STATUS.CONNECTED) {
    throw new Error('Conta WhatsApp não está conectada');
  }

  const owned = await prisma.prospect.findMany({
    where: { id: { in: prospectIds }, orgId },
    select: { id: true, cnpjPhones: true },
  });
  const ownedMap = new Map(owned.map((p) => [p.id, p]));

  const queue = getWhatsAppQueues();
  let queued = 0;

  for (let i = 0; i < prospectIds.length; i++) {
    const prospectId = prospectIds[i];
    const prospect = ownedMap.get(prospectId);
    if (!prospect) continue;

    const phoneNumber = (Array.isArray(prospect.cnpjPhones) && prospect.cnpjPhones[0])
      ? normalizePhone(prospect.cnpjPhones[0])
      : null;

    const contactable = await isContactable(prisma, { orgId, prospectId });

    if (!phoneNumber || !contactable) {
      const cancelReason = !contactable ? 'do_not_contact' : 'no_phone';
      await prisma.whatsAppCampaignContact.upsert({
        where: { campaignId_prospectId: { campaignId, prospectId } },
        create: {
          campaignId,
          prospectId,
          phoneNumber,
          status: CONTACT_STATUS.CANCELLED,
          cancelReason,
        },
        update: {
          status: CONTACT_STATUS.CANCELLED,
          cancelReason,
        },
      });
      continue;
    }

    const contact = await prisma.whatsAppCampaignContact.upsert({
      where: { campaignId_prospectId: { campaignId, prospectId } },
      create: {
        campaignId,
        prospectId,
        phoneNumber,
        status: CONTACT_STATUS.QUEUED,
        currentStepIndex: 0,
      },
      update: {
        phoneNumber,
        status: CONTACT_STATUS.QUEUED,
        currentStepIndex: 0,
        cancelReason: null,
      },
    });

    await queue.sequence.add(
      { contactId: contact.id, stepIndex: 0, prospectId, campaignId },
      { delay: i * 1000, attempts: 1000 }
    );
    queued++;
  }

  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: CAMPAIGN_STATUS.RUNNING, startedAt: new Date(), pausedAt: null, completedAt: null },
  });

  await whatsappNats.publishEvent('whatsapp.campaigns.started', { campaignId, orgId, queued });

  return { campaignId, jobsQueued: queued };
}

async function pauseCampaign(prisma, { campaignId, orgId }) {
  const campaign = await prisma.whatsAppCampaign.findFirst({ where: { id: campaignId, orgId } });
  if (!campaign) throw new Error('Campanha não encontrada');
  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: CAMPAIGN_STATUS.PAUSED, pausedAt: new Date() },
  });
  await whatsappNats.publishEvent('whatsapp.campaigns.paused', { campaignId, orgId });
  return { campaignId, status: CAMPAIGN_STATUS.PAUSED };
}

async function resumeCampaign(prisma, { campaignId, orgId }) {
  const campaign = await prisma.whatsAppCampaign.findFirst({ where: { id: campaignId, orgId } });
  if (!campaign) throw new Error('Campanha não encontrada');
  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: CAMPAIGN_STATUS.RUNNING, pausedAt: null },
  });
  await whatsappNats.publishEvent('whatsapp.campaigns.resumed', { campaignId, orgId });
  return { campaignId, status: CAMPAIGN_STATUS.RUNNING };
}

async function cancelCampaign(prisma, { campaignId, orgId }) {
  const campaign = await prisma.whatsAppCampaign.findFirst({ where: { id: campaignId, orgId } });
  if (!campaign) throw new Error('Campanha não encontrada');

  await prisma.whatsAppCampaignContact.updateMany({
    where: { campaignId, status: { in: ['QUEUED', 'SENDING', 'SENT'] } },
    data: { status: CONTACT_STATUS.CANCELLED, cancelReason: 'cancelled' },
  });
  await prisma.whatsAppCampaign.update({
    where: { id: campaignId },
    data: { status: CAMPAIGN_STATUS.CANCELLED, completedAt: new Date() },
  });
  await whatsappNats.publishEvent('whatsapp.campaigns.cancelled', { campaignId, orgId });
  return { campaignId, status: CAMPAIGN_STATUS.CANCELLED };
}

// ─── Registro dos workers ────────────────────────────────────────────────────
function registerAllWorkers() {
  registerProcessor('whatsapp:sequence', processSequence, 2);
  registerProcessor('whatsapp:send', processSend, 1);
  console.log('[whatsapp] ✓ workers registrados (sequence, send)');
}

module.exports = {
  getPrisma,
  processSequence,
  processSend,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  registerAllWorkers,
};
