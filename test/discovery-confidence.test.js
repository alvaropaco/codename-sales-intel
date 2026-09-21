const test = require('node:test');
const assert = require('node:assert');
const confidence = require('../discovery/confidence');

test('confidenceFor: defaults do research.md e override explícito vence', () => {
  assert.strictEqual(confidence.confidenceFor('cnpj-mcp'), 0.98);
  assert.strictEqual(confidence.confidenceFor('crtsh'), 0.92);
  assert.strictEqual(confidence.confidenceFor('dns-rdap'), 0.9);
  assert.strictEqual(confidence.confidenceFor('http-metadata'), 0.88);
  assert.strictEqual(confidence.confidenceFor('searxng'), 0.72);
  assert.strictEqual(confidence.confidenceFor('inferred'), 0.55);
  // Fonte desconhecida: default neutro 0.5.
  assert.strictEqual(confidence.confidenceFor('fonta-exotica'), 0.5);
  // Override é clampado e arredondado.
  assert.strictEqual(confidence.confidenceFor('crtsh', 1.5), 1);
  assert.strictEqual(confidence.confidenceFor('crtsh', 0.1234), 0.12);
});

test('combineConfidence: média determinística, ordem-agnóstica e clampada', () => {
  assert.strictEqual(confidence.combineConfidence([0.9, 0.72]), 0.81);
  assert.strictEqual(confidence.combineConfidence([0.72, 0.9]), 0.81);
  assert.strictEqual(confidence.combineConfidence([]), 0);
  assert.strictEqual(confidence.combineConfidence([2, -1, 0.5]), 0.5); // fora de [0,1] ignorado
});

test('relationshipConfidence: nunca acima da evidência mais fraca', () => {
  assert.strictEqual(confidence.relationshipConfidence([0.98, 0.72]), 0.72);
  assert.strictEqual(confidence.relationshipConfidence([]), 0);
});

test('candidateConfidence: bônus de concordância com teto e âncora oficial de CNPJ', () => {
  const base = confidence.candidateConfidence([0.9], { sources: 1 });
  const agreed = confidence.candidateConfidence([0.9], { sources: 3 });
  assert.strictEqual(base, 0.9);
  assert.strictEqual(agreed, 0.94); // 0.9 + 0.02*2
  // CNPJ oficial ancora o teto em 0.98 (mesmo com concordância alta).
  assert.strictEqual(confidence.candidateConfidence([0.98, 0.95], { sources: 2, hasOfficialCnpj: true }), 0.98);
  // Nada de confiança inventada sem evidência.
  assert.strictEqual(confidence.candidateConfidence([]), 0);
});

test('determinismo: mesma entrada, mesma saída (T047)', () => {
  const input = ['crtsh', 'dns-rdap', 'http-metadata'];
  const a = input.map((s) => confidence.confidenceFor(s));
  const b = input.map((s) => confidence.confidenceFor(s));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(confidence.combineConfidence(a), confidence.combineConfidence(b));
});
