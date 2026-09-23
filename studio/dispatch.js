'use strict';

/**
 * studio/dispatch.js — disparo imediato de uma campanha Studio aprovada.
 *
 * Delega aos motores existentes (outreach-workers / whatsapp-workers). Em
 * testes o router injeta `overrides.dispatchImmediate` — BullMQ não roda na
 * suíte. Contas de envio: auto-seleciona a primeira conta conectada da org
 * (padrão v1 para orgs single-account); o id usado fica auditado em
 * `campaign.approval.executionConfig`.
 */

async function autoSelectEmailAccount(prisma, orgId) {
  const account = await prisma.emailAccount.findFirst({
    where: { tenantId: orgId, status: 'connected' },
  });
  if (!account) {
    const err = new Error('Nenhuma conta de e-mail conectada na organização.');
    err.code = 'NO_EMAIL_ACCOUNT';
    err.status = 409;
    throw err;
  }
  return account;
}

async function autoSelectWhatsAppAccount(prisma, orgId) {
  const account = await prisma.whatsappAccount.findFirst({
    where: { orgId, status: 'CONNECTED' },
  });
  if (!account) {
    const err = new Error('Nenhuma conta WhatsApp conectada na organização.');
    err.code = 'NO_WHATSAPP_ACCOUNT';
    err.status = 409;
    throw err;
  }
  return account;
}

/**
 * Dispara a campanha aprovada para os leads incluídos do snapshot.
 * `overrides.startOutreachCampaign` / `overrides.startWhatsAppCampaign`
 * substituem os motores em teste.
 */
async function dispatchImmediate(prisma, { campaign, compiled, userId, overrides = {} }) {
  const channels = campaign.channels || [];
  const snapshot = compiled.snapshot;
  const members = await prisma.studioAudienceMember.findMany({
    where: { snapshotId: snapshot.id, included: true },
  });
  const prospectIds = members.map((m) => m.prospectId);
  const result = { prospectIds, email: null, whatsapp: null, executionConfig: {} };

  if (channels.includes('email') && compiled.emailExecution) {
    const account = await autoSelectEmailAccount(prisma, campaign.orgId);
    result.executionConfig.emailAccountId = account.id;
    const start = overrides.startOutreachCampaign;
    if (start) {
      // Injetado (testes): assinatura igual ao motor real.
      result.email = await start(prisma, compiled.emailExecution.id, prospectIds, account.id, userId);
    } else {
      const workers = require('../outreach-workers');
      result.email = await workers.startOutreachCampaign(
        prisma,
        compiled.emailExecution.id,
        prospectIds,
        account.id,
        userId
      );
    }
  }

  if (channels.includes('whatsapp') && compiled.whatsappExecution) {
    const account = await autoSelectWhatsAppAccount(prisma, campaign.orgId);
    result.executionConfig.whatsappAccountId = account.id;
    await prisma.whatsappCampaign.update({
      where: { id: compiled.whatsappExecution.id },
      data: { whatsappAccountId: account.id },
    });
    const start = overrides.startWhatsAppCampaign;
    if (start) {
      result.whatsapp = await start(prisma, {
        campaignId: compiled.whatsappExecution.id,
        prospectIds,
        orgId: campaign.orgId,
      });
    } else {
      const workers = require('../whatsapp-workers');
      result.whatsapp = await workers.startCampaign(prisma, {
        campaignId: compiled.whatsappExecution.id,
        prospectIds,
        orgId: campaign.orgId,
      });
    }
  }

  return result;
}

module.exports = { dispatchImmediate, autoSelectEmailAccount, autoSelectWhatsAppAccount };
