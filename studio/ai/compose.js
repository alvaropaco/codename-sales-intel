'use strict';

/**
 * studio/ai/compose.js — pacote de campanha multicanal por tom (specs/010,
 * T047; FR-025/FR-026). Um chamado por tom/variante: e-mail (assunto,
 * pré-header, blocos), WhatsApp (curto, com CTA) e texto para LinkedIn —
 * cada canal adaptado, nunca cópia do mesmo texto. DI: callLlm injetável
 * (pesquisa D9); Brand Voice entra como diretriz quando configurada (US12).
 */

const { parseModelJson } = require('./json');

function createComposer({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  /**
   * Compõe o pacote de UM tom. Retorna:
   * { title, email: {subject, preheader, blocks}, whatsapp: {text},
   *   linkedinText, suggestedSegment: {criteria, rationale}, timing }
   */
  async function composeForTone({ tone, sourceText, orgContext, objective, offer }) {
    const prompt = [
      `Gere o pacote de campanha de prospecção no tom "${tone}".`,
      orgContext ? `Contexto da empresa vendedora: ${orgContext}` : '',
      objective ? `Objetivo da campanha: ${objective}` : '',
      offer ? `Oferta: ${offer}` : '',
      'Base do conteúdo (material/fonte confirmada):',
      String(sourceText || '').slice(0, 12_000),
      '',
      'Responda SOMENTE com JSON no formato:',
      '{"title":"...",',
      ' "email":{"subject":"... usa {{companyName}}","preheader":"...","blocks":[{"type":"text","text":"... usa {{firstName}}"},{"type":"button","label":"...","url":"https://..."}]},',
      ' "whatsapp":{"text":"mensagem curta com {{firstName}} e CTA"},',
      ' "linkedinText":"texto para contato manual",',
      ' "suggestedSegment":{"criteria":{"version":1,"groups":[{"op":"AND","conditions":[{"field":"...","op":"...","value":"..."}]}]},"rationale":"por que este público"},',
      ' "timing":"sugestão de dia/horário"}',
      'Regras: adapte REALMENTE o texto por canal (WhatsApp é curto e direto; e-mail é estruturado).',
      'Use apenas variáveis do catálogo: {{firstName}}, {{companyName}}, {{city}}, {{industry}}, {{state}}.',
      'Nunca invente números ou benefícios que não estejam na base.',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await llm({
      system: 'Você é redator de campanhas B2B em português, respondendo apenas com JSON válido.',
      user: prompt,
      jsonMode: true,
      temperature: 0.7,
      maxTokens: 1400,
      tag: 'studio:compose',
    });
    const parsed = parseModelJson(result.content);
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error(`Composição do tom "${tone}" não retornou JSON utilizável.`);
      err.code = 'COMPOSE_PARSE_FAILED';
      err.status = 502;
      throw err;
    }
    return parsed;
  }

  return { composeForTone };
}

module.exports = { createComposer };
