'use strict';

/**
 * studio/advanced-routes.js — diferenciais de IA (US14, T129–T132):
 * lookalike (FR-015), follow-up generator (FR-078), next best action +
 * handoff para vendas (FR-075/076) e analista de campanha (FR-077).
 * Toda recomendação é explicável (evidence) e ação externa exige confirmação.
 */

const { httpError } = require('./errors');
const segmentService = require('./segment-service');
const { createWriter } = require('./ai/write');
const { createAnalyst } = require('./ai/analyze');

/** Atributos dominantes dos leads-base → critérios revisáveis + explicação. */
function inferLookalikeCriteria(prospects) {
  const majority = (values) => {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).filter(([v]) => v);
    return sorted.slice(0, 1).map(([v]) => v)[0];
  };
  const states = prospects.map((p) => p.state).filter(Boolean);
  const industries = prospects.map((p) => p.industry).filter(Boolean);
  const avgScore = Math.round(
    prospects.reduce((sum, p) => sum + (p.opportunityScore || 0), 0) / Math.max(prospects.length, 1)
  );
  const conditions = [];
  const rationaleParts = [];
  const state = majority(states);
  if (state) {
    conditions.push({ field: 'state', op: 'equals', value: state });
    rationaleParts.push(`estado dominante: ${state}`);
  }
  const industry = majority(industries);
  if (industry) {
    conditions.push({ field: 'industry', op: 'contains', value: industry });
    rationaleParts.push(`setor dominante: ${industry}`);
  }
  if (avgScore > 0) {
    conditions.push({ field: 'opportunityScore', op: 'gte', value: Math.max(50, avgScore - 15) });
    rationaleParts.push(`score médio dos convertidos: ${avgScore}`);
  }
  return {
    criteria: { version: 1, groups: [{ op: 'AND', conditions }] },
    rationale: rationaleParts.join('; '),
  };
}

function registerAdvancedRoutes(router, context) {
  const { prisma, overrides = {} } = context;
  const aiDeps = overrides.aiDeps || {};
  const writer = createWriter(aiDeps);
  const analyst = createAnalyst(aiDeps);

  // POST /segments/lookalike [premium] — audiência parecida com convertidos.
  router.post('/segments/lookalike', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const sourceProspectIds = (req.body?.sourceProspectIds || []).map(String);
      let base = [];
      if (sourceProspectIds.length > 0) {
        base = await prisma.prospect.findMany({ where: { orgId, id: { in: sourceProspectIds } } });
      } else if (req.body?.sourceSegmentName) {
        // Heurística v1: usa o segmento salvo de mesmo nome como base.
        const segment = (await prisma.studioSegment.findMany({ where: { orgId, name: String(req.body.sourceSegmentName) } }))[0];
        if (segment) {
          base = await prisma.prospect.findMany({ where: segmentService.buildWhere(orgId, segment.criteria) });
        }
      }
      if (base.length < 3) {
        throw httpError('INSUFFICIENT_BASE', 400, 'Poucos leads-base para inferir padrão (mínimo 3).');
      }
      const { criteria, rationale } = inferLookalikeCriteria(base);
      segmentService.validateCriteria(criteria);
      const name = `Lookalike ${new Date().toLocaleDateString('pt-BR')}`;
      const segment = await prisma.studioSegment.create({
        data: { orgId, name, criteria, naturalLanguageInput: req.body?.sourceSegmentName || null, createdBy: req.studio.userId },
      });
      res.status(201).json({ success: true, data: { ...segment, rationale } });
    } catch (err) {
      next(err);
    }
  });

  // POST /contents/:contentId/followup [premium] — follow-up baseado na
  // interação anterior real (FR-078).
  router.post('/contents/:contentId/followup', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const content = await prisma.studioContent.findUnique({ where: { id: req.params.contentId } });
      if (!content || content.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Conteúdo não encontrado');
      const { interaction, prospectId } = req.body || {};
      const result = await writer.suggest({
        kind: 'followup',
        text: content.whatsappText || content.subject || '',
        n: 1,
        interaction: interaction || { note: prospectId ? `ver interações de ${prospectId}` : 'sem interação' },
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  // POST /campaigns/:id/next-best-actions [premium] — NBA por classificação
  // de resposta (FR-075); handoff cria Activity com contexto (FR-076).
  router.post('/campaigns/:id/next-best-actions', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');

      const classifications = await prisma.studioReplyClassification.findMany({
        where: { orgId },
      });
      const created = [];
      for (const cls of classifications.filter((c) => ['interested', 'meeting_request'].includes(c.label))) {
        const rec = await prisma.studioRecommendation.create({
          data: {
            orgId,
            campaignId: campaign.id,
            targetProspectId: cls.prospectId,
            kind: 'handoff',
            rationale: `lead classificado como ${cls.label} (confiança ${(cls.confidence * 100).toFixed(0)}%) — criar tarefa para vendas`,
            evidence: [{ classification: cls.label, confidence: cls.confidence, channel: cls.channel }],
            status: 'proposed',
            requiresConfirmation: true,
          },
        });
        created.push(rec);
      }
      res.status(201).json({ success: true, data: created, count: created.length });
    } catch (err) {
      next(err);
    }
  });

  // POST /recommendations/:id/apply-handoff — cria Activity para vendas.
  router.post('/recommendations/:id/apply-handoff', async (req, res, next) => {
    try {
      const { orgId, userId } = req.studio;
      const rec = await prisma.studioRecommendation.findUnique({ where: { id: req.params.id } });
      if (!rec || rec.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Recomendação não encontrada');
      if (rec.kind !== 'handoff') throw httpError('INVALID_KIND', 400, 'Não é um handoff.');
      if (rec.requiresConfirmation && (req.body || {}).confirm !== true) {
        throw httpError('CONFIRMATION_REQUIRED', 400, 'Handoff exige confirm: true.');
      }
      const activity = await prisma.activity.create({
        data: {
          orgId,
          prospectId: rec.targetProspectId,
          type: 'call',
          description: `Handoff de vendas (Studio): ${rec.rationale}`,
        },
      });
      const updated = await prisma.studioRecommendation.update({
        where: { id: rec.id },
        data: { status: 'applied', appliedAt: new Date() },
      });
      res.json({ success: true, data: { recommendation: updated, activity } });
    } catch (err) {
      next(err);
    }
  });

  // POST /campaigns/:id/ask [premium] — analista de campanha (FR-077).
  router.post('/campaigns/:id/ask', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
      const question = String((req.body || {}).question || '');
      const rows = await prisma.studioMetricDaily.findMany({ where: { campaignId: campaign.id } });
      const summary = rows.map((r) => ({
        day: r.day, sent: r.sent, opens: r.opens, clicks: r.clicks, replies: r.replies,
      }));
      const result = await analyst.analyze({ question, dataSummary: summary, campaignName: campaign.name });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerAdvancedRoutes, inferLookalikeCriteria };
