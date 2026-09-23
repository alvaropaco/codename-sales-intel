'use strict';

/**
 * studio/template-routes.js — banco de templates por objetivo (T060; CRUD
 * completo na US13). GET lista sementes do sistema + templates da org.
 */

const { httpError } = require('./errors');

const OBJECTIVES = ['prospection', 'launch', 'promotion', 'newsletter', 'event', 'reactivation', 'nurturing'];
const FUNNEL_STAGES = ['top', 'middle', 'bottom'];

function registerTemplateRoutes(router, context) {
  const { prisma, overrides = {} } = context;

  // GET /api/studio/templates?objective=&funnelStage=
  router.get('/templates', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const where = {};
      if (req.query.objective) where.objective = String(req.query.objective);
      if (req.query.funnelStage) where.funnelStage = String(req.query.funnelStage);
      // Sistema (sementes) + templates da própria org — isolamento garantido.
      const templates = await prisma.studioTemplate.findMany({
        where: { ...where, OR: [{ isSystem: true }, { orgId }] },
      });
      res.json({ success: true, data: templates, count: templates.length });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/studio/templates/seed — instala sementes do sistema (boot/admin).
  router.post('/templates/seed', async (req, res, next) => {
    try {
      if (!overrides.allowSeed) {
        throw httpError('FORBIDDEN', 403, 'Seed disponível apenas no boot/admin.');
      }
      const seeds = overrides.seeds || [];
      for (const seed of seeds) {
        if (!OBJECTIVES.includes(seed.objective) || !FUNNEL_STAGES.includes(seed.funnelStage)) continue;
        await prisma.studioTemplate.upsert({
          where: { id: seed.id },
          create: { ...seed, isSystem: true },
          update: { content: seed.content, subject: seed.subject },
        });
      }
      res.json({ success: true, data: { seeded: seeds.length } });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerTemplateRoutes, OBJECTIVES };
