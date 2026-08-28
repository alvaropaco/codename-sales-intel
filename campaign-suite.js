/**
 * campaign-suite — disparo multicanal pós-enriquecimento.
 *
 * Quando o enriquecimento de um lead conclui (BrasilAPI síncrono, consumer
 * NATS ou re-enriquecimento via MCP), as campanhas configuradas com
 * trigger=on_enrichment e autoActive disparam os canais selecionados
 * ("email" e/ou "whatsapp") com os templates customizados por canal.
 *
 * Guardas:
 *   - Lead já contatado no canal (qualquer campanha) → não dispara de novo.
 *   - Opt-out por canal (LeadChannelState) é respeitado: email via
 *     SuppressionList/unsubscribed na esteira; whatsapp via isContactable.
 *   - WhatsApp: uma única WhatsAppCampaign "[auto]" é criada por suíte e
 *     reutilizada em todos os disparos (contatos acumulam nela).
 *
 * Sinalização de "contatado": prospect.lastContact + contactedChannels são
 * gravados pelos workers no momento do ENVIO real (não no agendamento).
 */
const { renderTemplate } = require('./whatsapp-utils');

/**
 * Marca o prospect como contatado no canal (chamado pelos workers no envio).
 * Idempotente por canal: não duplica no array, sempre atualiza lastContact.
 */
async function markContacted(prisma, prospectId, channel) {
  if (!['email', 'whatsapp'].includes(channel)) return;
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    select: { contactedChannels: true },
  });
  if (!prospect) return;

  const channels = Array.isArray(prospect.contactedChannels)
    ? prospect.contactedChannels
    : [];
  if (channels.includes(channel)) {
    // canal já sinalizado — só renova o timestamp
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { lastContact: new Date() },
    });
    return;
  }

  await prisma.prospect.update({
    where: { id: prospectId },
    data: { lastContact: new Date(), contactedChannels: [...channels, channel] },
  });
}

/**
 * O lead já foi contatado neste canal em qualquer campanha?
 */
async function isContactedByChannel(prisma, prospectId, channel) {
  if (channel === 'email') {
    const contact = await prisma.outreachContact.findFirst({
      where: { prospectId, status: { notIn: ['CANCELLED'] } },
      select: { id: true },
    });
    return Boolean(contact);
  }
  if (channel === 'whatsapp') {
    const contact = await prisma.whatsAppCampaignContact.findFirst({
      where: { prospectId, status: { notIn: ['CANCELLED', 'OPTED_OUT'] } },
      select: { id: true },
    });
    return Boolean(contact);
  }
  return false;
}

/**
 * Garante a WhatsAppCampaign "[auto]" da suíte (1 passo = template da suíte,
 * delay 0). Criada uma única vez e reutilizada — os leads acumulam como
 * contatos dela, mantendo a lista de campanhas do usuário limpa.
 */
async function ensureAutoWhatsAppCampaign(prisma, suite) {
  if (suite.autoWhatsAppCampaignId) {
    const existing = await prisma.whatsAppCampaign.findUnique({
      where: { id: suite.autoWhatsAppCampaignId },
    });
    if (existing) return existing;
  }

  const campaign = await prisma.whatsAppCampaign.create({
    data: {
      orgId: suite.tenantId,
      name: `[auto] ${suite.name}`,
      whatsappAccountId: suite.whatsappAccountId,
      status: 'RUNNING',
      startedAt: new Date(),
      steps: {
        create: {
          orderIndex: 0,
          messageTemplate: suite.whatsappTemplate || 'Olá {{firstName}}, tudo bem?',
          delayMinutes: 0,
        },
      },
    },
  });

  await prisma.outreachCampaign.update({
    where: { id: suite.id },
    data: { autoWhatsAppCampaignId: campaign.id },
  });
  return campaign;
}

/**
 * Dispara um canal da suíte para um lead recém-enriquecido.
 */
async function triggerChannel(prisma, suite, prospect, channel) {
  if (await isContactedByChannel(prisma, prospect.id, channel)) {
    console.log(`[suite] ${prospect.id} já contatado via ${channel}, pulando (${suite.name})`);
    return { skipped: true, channel };
  }

  if (channel === 'email') {
    if (!suite.emailAccountId || !suite.emailTemplateSubject || !suite.emailTemplateBody) {
      console.warn(`[suite] ${suite.name}: canal email sem conta/template configurados, pulando`);
      return { skipped: true, channel };
    }
    const { startOutreachCampaign } = require('./outreach-workers');
    await startOutreachCampaign(prisma, suite.id, [prospect.id], suite.emailAccountId, null);
    return { queued: true, channel };
  }

  if (channel === 'whatsapp') {
    const whatsappEngine = require('./whatsapp-engine');
    const contactable = await whatsappEngine.isContactable(prisma, {
      orgId: prospect.orgId,
      prospectId: prospect.id,
    });
    if (!contactable) {
      return { skipped: true, channel };
    }

    const waCampaign = await ensureAutoWhatsAppCampaign(prisma, suite);
    const whatsappWorkers = require('./whatsapp-workers');
    await whatsappWorkers.startCampaign(prisma, {
      campaignId: waCampaign.id,
      prospectIds: [prospect.id],
      orgId: suite.tenantId,
    });
    return { queued: true, channel };
  }

  return { skipped: true, channel };
}

/**
 * Hook chamado pelos 3 pontos de conclusão do enriquecimento.
 * Recebe o prospect JÁ persistido com enrichmentStatus concluído.
 * Nunca lança: falhas de suíte não podem derrubar o fluxo de enriquecimento.
 */
async function onLeadEnriched(prisma, prospect) {
  if (!prospect || !prospect.orgId) return { triggered: 0 };

  const suites = await prisma.outreachCampaign.findMany({
    where: {
      tenantId: prospect.orgId,
      trigger: 'on_enrichment',
      autoActive: true,
      status: { notIn: ['paused', 'completed'] },
    },
  });

  const results = [];
  for (const suite of suites) {
    const channels = Array.isArray(suite.channels) ? suite.channels : [];
    for (const channel of channels) {
      try {
        results.push(await triggerChannel(prisma, suite, prospect, channel));
      } catch (err) {
        console.error(`[suite] falha ao disparar ${channel} da campanha "${suite.name}":`, err.message);
        results.push({ error: true, channel, message: err.message });
      }
    }
  }

  if (results.some((r) => r.queued)) {
    console.log(`[suite] lead ${prospect.id} (${prospect.companyName}): disparado pós-enriquecimento`);
  }
  return { triggered: results.filter((r) => r.queued).length, results };
}

/**
 * Render de preview (usado pela UI de configuração para pré-visualizar
 * mensagem de um lead de exemplo). Não consulta nada — só substitui vars.
 */
function previewTemplate(template, lead) {
  return renderTemplate(template, lead || {});
}

module.exports = {
  onLeadEnriched,
  markContacted,
  isContactedByChannel,
  previewTemplate,
};
