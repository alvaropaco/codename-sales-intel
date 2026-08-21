/**
 * whatsapp-queues.js — Bull queue factory para os jobs do canal WhatsApp.
 *
 * Reutiliza o mesmo Redis do outreach. Filas:
 *   whatsapp:sequence  — avança uma etapa da sequência de um contato de campanha
 *   whatsapp:send      — envia uma mensagem via WAHA
 *
 * Um job de envio é uma unidade de trabalho idempotente: a idempotência real
 * vive na chave (campaignContactId, stepIndex) em WhatsAppMessage + no
 * currentStepIndex de WhatsAppCampaignContact, então reentregas não duplicam.
 */
const { createQueue, redisConfig } = require('./outreach-queues');

const QUEUES = Object.freeze({
  WHATSAPP_SEQUENCE: 'whatsapp:sequence',
  WHATSAPP_SEND: 'whatsapp:send',
});

let _queues = null;

function getWhatsAppQueues() {
  if (!_queues) {
    _queues = {
      sequence: createQueue(QUEUES.WHATSAPP_SEQUENCE),
      send: createQueue(QUEUES.WHATSAPP_SEND),
    };
  }
  return _queues;
}

async function closeWhatsAppQueues() {
  if (_queues) {
    await Promise.all([_queues.sequence.close(), _queues.send.close()]);
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
