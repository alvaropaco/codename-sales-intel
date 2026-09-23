'use strict';

/**
 * studio/scheduler-worker.js — coração do agendamento do Studio (T034).
 *
 * Repeat job BullMQ (60s): varre campanhas `scheduled|running` e libera
 * lotes para os motores DENTRO da janela de envio e do ritmo configurado
 * (FR-017/FR-018), respeitando startAt futuro (FR-016) e o guard-rails da
 * automação opt-in (clarify Q1). Contas de envio: rate limiters globais
 * existentes continuam como última barreira (FR-019, pesquisa D5).
 *
 * `tickCampaign` é injetável (enqueue capturado) — a suíte roda sem Redis.
 */

const scheduleService = require('./schedule-service');
const guardrails = require('./guardrails');
const { autoSelectEmailAccount } = require('./dispatch');
const metrics = require('../metrics');

/**
 * Um tick de uma campanha. Retorna `{ released, skipped?, reason? }`.
 * `enqueue(channel, prospectIds)` é injetado (prod: enfileira nos motores).
 */
async function tickCampaign(prisma, campaign, { now = new Date(), enqueue, overrides = {} } = {}) {
  const schedule = campaign.schedule || {};

  // 1) Agendamento futuro: nada antes do startAt (FR-016).
  if (schedule.startAt && new Date(schedule.startAt) > now) {
    return { released: 0, skipped: 'not_started' };
  }

  // 2) Guard-rails da automação opt-in: 1º lote exige aprovação (clarify Q1).
  if (await guardrails.hasPendingFirstBatch(prisma, campaign)) {
    return { released: 0, skipped: 'first_batch_pending' };
  }

  // 3) Janela de envio (fuso da org ou do lead — FR-017/FR-022).
  if (!scheduleService.inWindow(schedule, now)) {
    return { released: 0, skipped: 'outside_window' };
  }

  // 4) Ritmo: cotas por hora/dia (FR-018). Contagens a partir dos envios
  // reais registrados nas execuções de canal.
  const hourStart = new Date(Math.floor(now.getTime() / 3600_000) * 3600_000);
  const dayStart = scheduleService.startOfDayInTz(now, schedule.timezone || scheduleService.DEFAULT_TZ);
  let quota = schedule.hourlyLimit != null ? schedule.hourlyLimit : null;
  if (schedule.dailyLimit != null && campaign.emailExecutionId) {
    const sentToday = await prisma.outreachContact.count({
      where: { campaignId: campaign.emailExecutionId, sentAt: { gte: dayStart } },
    });
    quota = quota == null ? schedule.dailyLimit - sentToday : Math.min(quota, schedule.dailyLimit - sentToday);
  }
  if (quota != null && quota <= 0) {
    return { released: 0, skipped: 'daily_or_hourly_quota' };
  }

  let released = 0;

  // Política de fadiga (FR-063): leads com N toques na janela saem do lote.
  async function applyFatigueFilter(candidates) {
    const policy = (campaign.fallbackPolicy || {}).fatigue;
    if (!policy?.maxTouches || !policy?.windowDays) return candidates;
    const windowStart = new Date(now.getTime() - policy.windowDays * 86_400_000);
    const recent = await prisma.outreachContact.findMany({
      where: { prospectId: { in: candidates.map((c) => c.prospectId) }, sentAt: { gte: windowStart } },
    });
    const counts = new Map();
    for (const row of recent) {
      counts.set(row.prospectId, (counts.get(row.prospectId) || 0) + 1);
    }
    return candidates.filter((c) => {
      const touches = counts.get(c.prospectId) || 0;
      if (touches >= policy.maxTouches) return false; // adiado para próximo tick
      return true;
    });
  }

  // 5) E-mail: libera lote da fila (QUEUED e ainda não liberado).
  if (campaign.emailExecutionId) {
    const pendingRaw = await prisma.outreachContact.findMany({
      where: { campaignId: campaign.emailExecutionId, status: 'QUEUED', scheduledAt: null },
    });
    const pending = await applyFatigueFilter(pendingRaw);
    const batch = quota == null ? pending.slice(0, 50) : pending.slice(0, quota);
    if (batch.length > 0) {
      for (const contact of batch) {
        await prisma.outreachContact.update({
          where: { id: contact.id },
          data: { scheduledAt: now },
        });
      }
      const ids = batch.map((c) => c.prospectId);
      if (overrides.enqueue) {
        await overrides.enqueue('email', ids);
      } else {
        await enqueue('email', ids);
      }
      released += batch.length;
      metrics.incStudioSendsEnqueued('email', batch.length);
      if (quota != null) quota -= batch.length;
    }
  }

  // 6) WhatsApp: mesma lógica, marcador `nextSendAt`.
  if (campaign.whatsappExecutionId && (quota == null || quota > 0)) {
    const pending = await prisma.whatsappCampaignContact.findMany({
      where: { campaignId: campaign.whatsappExecutionId, status: 'QUEUED', nextSendAt: null },
    });
    const batch = quota == null ? pending.slice(0, 50) : pending.slice(0, quota);
    if (batch.length > 0) {
      for (const contact of batch) {
        await prisma.whatsappCampaignContact.update({
          where: { id: contact.id },
          data: { nextSendAt: now },
        });
      }
      const ids = batch.map((c) => c.prospectId);
      if (overrides.enqueue) {
        await overrides.enqueue('whatsapp', ids);
      } else {
        await enqueue('whatsapp', ids);
      }
      released += batch.length;
      metrics.incStudioSendsEnqueued('whatsapp', batch.length);
    }
  }

  // 7) Guard-rails pós-lote: anomalia pausa com motivo (clarify Q1).
  const verdict = await guardrails.evaluateAnomaly(prisma, campaign);
  if (verdict.paused) {
    metrics.incStudioGuardrailPause('anomaly');
    return { released, anomalyPaused: true, reason: verdict.reason };
  }

  return { released, skipped: released === 0 ? 'empty_queue' : undefined };
}

/**
 * Liberação real (produção): enfileira nos motores existentes com a conta
 * auto-selecionada da org (padrão v1 — ver studio/dispatch.js).
 */
function makeProdEnqueue(prisma, campaign, userId) {
  return async function enqueue(channel, prospectIds) {
    if (channel === 'email' && campaign.emailExecutionId) {
      const account = await autoSelectEmailAccount(prisma, campaign.orgId);
      const workers = require('../outreach-workers');
      await workers.startOutreachCampaign(prisma, campaign.emailExecutionId, prospectIds, account.id, userId);
      return;
    }
    if (channel === 'whatsapp' && campaign.whatsappExecutionId) {
      const workers = require('../whatsapp-workers');
      await workers.startCampaign(prisma, {
        campaignId: campaign.whatsappExecutionId,
        prospectIds,
        orgId: campaign.orgId,
      });
    }
  };
}

/** Tick global: varre campanhas elegíveis (usado pelo repeat job de 60s). */
async function tickAll(prisma, { now = new Date(), userId } = {}) {
  const campaigns = await prisma.studioCampaign.findMany({
    where: { status: 'running' },
  });
  const results = [];
  for (const campaign of campaigns) {
    try {
      const result = await tickCampaign(prisma, campaign, {
        now,
        enqueue: makeProdEnqueue(prisma, campaign, userId),
      });
      results.push({ campaignId: campaign.id, ...result });
    } catch (err) {
      console.error('[studio:scheduler] falha no tick da campanha', campaign.id, err.message);
      results.push({ campaignId: campaign.id, error: err.message });
    }
  }
  return results;
}

/**
 * Registro do repeat job de 60s (produção). Sem Redis/BullMQ nos testes —
 * a suíte chama `tickCampaign`/`tickAll` diretamente.
 */
function registerStudioScheduler(prisma) {
  try {
    const { createQueue } = require('../outreach-queues');
    const queue = createQueue('studio:scheduler');
    const Worker = require('bull').Worker || null; // Bull v4: process no queue
    void Worker;
    queue
      .add('tick', {}, { repeat: { every: 60_000 }, jobId: 'studio-scheduler-tick' })
      .then(() => console.log('[studio:scheduler] ✓ repeat job registrado (60s)'))
      .catch((err) => console.error('[studio:scheduler] falha ao registrar repeat job', err.message));

    queue.process(async () => {
      const result = await tickAll(prisma, { userId: null });
      const released = result.reduce((sum, r) => sum + (r.released || 0), 0);
      if (released > 0) console.log(`[studio:scheduler] ${released} lead(s) liberado(s)`);
      return result;
    });
    return queue;
  } catch (err) {
    console.error('[studio:scheduler] registro indisponível:', err.message);
    return null;
  }
}

module.exports = { tickCampaign, tickAll, registerStudioScheduler, makeProdEnqueue };
