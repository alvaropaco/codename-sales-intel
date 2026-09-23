'use strict';

/**
 * studio/segment-routes.js — CRUD e preview de segmentos salvos (US2, T026).
 * A validação dos critérios é feita pelo catálogo fechado do
 * segment-service (nunca SQL de usuário). Preview atualiza `lastCount` e
 * reporta o delta desde o último uso (FR-009).
 */

const segmentService = require('./segment-service');
const { httpError } = require('./errors');

async function loadOrgSegment(prisma, orgId, id) {
  const segment = await prisma.studioSegment.findUnique({ where: { id } });
  if (!segment || segment.orgId !== orgId) {
    throw httpError('NOT_FOUND', 404, 'Segmento não encontrado');
  }
  return segment;
}

function registerSegmentRoutes(router, context) {
  const { prisma } = context;
  const aiDeps = () => (context.overrides || {}).aiDeps || {};

  // POST /api/studio/segments/preview-nl [premium] — NL → critérios editáveis
  // (FR-014; antecipado por dependência do agente US9/T091).
  router.post('/segments/preview-nl', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const prompt = String((req.body || {}).prompt || '').trim();
      if (!prompt) throw httpError('INVALID_PROMPT', 400, 'Descreva o público desejado.');
      const segmentNl = require('./ai/segment-nl').createSegmentNl(aiDeps());
      const result = await segmentNl.fromPrompt(prompt);
      // Não salva — devolve para revisão/edição do usuário (FR-014).
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/studio/segments — cria segmento salvo.
  router.post('/segments', async (req, res, next) => {
    try {
      const { orgId, userId } = req.studio;
      const body = req.body || {};
      if (!body.name || !String(body.name).trim()) {
        throw httpError('INVALID_NAME', 400, 'Nome do segmento é obrigatório.');
      }
      segmentService.validateCriteria(body.criteria);
      const segment = await prisma.studioSegment.create({
        data: {
          orgId,
          name: String(body.name).trim().slice(0, 200),
          description: body.description ? String(body.description).slice(0, 2000) : null,
          criteria: body.criteria,
          naturalLanguageInput: body.naturalLanguageInput ? String(body.naturalLanguageInput) : null,
          createdBy: userId,
        },
      });
      res.status(201).json({ success: true, data: segment });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/studio/segments — lista com última contagem.
  router.get('/segments', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const data = await prisma.studioSegment.findMany({ where: { orgId } });
      res.json({ success: true, data, count: data.length });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/studio/segments/:id — edita nome/descrição/critérios.
  router.patch('/segments/:id', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const segment = await loadOrgSegment(prisma, orgId, req.params.id);
      const body = req.body || {};
      const data = {};
      if (body.name != null) data.name = String(body.name).trim().slice(0, 200);
      if (body.description != null) data.description = String(body.description).slice(0, 2000);
      if (body.criteria != null) {
        segmentService.validateCriteria(body.criteria);
        data.criteria = body.criteria;
      }
      const updated = await prisma.studioSegment.update({ where: { id: segment.id }, data });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/studio/segments/:id — remove (snapshots passivos ficam).
  router.delete('/segments/:id', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const segment = await loadOrgSegment(prisma, orgId, req.params.id);
      await prisma.studioSegment.deleteMany({ where: { id: segment.id, orgId } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/studio/segments/:id/preview — contagem + amostra + delta.
  router.post('/segments/:id/preview', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const segment = await loadOrgSegment(prisma, orgId, req.params.id);
      const where = segmentService.buildWhere(orgId, segment.criteria);
      const count = await prisma.prospect.count({ where });
      const sample = await prisma.prospect.findMany({
        where,
        take: Number(req.body?.sampleLimit) || 50,
      });
      const delta = segment.lastCount == null ? null : count - segment.lastCount;
      await prisma.studioSegment.update({
        where: { id: segment.id },
        data: { lastCount: count, lastCountAt: new Date() },
      });
      res.json({
        success: true,
        data: {
          count,
          delta,
          previousCount: segment.lastCount ?? null,
          sample: sample.map((p) => ({
            id: p.id,
            companyName: p.companyName,
            state: p.state,
            industry: p.industry,
            opportunityScore: p.opportunityScore,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerSegmentRoutes, loadOrgSegment };
