'use strict';

/**
 * studio/ai/segment-nl.js — segmento por linguagem natural (FR-014, T091 —
 * antecipado para a fase US9 por dependência do agente).
 * LLM → MESMO documento de critérios fechado do segment-service (nunca SQL),
 * com explicação por condição. Sempre validado pelo catálogo.
 */

const { parseJsonLoose } = require('../../llm-client');
const segmentService = require('../segment-service');

function createSegmentNl({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  async function fromPrompt(prompt) {
    const fields = Object.entries(segmentService.FIELD_CATALOG)
      .map(([field, ops]) => `- ${field}: ${ops.join(', ')}`)
      .join('\n');
    const result = await llm({
      system: 'Você traduz pedidos de público em critérios estruturados de segmento B2B, respondendo apenas com JSON válido.',
      user: [
        'Traduza o pedido abaixo para critérios de segmento. Campos/operadores PERMITIDOS (use somente estes):',
        fields,
        'Regiões do Brasil válidas para o campo "region": Norte, Nordeste, Centro-Oeste, Sudeste, Sul.',
        'Responda SOMENTE com JSON:',
        '{"criteria":{"version":1,"groups":[{"op":"AND","conditions":[{"field":"...","op":"...","value":"..."}]}]},"rationale":"por que estes critérios representam o pedido"}',
        'Pedido:',
        String(prompt || '').slice(0, 4000),
      ].join('\n'),
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 700,
      tag: 'studio:segment-nl',
    });
    const parsed = parseJsonLoose(result.content) || {};
    // Validação pelo catálogo — LLM não pode inventar campo/op (D3).
    segmentService.validateCriteria(parsed.criteria);
    return {
      criteria: parsed.criteria,
      rationale: parsed.rationale || null,
    };
  }

  return { fromPrompt };
}

module.exports = { createSegmentNl };
