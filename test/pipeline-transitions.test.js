'use strict';

/**
 * Testes das regras de transição do pipeline (feature 005) — módulo puro
 * pipeline-transitions.js. Padrão test/contact-decision.test.js: node:test +
 * node:assert + fixtures puras, sem banco nem rede.
 *
 * Tabela normativa: specs/005-deep-lead-analysis/data-model.md
 * ("Regras de transição"). Cada bloco referencia a regra correspondente.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  validateTransition,
  statusAfterEnrichment,
  normalizeStatus,
} = require('../pipeline-transitions');

const enrichedProspect = { enrichmentStatus: 'enriched', analysisStatus: 'not_started' };
const enrichingProspect = { enrichmentStatus: 'pending', analysisStatus: 'not_started' };

// ── normalizeStatus (FR-001/FR-003 — 'lead' deixa de existir) ───────────────

test('normalizeStatus mapeia legado "lead" para "prospect"', () => {
  assert.strictEqual(normalizeStatus('lead'), 'prospect');
  assert.strictEqual(normalizeStatus('prospect'), 'prospect');
  assert.strictEqual(normalizeStatus('deep_analysis'), 'deep_analysis');
  assert.strictEqual(normalizeStatus(undefined), undefined);
  assert.strictEqual(normalizeStatus(null), null);
  assert.strictEqual(normalizeStatus(''), '');
});

// ── prospect → deep_analysis / qualified (FR-004; gate de enriquecimento) ──

test('prospect → deep_analysis permitido com enriquecimento concluído', () => {
  const r = validateTransition('prospect', 'deep_analysis', enrichedProspect);
  assert.strictEqual(r.ok, true);
});

test('prospect → deep_analysis bloqueado com enriquecimento pendente', () => {
  const r = validateTransition('prospect', 'deep_analysis', enrichingProspect);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'STAGE_TRANSITION_BLOCKED');
});

test('prospect → qualified permitido com enriquecimento concluído (escape manual)', () => {
  assert.strictEqual(validateTransition('prospect', 'qualified', enrichedProspect).ok, true);
});

test('prospect → qualified bloqueado com enriquecimento pendente', () => {
  const r = validateTransition('prospect', 'qualified', enrichingProspect);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'STAGE_TRANSITION_BLOCKED');
});

// ── deep_analysis → qualified/discarded (FR-009/FR-010/FR-012) ──────────────

test('deep_analysis → qualified bloqueado enquanto a análise está em execução', () => {
  const running = { enrichmentStatus: 'enriched', analysisStatus: 'running' };
  const r = validateTransition('deep_analysis', 'qualified', running);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ANALYSIS_RUNNING');
});

test('deep_analysis → discarded também bloqueado enquanto análise executa', () => {
  const running = { enrichmentStatus: 'enriched', analysisStatus: 'running' };
  const r = validateTransition('deep_analysis', 'discarded', running);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'ANALYSIS_RUNNING');
});

test('deep_analysis → qualified permitido após análise concluída (override incluso)', () => {
  const completed = { enrichmentStatus: 'enriched', analysisStatus: 'completed' };
  assert.strictEqual(validateTransition('deep_analysis', 'qualified', completed).ok, true);
});

test('deep_analysis → qualified permitido após falha da análise (reexecução manual à parte)', () => {
  const failed = { enrichmentStatus: 'enriched', analysisStatus: 'failed' };
  assert.strictEqual(validateTransition('deep_analysis', 'qualified', failed).ok, true);
});

// ── qualified → closed / discarded ──────────────────────────────────────────

test('qualified → closed permitido', () => {
  assert.strictEqual(validateTransition('qualified', 'closed', enrichedProspect).ok, true);
});

test('qualified → discarded permitido (descarte manual, FR-011)', () => {
  assert.strictEqual(validateTransition('qualified', 'discarded', enrichedProspect).ok, true);
});

// ── discarded: destino final com restauração única (FR-011) ────────────────

test('discarded → deep_analysis permitido (restaurar — dispara reanálise)', () => {
  assert.strictEqual(validateTransition('discarded', 'deep_analysis', enrichedProspect).ok, true);
});

test('discarded → outros estágios bloqueado (destino final)', () => {
  for (const target of ['prospect', 'qualified', 'closed']) {
    const r = validateTransition('discarded', target, enrichedProspect);
    assert.strictEqual(r.ok, false, `discarded → ${target} deveria bloquear`);
    assert.strictEqual(r.code, 'STAGE_TRANSITION_BLOCKED');
  }
});

// ── retorno a "Em Qualificação" continua sempre bloqueado ───────────────────

test('qualified/closed/deep_analysis → prospect sempre bloqueado', () => {
  for (const from of ['qualified', 'closed', 'deep_analysis']) {
    const r = validateTransition(from, 'prospect', enrichedProspect);
    assert.strictEqual(r.ok, false, `${from} → prospect deveria bloquear`);
    assert.strictEqual(r.code, 'STAGE_TRANSITION_BLOCKED');
  }
});

// ── pulos e destinos inválidos ──────────────────────────────────────────────

test('pulos de estágio são bloqueados (deep_analysis → closed, prospect → closed)', () => {
  assert.strictEqual(validateTransition('deep_analysis', 'closed', enrichedProspect).ok, false);
  assert.strictEqual(validateTransition('prospect', 'closed', enrichedProspect).ok, false);
});

test('closed (terminal) não descarta nem retroage', () => {
  assert.strictEqual(validateTransition('closed', 'discarded', enrichedProspect).ok, false);
  assert.strictEqual(validateTransition('closed', 'qualified', enrichedProspect).ok, false);
});

test('status desconhecido como destino bloqueia', () => {
  const r = validateTransition('prospect', 'banana', enrichedProspect);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'STAGE_TRANSITION_BLOCKED');
});

// ── statusAfterEnrichment (FR-004/FR-018 — roteamento por plano) ────────────

test('premium: conclusão do enriquecimento move prospect para deep_analysis', () => {
  assert.strictEqual(statusAfterEnrichment({ status: 'prospect', ...enrichedProspect }, 'premium'), 'deep_analysis');
  assert.strictEqual(statusAfterEnrichment({ status: 'prospect', ...enrichedProspect }, 'trial'), 'qualified');
});

test('lead fora de "Em Qualificação" não é movido pela conclusão do enriquecimento', () => {
  for (const status of ['deep_analysis', 'qualified', 'closed', 'discarded']) {
    assert.strictEqual(
      statusAfterEnrichment({ status, ...enrichedProspect }, 'premium'),
      null,
      `status ${status} deveria permanecer`
    );
  }
});

test('enriquecimento sem conclusão não move o card (defensivo)', () => {
  assert.strictEqual(statusAfterEnrichment({ status: 'prospect', ...enrichingProspect }, 'premium'), null);
  assert.strictEqual(statusAfterEnrichment({ status: 'prospect', enrichmentStatus: null }, 'premium'), null);
});
