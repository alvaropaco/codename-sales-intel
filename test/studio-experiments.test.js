'use strict';

/**
 * test/studio-experiments.test.js — US10 do Campaign Studio (T097).
 *
 * A/B determinístico (hash estável, FR-060), declaração de vencedor por
 * critério explícito com teste de duas proporções (FR-061), otimização
 * contínua opcional (FR-062) e fadiga (FR-063).
 */

const test = require('node:test');
const assert = require('node:assert');
const experimentService = require('../studio/experiment-service');

test('divisão determinística 20/80: mesmo lead sempre na mesma variante', () => {
  const weights = { A: 20, B: 80 };
  const first = experimentService.assignVariant('camp-1', 'prospect-7', 'exp-1', weights);
  for (let i = 0; i < 10; i++) {
    assert.equal(
      experimentService.assignVariant('camp-1', 'prospect-7', 'exp-1', weights),
      first,
      're-execução mantém a variante'
    );
  }
  // Distribuição aproximada em massa (determinística por hash).
  let aCount = 0;
  for (let i = 0; i < 1000; i++) {
    if (experimentService.assignVariant('camp', `p-${i}`, 'exp', weights) === 'A') aCount++;
  }
  assert.ok(aCount > 100 && aCount < 300, `variante A perto de 20%: ${aCount / 10}%`);
});

test('vencedor: teste de duas proporções declara B quando claramente melhor', () => {
  const verdict = experimentService.declareWinner({
    metric: 'replyRate',
    variants: {
      A: { sent: 100, replies: 4 },
      B: { sent: 100, replies: 12 },
    },
    minPerVariant: 50,
    confidence: 0.95,
  });
  assert.equal(verdict.winner, 'B');
  assert.ok(verdict.significant, 'diferença 4% vs 12% com n=100 é significativa');
});

test('vencedor: empate ou amostra mínima insuficiente → sem vencedor', () => {
  const tie = experimentService.declareWinner({
    metric: 'replyRate',
    variants: { A: { sent: 100, replies: 5 }, B: { sent: 100, replies: 5 } },
    minPerVariant: 50,
    confidence: 0.95,
  });
  assert.equal(tie.winner, null);
  const small = experimentService.declareWinner({
    metric: 'replyRate',
    variants: { A: { sent: 10, replies: 2 }, B: { sent: 10, replies: 4 } },
    minPerVariant: 50,
    confidence: 0.95,
  });
  assert.equal(small.winner, null, 'amostra abaixo do mínimo');
});

test('fadiga: N toques em Y dias adia ou descarta conforme política (FR-063)', () => {
  const now = new Date('2026-09-23T13:00:00Z');
  const day = (n) => new Date(now.getTime() - n * 86_400_000);
  const touches = [day(1), day(2), day(3), day(4)];
  assert.equal(
    experimentService.isFatigued(touches, { maxTouches: 4, windowDays: 7 }, now),
    true,
    '4 toques em 7 dias = fadiga'
  );
  assert.equal(
    experimentService.isFatigued(touches.slice(0, 2), { maxTouches: 4, windowDays: 7 }, now),
    false,
    '2 toques em 7 dias = ok'
  );
});
