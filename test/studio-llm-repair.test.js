'use strict';

/**
 * test/studio-llm-repair.test.js — fix dos cards de erro do chat:
 * composeForTone e segment-nl com retry de reparo (callLlmJson) — primeira
 * resposta truncada/fora do catálogo é recuperada na 2ª chamada.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createComposer } = require('../studio/ai/compose');
const { createSegmentNl } = require('../studio/ai/segment-nl');

test('compose: resposta truncada na 1ª tentativa → reparo recupera o pacote', async () => {
  const calls = [];
  const composer = createComposer({
    callLlm: async (opts) => {
      calls.push(opts);
      if (calls.length === 1) {
        // Truncada: e-mail aberto, canais seguintes nunca fecham o JSON.
        return { content: '{"title":"ERP","email":{"subject":"Olá {{companyName}}","preheader":"x","blocks":[{"type":"text","text":"Olá' };
      }
      return {
        content: JSON.stringify({
          title: 'ERP',
          email: { subject: 'Olá {{companyName}}', preheader: 'x', blocks: [{ type: 'text', text: 'Olá {{firstName}}' }] },
          whatsapp: { text: 'Oi {{firstName}}!' },
          linkedinText: 'texto',
          timing: 'terça 10h',
        }),
      };
    },
  });
  const pack = await composer.composeForTone({ tone: 'comercial', sourceText: 'ERP industrial' });
  assert.ok(pack.email.subject.includes('{{companyName}}'));
  assert.equal(calls.length, 2, 'segunda chamada após falha de parse');
  assert.ok(calls[1].maxTokens >= 2000, 'maxTokens alto para 3 canais (evita truncar)');
  assert.ok(calls[1].user.includes('NÃO foi JSON utilizável'), '2ª chamada é prompt de reparo');
  assert.equal(calls[1].temperature, 0, 'reparo roda a temperature 0');
});

test('compose: pacote sem nenhum canal preenchido também dispara reparo', async () => {
  const calls = [];
  const composer = createComposer({
    callLlm: async (opts) => {
      calls.push(opts);
      if (calls.length === 1) return { content: '{"title":"só título"}' };
      return {
        content: JSON.stringify({ title: 'x', whatsapp: { text: 'Oi {{firstName}}' } }),
      };
    },
  });
  const pack = await composer.composeForTone({ tone: 'formal', sourceText: 'x' });
  assert.ok(pack.whatsapp.text);
  assert.equal(calls.length, 2, 'validação por canal (não só parse)');
});

test('segment-nl: critérios fora do catálogo na 1ª tentativa → reparo com o erro', async () => {
  const calls = [];
  const segmentNl = createSegmentNl({
    callLlm: async (opts) => {
      calls.push(opts);
      if (calls.length === 1) {
        return {
          content: JSON.stringify({
            criteria: { version: 1, groups: 'ausente' },
            rationale: 'x',
          }),
        };
      }
      return {
        content: JSON.stringify({
          criteria: { version: 1, groups: [{ op: 'AND', conditions: [{ field: 'industry', op: 'contains', value: 'indústria' }] }] },
          rationale: 'indústrias',
        }),
      };
    },
  });
  const result = await segmentNl.fromPrompt('indústrias');
  assert.equal(result.rationale, 'indústrias');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].user.includes('NÃO atendeu ao formato do catálogo'));
});
