'use strict';

/**
 * studio/brand-routes.js — endpoints de marca e conformidade (US12, T119):
 * GET/PUT brand, learn [premium], brand-check [premium] e compliance
 * (parecer completo persistido em StudioComplianceReview, FR-073).
 */

const { httpError } = require('./errors');
const compliance = require('./compliance-service');
const { createBrandService } = require('./brand-service');

function registerBrandRoutes(router, context) {
  const { prisma, overrides = {} } = context;
  const aiDeps = overrides.aiDeps || {};
  const brand = createBrandService(prisma, aiDeps);

  // GET /api/studio/brand
  router.get('/brand', async (req, res, next) => {
    try {
      const rows = await prisma.studioBrandProfile.findMany({ where: { orgId: req.studio.orgId } });
      res.json({ success: true, data: rows[0] || { voice: {}, kit: {} } });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/studio/brand — salva voz/kit manualmente.
  router.put('/brand', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const body = req.body || {};
      const rows = await prisma.studioBrandProfile.findMany({ where: { orgId } });
      const data = {
        ...(body.voice ? { voice: body.voice } : {}),
        ...(body.kit ? { kit: body.kit } : {}),
      };
      const saved = rows[0]
        ? await prisma.studioBrandProfile.update({ where: { id: rows[0].id }, data })
        : await prisma.studioBrandProfile.create({ data: { orgId, ...data } });
      res.json({ success: true, data: saved });
    } catch (err) {
      next(err);
    }
  });

  // POST /brand/learn [premium] — aprende voz de samples (FR-070).
  router.post('/brand/learn', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const samples = Array.isArray((req.body || {}).samples) ? req.body.samples.map(String) : [];
      if (samples.length === 0) throw httpError('INVALID_SAMPLES', 400, 'Envie samples de texto da marca.');
      const learned = await brand.learn(req.studio.orgId, { samples });
      res.json({ success: true, data: learned });
    } catch (err) {
      next(err);
    }
  });

  // POST /campaigns/:id/brand-check [premium] — consistência (FR-072).
  router.post('/campaigns/:id/brand-check', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== req.studio.orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const contents = await prisma.studioContent.findMany({ where: { campaignId: campaign.id } });
      const text = contents.map((c) => [c.subject, c.whatsappText, c.linkedinText].filter(Boolean).join('\n')).join('\n');
      const result = await brand.checkConsistency(req.studio.orgId, { text });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /campaigns/:id/compliance — último parecer.
  router.get('/campaigns/:id/compliance', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const reviews = await prisma.studioComplianceReview.findMany({ where: { campaignId: campaign.id } });
      res.json({ success: true, data: reviews[reviews.length - 1] || null });
    } catch (err) {
      next(err);
    }
  });

  // POST /campaigns/:id/compliance — roda parecer completo (FR-073).
  router.post('/campaigns/:id/compliance', async (req, res, next) => {
    try {
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== req.studio.orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const result = await compliance.runFullCompliance(prisma, campaign);
      await prisma.studioCampaign.update({
        where: { id: campaign.id },
        data: { approval: { ...((campaign.approval) || {}), complianceLevel: result.level } },
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerBrandRoutes };
