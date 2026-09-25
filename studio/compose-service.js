'use strict';

/**
 * studio/compose-service.js — geração e persistência do pacote multicanal
 * (US4 + chat-first). Compartilhado entre o wizard de materiais e o
 * assistente de conversa para que os dois caminhos criem EXATAMENTE os
 * mesmos conteúdos (adaptação real por canal, FR-025/026).
 */

async function generateAndStorePackage(prisma, composer, { campaign, sourceText, tones, orgId, orgContext, origin = 'ai_from_material' }) {
  const created = [];
  for (const tone of tones) {
    const pack = await composer.composeForTone({
      tone,
      sourceText,
      orgContext,
      objective: campaign.objective,
      offer: campaign.offer,
    });
    const variantLabel = String(tone).slice(0, 20);
    if ((campaign.channels || []).includes('email') && pack.email) {
      created.push(
        await prisma.studioContent.create({
          data: {
            orgId,
            campaignId: campaign.id,
            channel: 'email',
            variantLabel,
            kind: 'base',
            stepIndex: 1,
            title: pack.title || null,
            subject: pack.email.subject || null,
            preheader: pack.email.preheader || null,
            emailDoc: { blocks: pack.email.blocks || [] },
            ctaUrl: pack.email?.blocks?.find((b) => b.type === 'button')?.url || null,
            tone,
            origin,
          },
        })
      );
    }
    if ((campaign.channels || []).includes('whatsapp') && pack.whatsapp?.text) {
      created.push(
        await prisma.studioContent.create({
          data: {
            orgId,
            campaignId: campaign.id,
            channel: 'whatsapp',
            variantLabel,
            kind: 'base',
            stepIndex: 1,
            whatsappText: pack.whatsapp.text,
            tone,
            origin,
          },
        })
      );
    }
    if ((campaign.channels || []).includes('linkedin_text') && pack.linkedinText) {
      created.push(
        await prisma.studioContent.create({
          data: {
            orgId,
            campaignId: campaign.id,
            channel: 'linkedin_text',
            variantLabel,
            kind: 'base',
            stepIndex: 1,
            linkedinText: pack.linkedinText,
            tone,
            origin,
          },
        })
      );
    }
  }
  // Pacote cai em revisão — nunca dispara (FR-002).
  if (campaign.status === 'draft') {
    await prisma.studioCampaign.update({
      where: { id: campaign.id },
      data: { status: 'in_review' },
    });
    campaign.status = 'in_review';
  }
  return created;
}

module.exports = { generateAndStorePackage };
