'use strict';

/**
 * enrichment-notifier.js — notificação de falhas reais do enriquecimento
 * (feature 006, US5/FR-014..017).
 *
 * Canais: Slack (webhook de entrada, alertas em tempo real) + e-mail
 * (transactional-email, digest diário). Dedup durable por `dedupKey` na
 * tabela OpsNotification — alerta repetido NÃO reenvia. Entrega é
 * best-effort: falha de envio é apenas logada (FR-017).
 */

const LEADER_SCOPES = ['task_failed', 'circuit_open', 'park_expired', 'digest'];

function hourBucket(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
}

function todayBucket(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function createEnrichmentNotifier({
  prisma,
  redis = null,
  webhookUrl = process.env.SLACK_WEBHOOK_URL || null,
  sendSlack = null,
  sendEmail = null,
  alertEmailTo = process.env.ALERT_EMAIL_TO || null,
  logger = console,
} = {}) {
  if (!prisma) throw new Error('enrichment-notifier: prisma é obrigatório');

  const defaultSendSlack = async (payload) => {
    if (!webhookUrl) return { skipped: true, reason: 'no_webhook' };
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
    return { ok: true };
  };

  const defaultSendEmail = async ({ to, subject, text }) => {
    if (!to) return { skipped: true, reason: 'no_recipient' };
    const { sendOpsEmail } = require('./transactional-email');
    return sendOpsEmail({ to, subject, text });
  };

  const slack = sendSlack || defaultSendSlack;
  const email = sendEmail || defaultSendEmail;

  /** Registra (dedup) + entrega best-effort. Retorna { delivered, slackSkipped }. */
  async function notify({ dedupKey, kind, severity = 'warning', orgId = null, title, payload = {}, channels = ['slack'] }) {
    let row;
    try {
      row = await prisma.opsNotification.create({
        data: { dedupKey, kind, severity, orgId, title, payload, channels },
      });
    } catch (err) {
      // dedup: dedupKey já existe → alerta repetido, não reenvia (FR-015)
      logger.warn(`[notifier] dedup (${dedupKey}): ${err.message}`);
      return { delivered: false, duplicated: true };
    }
    let delivered = false;
    if (channels.includes('slack')) {
      try {
        await slack({ text: title, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${formatDetails(payload)}` } }] });
        delivered = true;
      } catch (err) {
        logger.warn(`[notifier] slack falhou (${dedupKey}): ${err.message}`);
      }
    }
    try {
      await prisma.opsNotification.update({
        where: { dedupKey },
        data: { deliveredAt: delivered ? new Date() : row.createdAt },
      });
    } catch (_e) { /* best-effort */ }
    return { delivered, slackSkipped: !channels.includes('slack') };
  }

  function formatDetails(payload) {
    return Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `*${k}:* ${String(v)}`)
      .join('\n');
  }

  /** Falha real: task terminal não-transiente (FR-005/FR-014). */
  async function notifyTaskFailed(info) {
    const dedupKey = `task_failed:${info.taskId}`;
    const title = '🔴 Enriquecimento: falha real';
    const payload = {
      Org: info.orgId, Lead: info.companyName || info.prospectId || info.taskId,
      Capability: info.capability, Erro: `${info.errorType} — ${info.message || ''}`,
      Provedor: info.provider || '—',
    };
    try {
      await prisma.opsNotification.create({
        data: { dedupKey, kind: 'task_failed', severity: 'critical', orgId: info.orgId, title, payload, channels: ['slack', 'email'] },
      });
    } catch (err) {
      logger.warn(`[notifier] dedup (${dedupKey}): ${err.message}`);
      return { delivered: false, duplicated: true };
    }
    let slackSkipped = true;
    let delivered = false;
    try {
      const r = await slack({ text: title, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${formatDetails(payload)}` } }] });
      slackSkipped = Boolean(r && r.skipped);
      delivered = !slackSkipped;
    } catch (err) {
      logger.warn(`[notifier] slack falhou (${dedupKey}): ${err.message}`);
    }
    try {
      await prisma.opsNotification.update({
        where: { dedupKey },
        data: { deliveredAt: delivered ? new Date() : null },
      });
    } catch (_e) { /* best-effort */ }
    return { delivered, slackSkipped };
  }

  /** Circuito de provedor aberto > 1h — alerta único por hora (FR-015). */
  async function notifyCircuitOpen({ provider, affected }) {
    const dedupKey = `circuit:${provider}:${hourBucket(new Date())}`;
    return notify({
      dedupKey,
      kind: 'circuit_open',
      severity: 'warning',
      title: `🟠 Enriquecimento: circuito de ${provider} aberto há mais de 1h`,
      payload: { Provedor: provider, 'Tasks afetadas': affected },
      channels: ['slack'],
    });
  }

  /** Park expirou a janela longa → falha real (FR-006). */
  async function notifyParkExpired(info) {
    const dedupKey = `park_expired:${info.taskId}`;
    return notify({
      dedupKey,
      kind: 'park_expired',
      severity: 'critical',
      orgId: info.orgId,
      title: '🔴 Enriquecimento: task desistiu após a janela de retry',
      payload: { Task: info.taskId, Capability: info.capability, Provedor: info.provider, 'Horas aguardando': info.parkedForHours },
      channels: ['slack', 'email'],
    });
  }

  /**
   * Digest diário (FR-016): agregados por organização via e-mail.
   * `aggregates` = { completed24h, failedByReason, parkedOldest, successRate }.
   */
  async function sendDailyDigest(aggregates) {
    const dedupKey = `digest:${todayBucket(new Date())}`;
    const title = '📬 Digest diário do enriquecimento';
    const lines = [
      `Concluídas (24h): ${aggregates.completed24h ?? 0}`,
      `Taxa de sucesso: ${Math.round((aggregates.successRate ?? 0) * 100)}%`,
      'Falhas por motivo: ' + JSON.stringify(aggregates.failedByReason || {}),
      'Parked mais antigas: ' + (aggregates.parkedOldest || []).map((p) => `${p.companyName} (${p.hours}h)`).join('; '),
    ];
    const payload = { detalhes: lines.join(' | ') };
    try {
      await prisma.opsNotification.create({
        data: { dedupKey, kind: 'digest', severity: 'info', title, payload, channels: ['email'] },
      });
    } catch (err) {
      logger.warn(`[notifier] dedup (${dedupKey}): ${err.message}`);
      return { sent: false, duplicated: true };
    }
    if (!email) {
      logger.warn('[notifier] sem canal de e-mail — digest não enviado');
      return { sent: false, skipped: true };
    }
    const result = await email({ to: alertEmailTo, subject: `${title} — ${todayBucket(new Date())}`, text: lines.join('\n') });
    const sent = result ? result.sent !== false : true;
    if (sent) {
      await prisma.opsNotification.update({ where: { dedupKey }, data: { deliveredAt: new Date() } });
    }
    return { sent, result };
  }

  return { notify, notifyTaskFailed, notifyCircuitOpen, notifyParkExpired, sendDailyDigest };
}

module.exports = { createEnrichmentNotifier };
