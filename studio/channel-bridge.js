'use strict';

/**
 * studio/channel-bridge.js — compila uma StudioCampaign em execuções de
 * canal nos motores existentes (specs/010, T011; pesquisa D1).
 *
 * O Studio NÃO envia: cria/atualiza `OutreachCampaign` (e-mail) e/ou
 * `WhatsAppCampaign` (WhatsApp) apontadas por `studioCampaignId`, inscreve a
 * audiência congelada nos motores e deixa o envio/tracking/reply para os
 * workers atuais (outreach-workers.js / whatsapp-workers.js).
 */

/**
 * Extrai texto plano de um documento de blocos do editor (naive).
 * US5 substitui pelo renderer MJML — aqui só precisamos de insumo de texto
 * para o template do motor de e-mail.
 */
function emailDocToText(emailDoc) {
  if (!emailDoc) return '';
  const blocks = Array.isArray(emailDoc.blocks) ? emailDoc.blocks : [];
  const out = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      out.push(block);
      continue;
    }
    if (block.text) out.push(block.text);
    else if (block.html) out.push(String(block.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    else if (block.type === 'button' && block.label) out.push(block.label + (block.url ? `: ${block.url}` : ''));
  }
  return out.filter(Boolean).join('\n\n');
}

function contentOriginToEngineSource(contentOrigin) {
  return contentOrigin && String(contentOrigin).startsWith('ai') ? 'ai' : 'manual';
}

/**
 * Cria (ou reusa) a execução de e-mail da campanha Studio.
 * Idempotente por studioCampaignId: aprovar 2× não duplica execuções.
 */
async function ensureEmailExecution(prisma, campaign, content) {
  const existing = campaign.emailExecutionId
    ? await prisma.outreachCampaign.findUnique({ where: { id: campaign.emailExecutionId } })
    : null;
  if (existing) return existing;

  const subject = content?.subject || campaign.name;
  const bodyText = content?.emailDoc
    ? emailDocToText(content.emailDoc)
    : content?.whatsappText || campaign.offer || campaign.objective || '';

  return prisma.outreachCampaign.create({
    data: {
      tenantId: campaign.orgId,
      name: `[Studio] ${campaign.name}`,
      description: campaign.description || null,
      objective: campaign.objective || null,
      offer: campaign.offer || null,
      status: 'draft',
      source: contentOriginToEngineSource(content?.origin),
      channels: ['email'],
      autoActive: false,
      emailTemplateSubject: subject,
      emailTemplateBody: bodyText,
      studioCampaignId: campaign.id,
    },
  });
}

/**
 * Sequência completa do Studio → steps do motor (T067, FR-043/FR-079):
 * toque 1 (base) + followups ordenados por stepIndex, delayDays → minutos.
 */
function compileSteps(baseContent, followupContents = []) {
  const steps = [];
  if (baseContent?.whatsappText) {
    steps.push({
      orderIndex: 1,
      messageTemplate: baseContent.whatsappText,
      aiPersonalized: false,
      delayMinutes: 0,
    });
  }
  const ordered = [...followupContents]
    .filter((c) => c.channel === 'whatsapp' && c.kind === 'followup' && c.whatsappText)
    .sort((a, b) => a.stepIndex - b.stepIndex);
  for (const followup of ordered) {
    steps.push({
      orderIndex: followup.stepIndex,
      messageTemplate: followup.whatsappText,
      aiPersonalized: false,
      delayMinutes: (followup.delayDays ?? 3) * 1440,
    });
  }
  return steps;
}

/**
 * Cria (ou reusa) a execução de WhatsApp da campanha Studio, compilando o
 * toque principal + followups configurados como steps do motor.
 */
async function ensureWhatsAppExecution(prisma, campaign, content, followupContents = []) {
  const existing = campaign.whatsappExecutionId
    ? await prisma.whatsappCampaign.findUnique({ where: { id: campaign.whatsappExecutionId } })
    : null;
  if (existing) return existing;

  const created = await prisma.whatsappCampaign.create({
    data: {
      orgId: campaign.orgId,
      name: `[Studio] ${campaign.name}`,
      objective: campaign.objective || null,
      offer: campaign.offer || null,
      ctaUrl: content?.ctaUrl || null,
      status: 'DRAFT',
      source: contentOriginToEngineSource(content?.origin),
      studioCampaignId: campaign.id,
    },
  });

  for (const step of compileSteps(content, followupContents)) {
    await prisma.whatsappSequenceStep.create({
      data: { campaignId: created.id, ...step },
    });
  }
  return created;
}

/**
 * Inscreve a audiência congelada (membros `included`) nas execuções de canal.
 * Idempotente: re-inscrever o mesmo lead na mesma execução é no-op.
 */
async function enrollAudience(prisma, { snapshot, emailExecution, whatsappExecution }) {
  const members = await prisma.studioAudienceMember.findMany({
    where: { snapshotId: snapshot.id, included: true },
  });
  let enrolled = 0;
  for (const member of members) {
    if (emailExecution) {
      const exists = await prisma.outreachContact.findFirst({
        where: { campaignId: emailExecution.id, prospectId: member.prospectId },
      });
      if (!exists) {
        await prisma.outreachContact.create({
          data: { campaignId: emailExecution.id, prospectId: member.prospectId, status: 'QUEUED' },
        });
        enrolled += 1;
      }
    }
    if (whatsappExecution) {
      const exists = await prisma.whatsappCampaignContact.findFirst({
        where: { campaignId: whatsappExecution.id, prospectId: member.prospectId },
      });
      if (!exists) {
        await prisma.whatsappCampaignContact.create({
          data: { campaignId: whatsappExecution.id, prospectId: member.prospectId, status: 'QUEUED' },
        });
        enrolled += 1;
      }
    }
  }
  return { members: members.length, enrolled };
}

/**
 * Compila a campanha Studio completa em execuções de canal e inscreve a
 * audiência. Usado pelo fluxo de aprovação (US1).
 */
async function compile(prisma, { campaign, contents, snapshot, channels }) {
  const byChannel = new Map((contents || []).map((c) => [c.channel, c]));
  const result = { emailExecution: null, whatsappExecution: null, enrollment: null };

  if (channels.includes('email')) {
    result.emailExecution = await ensureEmailExecution(prisma, campaign, byChannel.get('email'));
  }
  if (channels.includes('whatsapp')) {
    result.whatsappExecution = await ensureWhatsAppExecution(prisma, campaign, byChannel.get('whatsapp'));
  }
  result.enrollment = await enrollAudience(prisma, {
    snapshot,
    emailExecution: result.emailExecution,
    whatsappExecution: result.whatsappExecution,
  });
  return result;
}

module.exports = { compile, ensureEmailExecution, ensureWhatsAppExecution, enrollAudience, emailDocToText, compileSteps };
