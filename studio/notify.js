'use strict';

/**
 * studio/notify.js — notificações operacionais do Studio (T137).
 * Canal: OpsNotification (in-app, modelo existente) — e-mail opt-in entra na
 * onda de polish. Payload sem PII de lead (constituição VII).
 */

const crypto = require('crypto');

async function notify(prisma, { orgId, type, campaignId, severity = 'warning', details = {} }) {
  try {
    const dedupKey = `studio:${type}:${campaignId || 'none'}:${crypto.randomBytes(4).toString('hex')}`;
    await prisma.opsNotification.create({
      data: {
        dedupKey,
        kind: 'digest',
        severity,
        orgId,
        title: type,
        payload: { campaignId, ...details },
        channels: ['in_app'],
      },
    });
  } catch (err) {
    // Notificação não pode quebrar o fluxo principal.
    console.error('[studio:notify] falha ao notificar (ignorado):', err.message);
  }
}

module.exports = { notify };
