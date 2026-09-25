'use strict';

/**
 * studio/agent-routes.js — AI Campaign Agent (US9, T092–T094) e
 * recomendações. Propor é assíncrono (202 + inline v1); decisão é item a
 * item; conversão cria campanha `origin=agent` em REVISÃO — o agente não
 * dispara nunca (FR-058). Recomendações com efeito externo exigem
 * `confirm: true` (FR-059).
 */

const { httpError } = require('./errors');

function registerAgentRoutes(router, context) {
  const { prisma, overrides = {} } = context;
  const aiDeps = overrides.aiDeps || {};

  // POST /api/studio/agent/propose [premium] — plano completo em linguagem natural.
  router.post('/agent/propose', async (req, res, next) => {
    try {
      await context.requirePremiumOrg(req.studio.orgId);
      const { orgId } = req.studio;
      const prompt = String((req.body || {}).prompt || '').trim();
      if (!prompt) throw httpError('INVALID_PROMPT', 400, 'Descreva o objetivo da campanha.');

      // Status "planning": o plano é montado assíncrono (inline v1) — o front
      // faz polling até "proposed" (pronto) ou "failed" (plan.error).
      const proposal = await prisma.studioAgentProposal.create({
        data: { orgId, requestPrompt: prompt, status: 'planning', plan: {}, items: [] },
      });
      // Execução inline (v1): chama segment-nl + compose por IA e monta o plano.
      void (async () => {
        try {
          const callLlm = aiDeps.callLlm || require('../llm-client').callLlm;
          const { createExtractor } = require('./ai/extract');
          const { createComposer } = require('./ai/compose');
          void createExtractor;
          const composer = createComposer({ callLlm });
          const segmentAi = require('./ai/segment-nl').createSegmentNl({ callLlm });

          const audience = await segmentAi.fromPrompt(prompt);
          const pack = await composer.composeForTone({
            tone: 'comercial',
            sourceText: prompt,
            orgContext: null,
          });
          const plan = {
            audience: { criteria: audience.criteria, rationale: audience.rationale },
            strategy: { channels: ['email', 'whatsapp'], timing: pack.timing || 'dias úteis, 9h–11h' },
            contents: [
              { channel: 'email', subject: pack.email?.subject, blocks: pack.email?.blocks || [] },
              { channel: 'whatsapp', text: pack.whatsapp?.text },
            ],
            tracking: { utmSource: 'studio', utmMedium: 'agent', utmCampaign: 'agente' },
          };
          await prisma.studioAgentProposal.update({
            where: { id: proposal.id },
            data: { plan, status: 'proposed' },
          });
        } catch (err) {
          console.error('[studio:agent] falha ao montar plano:', err.message);
          await prisma.studioAgentProposal.update({
            where: { id: proposal.id },
            data: { plan: { error: err.message }, status: 'failed' },
          });
        }
      })();
      res.status(202).json({ success: true, data: { proposalId: proposal.id } });
    } catch (err) {
      next(err);
    }
  });

  // GET /agent/proposals/:id
  router.get('/agent/proposals/:id', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const proposal = await prisma.studioAgentProposal.findUnique({ where: { id: req.params.id } });
      if (!proposal || proposal.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Proposta não encontrada');
      res.json({ success: true, data: proposal });
    } catch (err) {
      next(err);
    }
  });

  // POST /agent/proposals/:id/decide — decisão item a item + conversão.
  router.post('/agent/proposals/:id/decide', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const proposal = await prisma.studioAgentProposal.findUnique({ where: { id: req.params.id } });
      if (!proposal || proposal.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Proposta não encontrada');
      if (proposal.status !== 'proposed') throw httpError('INVALID_TRANSITION', 409, 'Proposta já decidida.');

      const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
      const plan = proposal.plan || {};
      const contents = items.some((i) => i.key === 'contents' && i.decision !== 'rejected')
        ? plan.contents || []
        : [];

      const updated = await prisma.studioAgentProposal.update({
        where: { id: proposal.id },
        data: { items, status: 'decided' },
      });

      // Conversão (apenas com confirm): cria campanha em in_review SEM disparar.
      if ((req.body || {}).confirm === true) {
        const audienceAccepted = !items.some((i) => i.key === 'audience' && i.decision === 'rejected');
        const criteria = audienceAccepted ? plan.audience?.criteria : null;
        const campaign = await prisma.studioCampaign.create({
          data: {
            orgId,
            name: `Agente — ${proposal.requestPrompt.slice(0, 60)}`,
            objective: proposal.requestPrompt,
            channels: plan.strategy?.channels || ['email'],
            origin: 'agent',
            status: 'in_review',
            approval: { agent: { proposalId: proposal.id, audienceAccepted } },
          },
        });
        // Conteúdos aceitos viram StudioContent (sempre em revisão — FR-058).
        for (const c of contents) {
          if (c.channel === 'email') {
            await prisma.studioContent.create({
              data: {
                orgId,
                campaignId: campaign.id,
                channel: 'email',
                kind: 'base',
                stepIndex: 1,
                subject: c.subject || null,
                emailDoc: { blocks: c.blocks || [] },
                origin: 'ai',
              },
            });
          }
          if (c.channel === 'whatsapp') {
            await prisma.studioContent.create({
              data: {
                orgId,
                campaignId: campaign.id,
                channel: 'whatsapp',
                kind: 'base',
                stepIndex: 1,
                whatsappText: c.text || null,
                origin: 'ai',
              },
            });
          }
        }
        void criteria;
        const converted = await prisma.studioAgentProposal.update({
          where: { id: proposal.id },
          data: { status: 'converted', campaignId: campaign.id },
        });
        return res.json({ success: true, data: converted, campaignId: campaign.id });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // GET /campaigns/:id/recommendations?status=proposed
  router.get('/campaigns/:id/recommendations', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const where = { orgId, campaignId: req.params.id };
      if (req.query.status) where.status = String(req.query.status);
      const data = await prisma.studioRecommendation.findMany({ where });
      res.json({ success: true, data, count: data.length });
    } catch (err) {
      next(err);
    }
  });

  // POST /recommendations/:id/decide — aplicar (com confirmação) ou rejeitar.
  router.post('/recommendations/:id/decide', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const rec = await prisma.studioRecommendation.findUnique({ where: { id: req.params.id } });
      if (!rec || rec.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Recomendação não encontrada');
      const { decision, confirm } = req.body || {};
      if (decision === 'apply') {
        if (rec.requiresConfirmation && confirm !== true) {
          throw httpError('CONFIRMATION_REQUIRED', 400, 'Recomendação com efeito externo exige confirm: true.');
        }
        const updated = await prisma.studioRecommendation.update({
          where: { id: rec.id },
          data: { status: 'applied', appliedAt: new Date() },
        });
        return res.json({ success: true, data: updated });
      }
      if (decision === 'reject') {
        const updated = await prisma.studioRecommendation.update({
          where: { id: rec.id },
          data: { status: 'rejected' },
        });
        return res.json({ success: true, data: updated });
      }
      throw httpError('INVALID_ACTION', 400, `Decisão inválida: ${decision}`);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerAgentRoutes };
