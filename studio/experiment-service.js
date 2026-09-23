'use strict';

/**
 * studio/experiment-service.js — A/B, vencedor e fadiga (US10, T099–T101).
 * Divisão determinística por hash (research D10), teste de duas proporções
 * local (sem lib estatística), política de fadiga e de conflito.
 */

const crypto = require('crypto');

/** Variante determinística: sha256(campaign:prospect:experiment) contra pesos. */
function assignVariant(campaignId, prospectId, experimentId, weights) {
  const hash = crypto.createHash('sha256').update(`${campaignId}:${prospectId}:${experimentId}`).digest();
  const point = hash.readUInt32BE(0) / 0xffffffff; // 0..1
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let cursor = 0;
  for (const [label, weight] of Object.entries(weights)) {
    cursor += weight / total;
    if (point < cursor) return label;
  }
  return Object.keys(weights)[0];
}

/** Teste de duas proporções (aproximação normal, z). */
function twoProportionZ(s1, n1, s2, n2) {
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const pooled = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return Math.abs(p1 - p2) / se;
}

/** z crítico aproximado por confiança (bicaudal). */
function zFor(confidence) {
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.975) return 2.241;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.9) return 1.645;
  return 1.645;
}

/**
 * Declara vencedor pelo critério configurado (FR-061).
 * metrics por variante: { sent, replies|clicks|opens|conversions }.
 * Retorna { winner: label|null, significant, details }.
 */
function declareWinner({ variants, minPerVariant = 50, confidence = 0.95, metric = 'replyRate' }) {
  const successKey = { replyRate: 'replies', clickRate: 'clicks', openRate: 'opens', conversionRate: 'conversions' }[metric] || 'replies';
  const labels = Object.keys(variants);
  if (labels.length < 2) return { winner: null, significant: false, details: 'menos de 2 variantes' };

  for (const label of labels) {
    if ((variants[label]?.sent || 0) < minPerVariant) {
      return { winner: null, significant: false, details: `amostra insuficiente em ${label}` };
    }
  }

  // Melhor taxa observada.
  let best = labels[0];
  for (const label of labels) {
    if (variants[label][successKey] / variants[label].sent > variants[best][successKey] / variants[best].sent) {
      best = label;
    }
  }
  const others = labels.filter((l) => l !== best);
  const z = zFor(confidence);
  for (const other of others) {
    const zScore = twoProportionZ(
      variants[best][successKey], variants[best].sent,
      variants[other][successKey], variants[other].sent
    );
    if (zScore < z) {
      return { winner: null, significant: false, details: `diferença vs ${other} não significativa (z=${zScore.toFixed(2)})` };
    }
  }
  return { winner: best, significant: true, details: `z ≥ ${z} contra todas as variantes` };
}

/**
 * Fadiga (FR-063): N toques na janela de Y dias.
 * `touches` = datas dos toques recentes do lead.
 */
function isFatigued(touchDates, policy, now = new Date()) {
  if (!policy?.maxTouches || !policy?.windowDays) return false;
  const windowStart = now.getTime() - policy.windowDays * 86_400_000;
  const recent = (touchDates || []).filter((d) => new Date(d).getTime() >= windowStart);
  return recent.length >= policy.maxTouches;
}

module.exports = { assignVariant, declareWinner, isFatigued, twoProportionZ };
