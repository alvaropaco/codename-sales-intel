/**
 * whatsapp-nats.js — barramento de eventos do canal WhatsApp via NATS JetStream.
 *
 * Segue o mesmo padrão de nats-enrichment.js:
 *   - publish best-effort (não quebra o request HTTP se o NATS cair);
 *   - consumer durável com ACK somente após processar (nak() em erro);
 *   - entrega at-least-once → processamento idempotente no consumidor.
 *
 * Subjects (internos):
 *   whatsapp.message.received
 *   whatsapp.message.sent
 *   whatsapp.message.delivered
 *   whatsapp.message.failed
 *   whatsapp.session.connected
 *   whatsapp.session.disconnected
 *   whatsapp.optouts
 *   whatsapp.human_handoffs
 */
const { connect, JSONCodec } = require('nats');

const jc = JSONCodec();

const NATS_URL = process.env.NATS_URL || 'nats://127.0.0.1:4222';
const STREAM = process.env.WHATSAPP_NATS_STREAM || 'WHATSAPP';
const DURABLE = process.env.WHATSAPP_NATS_DURABLE || 'b2base-whatsapp';
const SUBJECT_PREFIX = 'whatsapp.';
const ACK_WAIT_S = parseInt(process.env.WHATSAPP_NATS_ACK_WAIT_S || '30', 10);
const BATCH = parseInt(process.env.WHATSAPP_NATS_BATCH || '20', 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.WHATSAPP_NATS_FETCH_TIMEOUT_MS || '5000', 10);

const SUBJECTS = Object.freeze({
  MESSAGE_RECEIVED: 'whatsapp.message.received',
  MESSAGE_SENT: 'whatsapp.message.sent',
  MESSAGE_DELIVERED: 'whatsapp.message.delivered',
  MESSAGE_FAILED: 'whatsapp.message.failed',
  SESSION_CONNECTED: 'whatsapp.session.connected',
  SESSION_DISCONNECTED: 'whatsapp.session.disconnected',
  OPTOUT: 'whatsapp.optouts',
  HUMAN_HANDOFF: 'whatsapp.human_handoffs',
});

let _nc = null;
let _consumerRunning = false;

function isEnabled() {
  return String(process.env.NATS_ENABLED || 'false') === 'true';
}

async function connectNats() {
  if (_nc && !_nc.isClosed()) return _nc;
  try {
    _nc = await connect({
      servers: NATS_URL,
      name: 'b2base-whatsapp',
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
      waitOnFirstConnect: false,
    });
    console.log(`[whatsapp:nats] conectado a ${NATS_URL}`);
    return _nc;
  } catch (err) {
    _nc = null;
    throw err;
  }
}

/**
 * Publica um evento interno. Best-effort: nunca lança para o chamador.
 */
async function publishEvent(subject, payload) {
  if (!isEnabled()) return null;
  try {
    const nc = await connectNats();
    await nc.publish(subject, jc.encode(payload || {}));
    return true;
  } catch (err) {
    console.error(`[whatsapp:nats] falha ao publicar ${subject}: ${err.message}`);
    return null;
  }
}

/**
 * Inicia o consumidor durável que processa eventos `whatsapp.>`.
 * @param {object} prisma
 * @param {Function} handler async(payload) — processa e, se lançar, o evento é
 *   reentregue (nak).
 */
async function startConsumer(prisma, handler) {
  if (!isEnabled()) {
    console.log('[whatsapp:nats] consumidor desabilitado (NATS_ENABLED=false).');
    return;
  }

  try {
    const nc = await connectNats();
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();

    // Garante o stream (cria se não existir).
    try {
      await jsm.streams.info(STREAM);
    } catch (_e) {
      await jsm.streams.add({ name: STREAM, subjects: [`${SUBJECT_PREFIX}>`] });
      console.log(`[whatsapp:nats] stream criado: ${STREAM}`);
    }

    // Garante o consumer durável.
    try {
      await jsm.consumers.info(STREAM, DURABLE);
    } catch (_e) {
      await jsm.consumers.add(STREAM, {
        durable_name: DURABLE,
        ack_policy: 'explicit',
        ack_wait: ACK_WAIT_S * 1000 * 1000 * 1000,
        max_deliver: 5,
      });
      console.log(`[whatsapp:nats] consumer criado: ${DURABLE}`);
    }

    _consumerRunning = true;
    console.log(`[whatsapp:nats] consumindo ${SUBJECT_PREFIX}> (durável=${DURABLE})`);

    (async function consumeLoop() {
      while (_consumerRunning) {
        try {
          const info = await jsm.consumers.info(STREAM, DURABLE);
          const consumer = js.consumers.getPullConsumerFor(info);
          const msgs = await consumer.fetch({ max_messages: BATCH, expires: FETCH_TIMEOUT_MS });
          for await (const m of msgs) {
            const subject = m.subject;
            try {
              const payload = jc.decode(m.data);
              await handler({ subject, payload });
              await m.ack();
            } catch (err) {
              console.error(`[whatsapp:nats] erro ao processar ${subject}: ${err.message}`);
              try { await m.nak(); } catch (_e) { /* ignora */ }
            }
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (!/(timeout|nothing|404)/i.test(msg)) {
            console.error(`[whatsapp:nats] erro no loop: ${msg}`);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();
  } catch (err) {
    console.error(`[whatsapp:nats] falha ao iniciar consumidor: ${err.message}`);
  }
}

async function shutdown() {
  _consumerRunning = false;
  if (_nc) {
    try { await _nc.drain(); } catch (_e) { /* ignora */ }
    try { await _nc.close(); } catch (_e) { /* ignora */ }
    _nc = null;
  }
}

module.exports = {
  isEnabled,
  connectNats,
  publishEvent,
  startConsumer,
  shutdown,
  SUBJECTS,
  STREAM,
  DURABLE,
};
