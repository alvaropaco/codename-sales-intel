'use strict';

/**
 * studio/ai/analyze.js — analista de campanha (US14, T132; FR-077).
 * Responde perguntas de performance com diagnóstico fundamentado nos dados
 * reais do rollup (nada de opinião sem número). DI: callLlm injetável.
 */

const { parseModelJson } = require('./json');

function createAnalyst({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  async function analyze({ question, campaignName, dataSummary }) {
    const result = await llm({
      system: 'Você é analista de campanhas B2B. Responda apenas com JSON válido e cite números do resumo.',
      user: [
        `Campanha: "${campaignName || ''}".`,
        `Pergunta do usuário: ${question}`,
        'Dados da campanha (resumo por dia):',
        JSON.stringify((dataSummary || []).slice(0, 60)),
        'Responda SOMENTE com JSON:',
        '{"diagnosis":"diagnóstico curto citando números","suggestions":["ação 1","ação 2"]}',
      ].join('\n'),
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 700,
      tag: 'studio:analyze',
    });
    const parsed = parseModelJson(result.content) || {};
    return {
      diagnosis: parsed.diagnosis || 'Sem diagnóstico disponível para os dados atuais.',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      answer: parsed.diagnosis || '',
    };
  }

  return { analyze };
}

module.exports = { createAnalyst };
