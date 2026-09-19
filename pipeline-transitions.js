'use strict';

/**
 * pipeline-transitions.js — regras de transição de estágio do pipeline de
 * vendas (feature 005). Módulo PURO (sem I/O): fonte da verdade das regras
 * antes espalhadas em stageTransitionError (server-prod.js) e no spread inline
 * dos consumidores de enriquecimento (nats-enrichment.js / cnpj-enrichment.js).
 *
 * Estágios: prospect (Em Qualificação) → deep_analysis (Análise profunda) →
 * qualified (Prontas para contato) → closed (Clientes ganhos);
 * discarded (Descartados) como destino final. O valor 'lead' ("Novas
 * oportunidades") foi REMOVIDO na 005 — normalizeStatus mapeia entradas
 * legadas para 'prospect' (FR-001/FR-003).
 *
 * Tabela normativa completa: specs/005-deep-lead-analysis/data-model.md.
 */

const PIPELINE_STATUSES = ['prospect', 'deep_analysis', 'qualified', 'closed', 'discarded'];

// Movimentos manuais permitidos (ordem do pipeline; prospect→qualified é o
// escape de sempre para dados legados/falhas de esteira e para orgs cujo
// fluxo não passa pela análise).
const MANUAL_MOVES = new Set([
  'prospect->deep_analysis',
  'prospect->qualified',
  'deep_analysis->qualified',
  'qualified->closed',
  // Restauração: descartado volta para Análise profunda (reanálise).
  'discarded->deep_analysis',
]);

const ENRICHMENT_CONCLUDED = (status) => Boolean(status) && status !== 'pending';

/**
 * Normaliza entradas legadas de status. 'lead' ("Novas oportunidades") deixou
 * de existir na feature 005 e passa a ser tratado como 'prospect' (FR-003).
 */
function normalizeStatus(status) {
  if (status === 'lead') return 'prospect';
  return status;
}

/**
 * Valida uma transição manual de estágio. Retorna { ok: true } ou
 * { ok: false, code, message } — codes: STAGE_TRANSITION_BLOCKED (422) e
 * ANALYSIS_RUNNING (422; motivo específico = análise em execução).
 *
 * @param {string} previousStatus status atual (raw — pode ser legado 'lead')
 * @param {string} nextStatus destino desejado
 * @param {{ enrichmentStatus?: string|null, analysisStatus?: string|null }} prospect
 */
function validateTransition(previousStatus, nextStatus, prospect) {
  const from = normalizeStatus(previousStatus);
  const to = normalizeStatus(nextStatus);
  const p = prospect || {};

  if (!PIPELINE_STATUSES.includes(to)) {
    return blocked('Transição de estágio não permitida.');
  }

  // Descarte manual: de qualquer estágio não terminal até Descartados (FR-011).
  // Terminais (closed/discarded) não descartam — fechado é vitória, não lixo.
  if (to === 'discarded') {
    if (from === 'prospect' || from === 'deep_analysis' || from === 'qualified') {
      return analysisGateOk(from, p);
    }
    return blocked('Transição de estágio não permitida.');
  }

  // Movimento adjacente da ordem do pipeline (inclui restauração).
  if (MANUAL_MOVES.has(`${from}->${to}`)) {
    // deep_analysis e qualified exigem enriquecimento concluído (o estágio
    // representa dado capturado; sem conclusão não há o que analisar).
    if ((to === 'deep_analysis' || to === 'qualified') && from === 'prospect') {
      if (!ENRICHMENT_CONCLUDED(p.enrichmentStatus)) {
        return blocked(
          'O lead ainda está sendo enriquecido — aguarde a conclusão do pipeline para avançar.'
        );
      }
    }
    return analysisGateOk(from, p);
  }

  // Retornos proibidos: enriquecimento concluído não se desfaz, e pulos de
  // estágio não são permitidos (qualified→prospect, closed→*, etc.).
  return blocked('Transição de estágio não permitida.');
}

/**
 * Bloqueia QUALQUER movimento manual enquanto a análise de IA está em
 * execução (FR-012) — o card só sai de "Análise profunda" com veredito ou
 * após falha/conclusão.
 */
function analysisGateOk(from, prospect) {
  if (from === 'deep_analysis' && prospect.analysisStatus === 'running') {
    return {
      ok: false,
      code: 'ANALYSIS_RUNNING',
      message: 'A análise profunda ainda está em execução — aguarde o veredito da IA ou reexecute depois de falhar.',
    };
  }
  return { ok: true };
}

function blocked(message) {
  return { ok: false, code: 'STAGE_TRANSITION_BLOCKED', message };
}

/**
 * Para onde o card vai quando o enriquecimento CONCLUI (consumidores NATS e
 * fluxo básico): premium pousa em "Análise profunda" para a análise de IA
 * (FR-004); demais planos seguem direto para "Prontas para contato"
 * (comportamento preservado, FR-018). Retorna null quando o card não deve
 * se mover (defensivo: sem conclusão de enriquecimento ou fora de
 * "Em Qualificação").
 *
 * @param {{ status: string, enrichmentStatus?: string|null }} prospect
 * @param {string} orgPlan 'trial' | 'premium'
 * @returns {string|null} próximo status ou null
 */
function statusAfterEnrichment(prospect, orgPlan) {
  const p = prospect || {};
  if (p.status !== 'prospect') return null;
  if (!ENRICHMENT_CONCLUDED(p.enrichmentStatus)) return null;
  return orgPlan === 'premium' ? 'deep_analysis' : 'qualified';
}

module.exports = {
  PIPELINE_STATUSES,
  normalizeStatus,
  validateTransition,
  statusAfterEnrichment,
};
