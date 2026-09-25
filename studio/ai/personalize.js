'use strict';

/**
 * studio/ai/personalize.js — personalização por empresa (T074, FR-047/051).
 * Usa SOMENTE dados existentes na base do lead (enriquecimento/análise);
 * lead sem dados suficientes → sinaliza `skip` (versão base, nada inventado,
 * FR-051). Saída auditável via `dataBasis` (FR-075). DI: callLlm injetável.
 */

const { parseModelJson } = require('./json');

function createPersonalizer({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  /**
   * Gera a variação de UM lead. Retorna:
   * - { skip: true, reason }             → lead sem dados (base_fallback)
   * - { intro, valueProp, cta, dataBasis } → personalização
   */
  async function personalizeLead({ lead, level, orgContext }) {
    const dados = {};
    for (const field of ['companyName', 'contactName', 'city', 'state', 'industry', 'employees', 'verdict']) {
      if (lead[field] != null && lead[field] !== '') dados[field] = lead[field];
    }
    const usefulCount = ['industry', 'employees', 'verdict', 'city'].filter((f) => dados[f]).length;

    const prompt = [
      `Gere a personalização (nível: ${level}) da mensagem para esta empresa.`,
      orgContext ? `Contexto do vendedor: ${orgContext}` : '',
      'Dados disponíveis do lead (use SOMENTE estes dados — nunca invente):',
      `Setor do lead: "${dados.industry ?? ''}"`,
      JSON.stringify(dados),
      '',
      'Se os dados forem insuficientes para uma personalização honesta, responda {"skip":true,"reason":"..."}',
      'Caso contrário responda SOMENTE com JSON:',
      '{"intro":"... usa {{companyName}} quando citar a empresa","valueProp":"...","cta":"...","dataBasis":["campo=valor usado"]}',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await llm({
      system: 'Você personaliza mensagens B2B em português com dados reais do lead, respondendo apenas com JSON válido.',
      user: prompt,
      jsonMode: true,
      temperature: 0.6,
      maxTokens: 600,
      tag: 'studio:personalize',
    });
    const parsed = parseModelJson(result.content) || {};
    if (parsed.skip) {
      return { skip: true, reason: parsed.reason || 'sem dados suficientes' };
    }
    return {
      intro: parsed.intro || null,
      valueProp: parsed.valueProp || null,
      cta: parsed.cta || null,
      dataBasis: Array.isArray(parsed.dataBasis) ? parsed.dataBasis : [],
    };
  }

  return { personalizeLead };
}

module.exports = { createPersonalizer };
