// =============================================================================
// logger.js — logs estruturados JSON com correlação (spec US8 / FR-035).
//
// Toda linha carrega os bindings do contexto (orgId, jobId, taskId, capability,
// traceparent...) para diagnosticar sem acesso a dados de cliente (constituição
// VII). Sem dependências: emite JSON por console; nível por LOG_LEVEL.
// =============================================================================

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel() {
  const lvl = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[lvl] ? lvl : 'info';
}

function emit(level, bindings, msg) {
  if (LEVELS[level] < LEVELS[activeLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    ...bindings,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(line));
}

/** Cria um logger com bindings fixos; `child()` deriva bindings adicionais. */
function createLogger(bindings = {}) {
  return {
    child(extra) {
      return createLogger({ ...bindings, ...extra });
    },
    debug: (msg) => emit('debug', bindings, msg),
    info: (msg) => emit('info', bindings, msg),
    warn: (msg) => emit('warn', bindings, msg),
    error: (msg) => emit('error', bindings, msg),
  };
}

module.exports = { createLogger };
