'use strict';

/**
 * studio/experiment-routes.js — endpoints de A/B (US10, T102) + integração
 * da divisão no congelamento (chamado por campaign-service via assignVariant)
 * e política de fadiga/conflito avaliada pelo scheduler.
 */

const { httpError } = require('./errors');
const experimentService = require('./experiment-service');

async function loadExperiment(prisma, orgId, id) {
  const experiment = await prisma.studioExperiment.findUnique({ where: { id } });
  if (!experiment || experiment.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Experimento não encontrado');
  return experiment;
}

function registerExperimentRoutes(router, context) {
  const { prisma } = context;

  // POST /api/studio/campaigns/:id/experiments — cria A/B.
  router.post('/campaigns/:id/experiments', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const body = req.body || {};
      const dimension = body.dimension;
      if (!['subject', 'copy', 'cta', 'send_time', 'channel'].includes(dimension)) {
        throw httpError('INVALID_DIMENSION', 400, `Dimensão inválida: ${dimension}`);
      }
      const split = body.split || {};
      const labels = Object.keys(split);
      if (labels.length < 2) throw httpError('INVALID_SPLIT', 400, 'Informe pelo menos duas variantes com pesos.');

      // Variantes precisam existir como StudioContent (400 MISSING_VARIANT).
      for (const label of labels) {
        const contents = await prisma.studioContent.findMany({
          where: { campaignId: campaign.id, variantLabel: label },
        });
        if (contents.length === 0) {
          throw httpError('MISSING_VARIANT', 400, `Sem conteúdo para a variante ${label}.`);
        }
      }
      const experiment = await prisma.studioExperiment.create({
        data: {
          orgId,
          campaignId: campaign.id,
          dimension,
          split,
          winnerCriterion: body.winnerCriterion || { metric: 'replyRate', minPerVariant: 50, confidence: 0.95 },
          continuousOptimization: Boolean(body.continuousOptimization),
        },
      });
      res.status(201).json({ success: true, data: experiment });
    } catch (err) {
      next(err);
    }
  });

  // GET /experiments/:id — métricas por variante (eventos dos motores).
  router.get('/experiments/:id', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const experiment = await loadExperiment(prisma, orgId, req.params.id);
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: experiment.campaignId } });
      const members = campaign
        ? await prisma.studioAudienceMember.findMany({ where: { campaignId: campaign.id } })
        : [];

      const metrics = {};
      for (const label of Object.keys(experiment.split || {})) {
        const variantMembers = members.filter((m) => m.variantLabel === label);
        const prospectIds = new Set(variantMembers.map((m) => m.prospectId));
        let sent = 0;
        let replies = 0;
        let clicks = 0;
        let opens = 0;
        if (campaign?.emailExecutionId) {
          const contacts = await prisma.outreachContact.findMany({
            where: { campaignId: campaign.emailExecutionId },
          });
          for (const c of contacts) {
            if (!prospectIds.has(c.prospectId)) continue;
            if (['SENT', 'DELIVERED_INFERRED', 'OPENED_INFERRED', 'REPLIED'].includes(c.status)) sent += 1;
            if (c.status === 'REPLIED') replies += 1;
            if (c.status === 'OPENED_INFERRED' || c.status === 'REPLIED') opens += 1;
          }
          const events = await prisma.outreachEvent.findMany({
            where: { type: 'email_opened_inferred' },
          });
          // Cliques via eventos de tracking (quando existirem).
          void events;
          clicks = 0;
        }
        metrics[label] = {
          sent,
          replies,
          clicks,
          opens,
          replyRate: sent ? replies / sent : 0,
          clickRate: sent ? clicks / sent : 0,
          openRate: sent ? opens / sent : 0,
        };
      }

      const criterion = experiment.winnerCriterion || {};
      const verdict = experiment.status === 'running'
        ? experimentService.declareWinner({
            variants: metrics,
            minPerVariant: criterion.minPerVariant ?? 50,
            confidence: criterion.confidence ?? 0.95,
            metric: criterion.metric ?? 'replyRate',
          })
        : { winner: experiment.winnerVariant, significant: true, details: experiment.declaredBasis };
      res.json({ success: true, data: { experiment, metrics, verdict } });
    } catch (err) {
      next(err);
    }
  });

  // POST /experiments/:id/declare-winner — manual ou automática (FR-061).
  router.post('/experiments/:id/declare-winner', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const experiment = await loadExperiment(prisma, orgId, req.params.id);
      const { variant, basis } = req.body || {};
      const updated = await prisma.studioExperiment.update({
        where: { id: experiment.id },
        data: {
          status: 'winner_declared',
          winnerVariant: variant ? String(variant) : null,
          declaredAt: new Date(),
          declaredBasis: basis || { source: 'manual' },
        },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerExperimentRoutes };
