/**
 * whatsapp-queues.js — Bull queue factory para os jobs do canal WhatsApp.
 *
 * Reutiliza o mesmo Redis do outreach. Filas:
 *   whatsapp:sequence       — avança uma etapa da sequência de um contato de campanha
 *   whatsapp:send           — envia uma mensagem via WAHA
 *   whatsapp:reengage-scan  — varre conversas frias (agente de reengajamento)
 *   whatsapp:reengage       — gera e dispara o reengajamento de uma conversa
 *
 * Um job de envio é uma unidade de trabalho idempotente: a idempotência real
 * vive na chave (campaignContactId, stepIndex) em WhatsAppMessage + no
 * currentStepIndex de WhatsAppCampaignContact, então reentregas não duplicam.
 */
const { createQueue, redisConfig } = require('./outreach-queues');

const QUEUES = Object.freeze({
  WHATSAPP_SEQUENCE: 'whatsapp:sequence',
  WHATSAPP_SEND: 'whatsapp:send',
  WHATSAPP_REENGAGE_SCAN: 'whatsapp:reengage-scan',
  WHATSAPP_REENGAGE: 'whatsapp:reengage',
});

let _queues = null;

function getWhatsAppQueues() {
  if (!_queues) {
    _queues = {
      sequence: createQueue(QUEUES.WHATSAPP_SEQUENCE),
      send: createQueue(QUEUES.WHATSAPP_SEND),
      reengageScan: createQueue(QUEUES.WHATSAPP_REENGAGE_SCAN),
      reengage: createQueue(QUEUES.WHATSAPP_REENGAGE),
    };
  }
  return _queues;
}

async function closeWhatsAppQueues() {
  if (_queues) {
    await Promise.all([
      _queues.sequence.close(),
      _queues.send.close(),
      _queues.reengageScan.close(),
      _queues.reengage.close(),
    ]);
    _queues = null;
  }
}

module.exports = {
  QUEUES,
  getWhatsAppQueues,
  createQueue,
  redisConfig,
  closeWhatsAppQueues,
};
