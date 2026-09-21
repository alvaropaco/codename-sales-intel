// =============================================================================
// nats-stream.js — conexão NATS e helpers de stream/consumer compartilhados
// pelo pipeline legado (nats-enrichment.js) e pelo motor distribuído
// (specs/001-distributed-enrichment: enrichment-manager + workers/*).
//
// Extraído de nats-enrichment.js (T004) sem mudança de comportamento legado.
// =============================================================================

const { connect, JSONCodec, headers } = require('nats');

const jc = JSONCodec();

const NATS_URL = process.env.NATS_URL || 'nats://legal-nats.laweragent.svc.cluster.local:4222';
const NATS_STREAM = process.env.NATS_STREAM || 'ENRICHMENT';

// Uma conexão por "cliente" (backend, manager, worker family...) no processo.
const _connections = new Map();

function isNatsEnabled() {
  return String(process.env.NATS_ENABLED || 'true') === 'true';
}

/**
 * Conexão reutilizada por nome de cliente. Reconnect infinito e boot não
 * bloqueante (waitOnFirstConnect=false), como no pipeline legado.
 */
async function connectNats({ name = 'b2base-backend' } = {}) {
  const existing = _connections.get(name);
  if (existing && !existing.isClosed()) return existing;
  try {
    const nc = await connect({
      servers: NATS_URL,
      name,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
      waitOnFirstConnect: false,
    });
    _connections.set(name, nc);
    console.log(`[nats] conectado a ${NATS_URL} (cliente=${name})`);
    return nc;
  } catch (error) {
    _connections.delete(name);
    throw error;
  }
}

/** Garante que o stream existe (idempotente). Usado pelo motor v2. */
async function ensureStream(jsm, { name = NATS_STREAM, subjects = ['enrichment.>'] } = {}) {
  try {
    const info = await jsm.streams.info(name);
    // Stream existente pode não conhecer subjects novos (ex.: discovery.> do
    // motor de discovery) — update ADITIVO e idempotente, nunca remove.
    const current = (info.config && info.config.subjects) || [];
    const missing = subjects.filter((s) => !current.includes(s));
    if (missing.length) {
      await jsm.streams.update(name, { subjects: [...current, ...missing] });
      console.log(`[nats] stream atualizado: ${name} (+${missing.join(', ')})`);
    }
    return false;
  } catch (_e) {
    await jsm.streams.add({ name, subjects, retention: 'limits', storage: 'file' });
    console.log(`[nats] stream criado: ${name} (${subjects.join(', ')})`);
    return true;
  }
}

/**
 * Garante um pull consumer durável (idempotente). Um durable por filter_subject
 * — limitação do JetStream 2.x, mesmo padrão do nats-enrichment.js.
 */
async function ensurePullConsumer(
  jsm,
  { stream = NATS_STREAM, durable, filterSubject, ackWaitMs = 30000, maxDeliver = 5 }
) {
  try {
    await jsm.consumers.info(stream, durable);
    return false;
  } catch (_e) {
    await jsm.consumers.add(stream, {
      durable_name: durable,
      filter_subject: filterSubject,
      ack_policy: 'explicit',
      ack_wait: ackWaitMs * 1000 * 1000, // ms → nanoseconds
      max_deliver: maxDeliver,
    });
    console.log(`[nats] consumer durável criado: ${durable} (filter=${filterSubject})`);
    return true;
  }
}

async function closeAll() {
  for (const [name, nc] of _connections.entries()) {
    try { await nc.drain(); } catch (_e) { /* ignora */ }
    try { await nc.close(); } catch (_e) { /* ignora */ }
    _connections.delete(name);
  }
}

module.exports = {
  jc,
  headers,
  isNatsEnabled,
  connectNats,
  ensureStream,
  ensurePullConsumer,
  closeAll,
  NATS_URL,
  NATS_STREAM,
};
