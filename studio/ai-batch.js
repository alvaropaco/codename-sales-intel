'use strict';

/**
 * studio/ai-batch.js — fila de gerações em lote do Studio (T046/T075).
 *
 * Contrato (contracts/jobs-queues.md): job ids `studio:ai:{...}`, progresso
 * `studio:batch:{id}` (done/total/paused), item com falha NÃO aborta o lote
 * (vira fallback) e pausa mid-batch é respeitada.
 *
 * v1: estado em memória do processo + execução inline — a rota responde 202
 * e o polling lê o progresso. Registro BullMQ (`registerStudioAiBatch`)
 * entra no boot para retomada entre processos.
 */

const state = new Map(); // batchId → {status, done, total, paused, result}

function createBatchRunner({ handlers } = {}) {
  /**
   * Cria e executa (inline) um lote. `items` são os trabalhos unitários;
   * `handlers[kind](item, ctx)` processa cada item.
   */
  async function createBatch(kind, items, ctx = {}) {
    const id = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    state.set(id, { kind, status: 'running', done: 0, total: items.length, paused: false, startedAt: new Date().toISOString() });
    // Execução assíncrona inline: a rota responde 202 antes de terminar.
    void (async () => {
      const results = [];
      for (const item of items) {
        const current = state.get(id);
        if (!current) break;
        if (current.paused) {
          current.status = 'paused';
          return;
        }
        try {
          const result = await handlers[kind](item, ctx);
          results.push({ ok: true, result });
        } catch (err) {
          // Item falho não aborta o lote (contrato).
          results.push({ ok: false, error: err.message });
        }
        current.done += 1;
      }
      const current = state.get(id);
      if (current && current.status !== 'paused') {
        current.status = 'completed';
        current.result = results;
      }
    })();
    return id;
  }

  function getProgress(id) {
    if (!state.has(id)) return null;
    const { kind, status, done, total } = state.get(id);
    return { batchId: id, kind, status, done, total };
  }

  function pauseBatch(id) {
    const batch = state.get(id);
    if (batch) batch.paused = true;
    return Boolean(batch);
  }

  return { createBatch, getProgress, pauseBatch };
}

module.exports = { createBatchRunner };
