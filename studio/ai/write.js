'use strict';

/**
 * studio/ai/write.js — geradores de texto do Email Studio (T056): sugestões
 * de assunto/pre-header/CTA, reescrita (melhorar/encurtar/tom/revisar) e
 * follow-up baseado na interação real (US14). DI: callLlm injetável.
 */

const { parseModelJson } = require('./json');

function createWriter({ callLlm } = {}) {
  const llm = callLlm || require('../../llm-client').callLlm;

  /** Múltiplas sugestões (FR-035): kind = subject | preheader | cta | followup. */
  async function suggest({ kind, text, n = 5, context, interaction }) {
    const instructions = {
      subject: 'assuntos de e-mail curtos e específicos (máx. 60 caracteres), sem CLICKBAIT',
      preheader: 'pré-headers que complementam o assunto (máx. 90 caracteres)',
      cta: 'chamadas para ação curtas e orientadas a ação',
      followup:
        'follow-ups curtos baseados na interação real do lead — cite o comportamento (abriu, clicou, respondeu) sem remoer o pitch',
    };
    const interactionNote = interaction
      ? `Interação anterior do lead: ${JSON.stringify(interaction)}.`
      : '';
    const result = await llm({
      system: 'Você escreve copy de e-mail B2B em português, respondendo apenas com JSON válido.',
      user: [
        `Gere ${n} opções de ${instructions[kind] || kind}.`,
        interactionNote,
        text ? `Texto atual: "${text}".` : '',
        context ? `Contexto: ${context}` : '',
        'Responda SOMENTE com JSON: {"suggestions":["..."]}',
      ]
        .filter(Boolean)
        .join('\n'),
      jsonMode: true,
      temperature: 0.8,
      maxTokens: 700,
      tag: 'studio:write',
    });
    const parsed = parseModelJson(result.content) || {};
    return { suggestions: (parsed.suggestions || []).filter(Boolean).slice(0, n) };
  }

  /** Reescrita do trecho selecionado (FR-035): improve|shorten|tone|proofread. */
  async function rewrite({ action, tone, text }) {
    const instructions = {
      improve: 'melhore clareza e persuasão mantendo o significado',
      shorten: 'encurte mantendo o sentido essencial',
      tone: `reescreva no tom "${tone || 'formal'}"`,
      proofread: 'corrija gramática, ortografia e pontuação sem mudar o estilo',
    };
    const result = await llm({
      system: 'Você revisa copy de e-mail B2B em português, respondendo apenas com JSON válido.',
      user: [
        `${instructions[action] || instructions.improve}:`,
        `"${String(text || '').slice(0, 8000)}"`,
        'Responda SOMENTE com JSON: {"text":"..."}',
      ].join('\n'),
      jsonMode: true,
      temperature: 0.5,
      maxTokens: 1200,
      tag: 'studio:rewrite',
    });
    const parsed = parseModelJson(result.content) || {};
    return { text: parsed.text || text };
  }

  /** Tradução/adaptação preservando {{variáveis}} e links (US13, FR-028). */
  async function translateText({ text, targetLanguage }) {
    const result = await llm({
      system: 'Você traduz textos de e-mail B2B, respondendo apenas com JSON válido.',
      user: [
        `Traduza o texto para ${targetLanguage}.`,
        'REGRAS: preserve EXATAMENTE as variáveis {{assim}} e os links https://... ; não traduza URLs.',
        'Mantenha termos de conformidade (descadastro/unsubscribe) no idioma destino.',
        'Responda SOMENTE com JSON: {"text":"..."}',
        '--- TEXTO ---',
        String(text || '').slice(0, 8000),
      ].join('\n'),
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 1200,
      tag: 'studio:translate',
    });
    const parsed = parseModelJson(result.content) || {};
    return { text: parsed.text || text };
  }

  return { suggest, rewrite, translateText };
}

module.exports = { createWriter };
