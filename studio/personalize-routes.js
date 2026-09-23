'use strict';

/**
 * studio/personalize-routes.js — personalização com IA por lead (US7, T076).
 * Lote via ai-batch (progresso/pausa), preview por lead, edição isolada com
 * opção de propagar regra (FR-048–FR-051).
 */

const { createBatchRunner } = require('./ai-batch');
const { createPersonalizer } = require('./ai/personalize');
const { httpError } = require('./errors');
const { renderTemplate } = require('./variables');

function registerPersonalizeRoutes(router, context) {
  const { prisma, overrides = {} } = context;
  const aiDeps = overrides.aiDeps || {};
  const personalizer = createPersonalizer(aiDeps);

  // Handler do lote: um item = um lead (execução inline v1 + progresso).
  context.batchHandlers = context.batchHandlers || {};
  const metrics = require('../metrics');
  context.batchHandlers.personalize = async (item, ctx) => {
    try {
      return await personalizeOne(item, ctx);
    } catch (err) {
      metrics.incStudioAiBatchItem('personalize', 'error');
      throw err;
    }
  };
  async function personalizeOne(item, ctx) {
    const { contentId, prospectId, level } = item;
    const lead = await prisma.prospect.findUnique({ where: { id: prospectId } });
    const result = await personalizer.personalizeLead({
      lead: lead || {},
      level: level || 'intro',
      orgContext: ctx.orgContext,
    });
    const existing = await prisma.studioPersonalization.findMany({
      where: { contentId, prospectId },
    });
    const data = result.skip
      ? { status: 'base_fallback' }
      : {
          status: 'generated',
          overrides: { intro: result.intro, valueProp: result.valueProp, cta: result.cta },
          dataBasis: result.dataBasis || [],
        };
    if (existing.length > 0) {
      await prisma.studioPersonalization.update({ where: { id: existing[0].id }, data });
    } else {
      await prisma.studioPersonalization.create({
        data: { orgId: ctx.orgId, contentId, prospectId, ...data },
      });
    }
    const outcome = data.status === 'base_fallback' ? 'fallback' : 'ok';
    metrics.incStudioAiBatchItem('personalize', outcome);
    return { prospectId, status: data.status };
  };

  async function loadContent(orgId, contentId) {
    const content = await prisma.studioContent.findUnique({ where: { id: contentId } });
    if (!content || content.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Conteúdo não encontrado');
    return content;
  }

  // POST /campaigns/:id/personalize [premium] — 202 + polling (FR-048).
  router.post('/campaigns/:id/personalize', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const { contentId, level = 'intro', prospectIds } = req.body || {};
      const content = await loadContent(orgId, contentId);

      // Audiência congelada (ou lista explícita para prévia).
      const snapshotRows = await prisma.studioAudienceSnapshot.findMany({
        where: { campaignId: campaign.id, status: 'active' },
      });
      const snapshot = snapshotRows[0];
      const members = snapshot
        ? await prisma.studioAudienceMember.findMany({ where: { snapshotId: snapshot.id, included: true } })
        : [];
      const targets = (Array.isArray(prospectIds) && prospectIds.length
        ? prospectIds.map((id) => ({ prospectId: String(id) }))
        : members
      ).slice(0, 2000);
      if (targets.length === 0) throw httpError('EMPTY_AUDIENCE', 409, 'Audiência vazia.');

      const settings = await prisma.commercialSettings.findUnique({ where: { orgId } });
      const orgContext = settings
        ? `${settings.companyName || ''} vende ${settings.productDescription || '?'}`
        : null;

      const batchId = await context.batchRunner.createBatch(
        'personalize',
        targets.map((t) => ({ prospectId: t.prospectId, contentId: content.id, level })),
        { orgId, orgContext }
      );
      res.status(202).json({ success: true, data: { batchId, total: targets.length } });
    } catch (err) {
      next(err);
    }
  });

  // GET /campaigns/:id/personalization-preview — amostra real (FR-049).
  router.get('/campaigns/:id/personalization-preview', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const contentId = String(req.query.contentId || '');
      const content = await loadContent(orgId, contentId);
      const limit = Math.min(Number(req.query.sample) || 10, 50);

      const snapshotRows = await prisma.studioAudienceSnapshot.findMany({
        where: { campaignId: campaign.id, status: 'active' },
      });
      const snapshot = snapshotRows[0];
      const members = snapshot
        ? await prisma.studioAudienceMember.findMany({ where: { snapshotId: snapshot.id, included: true } })
        : [];

      const baseText = content.whatsappText || content.subject || 'Mensagem base';
      const data = [];
      for (const member of members.slice(0, limit)) {
        const prospect = await prisma.prospect.findUnique({ where: { id: member.prospectId } });
        const personalizations = await prisma.studioPersonalization.findMany({
          where: { contentId: content.id, prospectId: member.prospectId },
        });
        const p = personalizations[0];
        const intro = p?.overrides?.intro;
        const rendered = intro ? `${renderTemplate(intro, prospect || {})}\n${baseText}` : renderTemplate(baseText, prospect || {});
        data.push({
          prospectId: member.prospectId,
          companyName: prospect?.companyName || null,
          status: p?.status || 'pending',
          rendered,
        });
      }
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /personalization/:contentId/:prospectId — edição por lead (FR-050).
  router.patch('/personalization/:contentId/:prospectId', async (req, res, next) => {
    try {
      const { orgId, userId } = req.studio;
      const { contentId, prospectId } = req.params;
      await loadContent(orgId, contentId);
      const body = req.body || {};
      const existing = await prisma.studioPersonalization.findMany({
        where: { contentId, prospectId },
      });
      const data = {
        overrides: { ...(body.overrides || {}) },
        status: 'edited',
        editedById: userId,
        ...(body.propagate ? { propagatedRule: body.propagate } : {}),
      };
      if (existing.length > 0) {
        const updated = await prisma.studioPersonalization.update({
          where: { id: existing[0].id },
          data,
        });
        return res.json({ success: true, data: updated });
      }
      const created = await prisma.studioPersonalization.create({
        data: { orgId, contentId, prospectId, ...data },
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerPersonalizeRoutes };
