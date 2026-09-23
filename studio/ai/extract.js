'use strict';

/**
 * studio/ai/extract.js — extração estruturada de materiais (specs/010, T045).
 * Material/URL → produto, oferta, benefícios, público e CTA (FR-024), sempre
 * apresentados para confirmação humana antes de compor a campanha.
 * DI: callLlm injetável (padrão do repo, pesquisa D9).
 */

const { parseJsonLoose } = require('../../llm-client');

function createExtractor({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  /**
   * Texto do material → extração estruturada.
   * Retorna { product, offer, benefits, audience, cta, confidence }.
   */
  async function extractFromText(text, { sourceHint } = {}) {
    const prompt = [
      'Faça a extração estruturada do material comercial abaixo para uma campanha de prospecção.',
      'Responda SOMENTE com JSON no formato:',
      '{"product":"...","offer":"...","benefits":["..."],"audience":"...","cta":"...","confidence":0.0}',
      'Regras: extraia APENAS o que está no material — nunca invente benefícios ou números.',
      'confidence = sua confiança (0 a 1) de que a extração representa o material.',
      sourceHint ? `Fonte do material: ${sourceHint}.` : '',
      '--- MATERIAL ---',
      String(text || '').slice(0, 24_000),
    ]
      .filter(Boolean)
      .join('\n');

    const result = await llm({
      system: 'Você extrai estrutura de materiais comerciais em português, respondendo apenas com JSON válido.',
      user: prompt,
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 900,
      tag: 'studio:extract',
    });
    const parsed = parseJsonLoose(result.content);
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('Resposta de extração não é JSON utilizável.');
      err.code = 'EXTRACTION_PARSE_FAILED';
      err.status = 502;
      throw err;
    }
    return {
      product: parsed.product || null,
      offer: parsed.offer || null,
      benefits: Array.isArray(parsed.benefits) ? parsed.benefits.filter(Boolean).slice(0, 10) : [],
      audience: parsed.audience || null,
      cta: parsed.cta || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  }

  return { extractFromText };
}

module.exports = { createExtractor };
