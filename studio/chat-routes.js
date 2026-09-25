'use strict';

/**
 * studio/chat-routes.js — conversa de criação de campanha (chat-first).
 *
 * POST /campaigns/:id/chat {message} → executa o orquestrador e as ações
 * nos serviços reais (segmento, compose, agenda, materiais), persiste a
 * conversa e devolve {reply, cards}. GET devolve o histórico.
 *
 * URLs coladas na mensagem viram materiais automaticamente (contexto para
 * os agentes). Anexos de arquivo usam POST /materials e o materialId é
 * referenciado na conversa.
 */

const { httpError } = require('./errors');
const { createChatAgent } = require('./ai/chat-agent');
const { createComposer } = require('./ai/compose');
const { createExtractor } = require('./ai/extract');
const { generateAndStorePackage } = require('./compose-service');
const segmentService = require('./segment-service');
const campaignService = require('./campaign-service');
const { createMaterialService } = require('./material-service');
const scheduleService = require('./schedule-service');

const URL_RE = /(https?:\/\/[^\s,;)"]+)/g;

async function loadCampaign(prisma, orgId, id) {
  const campaign = await prisma.studioCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Campanha não encontrada');
  return campaign;
}

async function currentExtras(prisma, campaign) {
  const snapshotRows = await prisma.studioAudienceSnapshot.findMany({
    where: { campaignId: campaign.id, status: 'active' },
  });
  const contents = await prisma.studioContent.findMany({
    where: { campaignId: campaign.id, kind: 'base', stepIndex: 1 },
  });
  const materials = await prisma.studioMaterial.findMany({
    where: { orgId: campaign.orgId },
  });
  return {
    audienceCount: snapshotRows[0]?.includedCount ?? null,
    contentSummary: contents.map((c) => ({ channel: c.channel, tone: c.tone, subject: c.subject || c.whatsappText?.slice(0, 60) || null })),
    materials: materials.slice(0, 5).map((m) => ({
      id: m.id, kind: m.kind, status: m.extractionStatus, confirmed: Boolean(m.confirmedAt),
      product: m.extraction?.product || null,
    })),
  };
}

function registerChatRoutes(router, context) {
  const { prisma, overrides = {} } = context;
  const aiDeps = overrides.aiDeps || {};
  const chatAgent = createChatAgent(aiDeps);
  const composer = createComposer(aiDeps);
  const materialService = createMaterialService(prisma, aiDeps);

  async function runAction(action, { campaign, cards, orgId, userId }) {
    const label = { detail: '' };
    switch (action.type) {
      case 'set_objective': {
        await prisma.studioCampaign.update({
          where: { id: campaign.id },
          data: {
            objective: action.objective ? String(action.objective).slice(0, 2000) : campaign.objective,
            offer: action.offer ? String(action.offer).slice(0, 2000) : campaign.offer,
          },
        });
        campaign.objective = action.objective || campaign.objective;
        return { type: 'objective', label: 'Objetivo definido', detail: String(action.objective || '') };
      }

      case 'set_audience': {
        const segmentNl = require('./ai/segment-nl').createSegmentNl(aiDeps);
        const { criteria, rationale } = await segmentNl.fromPrompt(String(action.description || ''));
        const where = segmentService.buildWhere(orgId, criteria);
        const prospects = await prisma.prospect.findMany({ where });
        const { snapshot } = await campaignService.flow.materializeAudience(prisma, {
          campaign,
          prospectIds: prospects.map((p) => p.id),
        });
        await prisma.studioSegment.create({
          data: {
            orgId,
            name: `Audiência ${new Date().toLocaleDateString('pt-BR')} — ${String(action.description || '').slice(0, 60)}`,
            criteria,
            naturalLanguageInput: String(action.description || ''),
            createdBy: userId,
          },
        });
        return {
          type: 'audience',
          label: 'Audiência montada',
          detail: `${snapshot.includedCount} leads incluídos (${snapshot.excludedCount} excluídos por segurança) — ${rationale || criteriaDescription(criteria)}`,
        };
      }

      case 'attach_url': {
        const material = await materialService.createMaterial({ orgId, userId, url: String(action.url) });
        await materialService.runExtraction(material);
        const updated = await prisma.studioMaterial.findUnique({ where: { id: material.id } });
        const ex = updated.extraction || {};
        return {
          type: 'material',
          label: 'Material anexado e extraído',
          detail: `Produto: ${ex.product || '—'} · Oferta: ${ex.offer || '—'} · Público: ${ex.audience || '—'}. Confere? Posso gerar o conteúdo com isso.`,
          materialId: updated.id,
        };
      }

      case 'confirm_material': {
        const material = await prisma.studioMaterial.findUnique({ where: { id: String(action.materialId) } });
        if (!material || material.orgId !== orgId) throw httpError('NOT_FOUND', 404, 'Material não encontrado');
        await materialService.confirmExtraction(material, {});
        return { type: 'material_confirmed', label: 'Extração confirmada', detail: 'Material pronto como fonte de conteúdo.' };
      }

      case 'generate_content': {
        await context.requirePremiumOrg(orgId);
        // Fonte: material confirmado da conversa ou o objetivo/oferta da campanha.
        const materials = await prisma.studioMaterial.findMany({ where: { orgId } });
        const confirmed = materials.find((m) => m.confirmedAt && m.extractionStatus === 'extracted');
        const sourceText = confirmed
          ? JSON.stringify(confirmed.extraction)
          : [campaign.objective, campaign.offer].filter(Boolean).join(' — ') || campaign.name;
        const tones = (Array.isArray(action.tones) && action.tones.length ? action.tones : ['formal', 'comercial']).slice(0, 3);
        const settings = await prisma.commercialSettings.findUnique({ where: { orgId } });
        const created = await generateAndStorePackage(prisma, composer, {
          campaign,
          sourceText,
          tones,
          orgId,
          orgContext: settings ? `${settings.companyName || ''} vende ${settings.productDescription || '?'}` : null,
        });
        return {
          type: 'content',
          label: 'Conteúdo gerado (em revisão)',
          detail: `${created.length} variações criadas: ${tones.join(', ')} — revise na lista de conteúdos abaixo.`,
        };
      }

      case 'set_schedule': {
        const windows = Array.isArray(action.windows) ? action.windows : [];
        for (const w of windows) {
          const daysOk = Array.isArray(w.days) && w.days.every((d) => d >= 1 && d <= 7);
          if (!daysOk || !(w.startHour >= 0 && w.startHour < 24 && w.endHour > w.startHour && w.endHour <= 24)) {
            throw httpError('INVALID_WINDOW', 400, 'Janela de envio inválida.');
          }
        }
        const schedule = {
          mode: action.mode === 'immediate' ? 'immediate' : 'scheduled',
          startAt: action.startAt || null,
          windows,
          hourlyLimit: Number(action.hourlyLimit) || 5,
          dailyLimit: Number(action.dailyLimit) || 30,
          timezone: action.timezone || 'America/Sao_Paulo',
          useLeadTimezone: Boolean(action.useLeadTimezone),
        };
        const data = { schedule };
        // Campanha aprovada + modo agendado → transita para "scheduled".
        if (campaign.status === 'approved' && schedule.mode === 'scheduled') {
          campaignService.assertTransition(campaign.status, 'scheduled');
          data.status = 'scheduled';
        }
        const updated = await prisma.studioCampaign.update({ where: { id: campaign.id }, data });
        Object.assign(campaign, updated);
        const forecast = scheduleService.forecast(schedule, (await currentExtras(prisma, campaign)).audienceCount || 0);
        return {
          type: 'schedule',
          label: 'Agendamento configurado',
          detail: `${schedule.hourlyLimit}/h · ${schedule.dailyLimit}/dia${
            schedule.windows.length ? ` · janelas ${schedule.windows.map((w) => `${w.startHour}h–${w.endHour}h`).join(', ')}` : ''
          }${forecast.estimatedAt ? ` · conclusão prevista ${new Date(forecast.estimatedAt).toLocaleString('pt-BR')}` : ''}`,
        };
      }

      case 'none':
      default:
        return null;
    }
  }

  function criteriaDescription(criteria) {
    return (criteria?.groups || [])
      .flatMap((g) => g.conditions || [])
      .map((c) => `${c.field} ${c.op} ${Array.isArray(c.value) ? c.value.join('/') : c.value}`)
      .join(' E ');
  }

  // POST /campaigns/:id/chat — conversa (síncrona; orquestrador + ações).
  router.post('/campaigns/:id/chat', async (req, res, next) => {
    try {
      const { orgId, userId } = req.studio;
      const campaign = await loadCampaign(prisma, orgId, req.params.id);
      const message = String((req.body || {}).message || '').trim();
      if (!message) throw httpError('INVALID_MESSAGE', 400, 'Mensagem vazia.');

      // URLs coladas viram materiais automaticamente (contexto dos agentes).
      const urls = [...message.matchAll(URL_RE)].map((m) => m[1]).slice(0, 3);
      const autoAttachCards = [];
      for (const url of urls) {
        const result = await runAction({ type: 'attach_url', url }, { campaign, cards: autoAttachCards, orgId, userId });
        if (result) autoAttachCards.push(result);
      }

      const history = await prisma.studioChatMessage.findMany({
        where: { campaignId: campaign.id },
      });
      const userMessage = await prisma.studioChatMessage.create({
        data: {
          orgId,
          campaignId: campaign.id,
          role: 'user',
          text: message,
          attachments: urls.map((url) => ({ kind: 'url', url })),
        },
      });

      const extras = await currentExtras(prisma, campaign);
      const { reply, actions } = await chatAgent.orchestrate({
        campaign,
        history: [...history, userMessage],
        userMessage: message,
        extras,
      });

      const cards = [...autoAttachCards];
      for (const action of actions) {
        try {
          const card = await runAction(action, { campaign, cards, orgId, userId });
          if (card) cards.push(card);
        } catch (err) {
          // Ação falha não derruba a conversa — vira card de erro.
          cards.push({ type: 'error', label: `Ação "${action.type}" falhou`, detail: err.message });
        }
      }

      const assistantMessage = await prisma.studioChatMessage.create({
        data: { orgId, campaignId: campaign.id, role: 'assistant', text: reply, cards },
      });

      res.json({ success: true, data: { reply, cards, campaignStatus: campaign.status } });
    } catch (err) {
      next(err);
    }
  });

  // GET /campaigns/:id/chat — histórico da conversa.
  router.get('/campaigns/:id/chat', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await loadCampaign(prisma, orgId, req.params.id);
      const data = await prisma.studioChatMessage.findMany({
        where: { campaignId: campaign.id },
      });
      data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // GET /campaigns/:id/state — estado consolidado para o painel lateral.
  router.get('/campaigns/:id/state', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await loadCampaign(prisma, orgId, req.params.id);
      res.json({ success: true, data: { campaign, extras: await currentExtras(prisma, campaign) } });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerChatRoutes };
