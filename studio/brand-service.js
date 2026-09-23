'use strict';

/**
 * studio/brand-service.js — Brand Voice + Brand Kit + verificador de
 * consistência (US12, T115/T116). Aprende voz de samples (LLM), guarda kit
 * e injeta diretriz nos prompts de geração. DI: callLlm injetável.
 */

const { parseJsonLoose } = require('../llm-client');

function createBrandService(prisma, deps = {}) {
  const llm = deps.callLlm || require('../llm-client').callLlm;

  /** Diretriz textual para prompts de geração (pilar extra nas US4/US7). */
  async function voiceDirective(orgId) {
    const rows = await prisma.studioBrandProfile.findMany({ where: { orgId } });
    const profile = rows[0];
    if (!profile || !profile.voice?.toneNotes) return null;
    return [
      `Tom de voz da marca: ${profile.voice.toneNotes}`,
      ...(profile.voice.doExamples || []).length ? [`Exemplos do que fazer: ${(profile.voice.doExamples || []).join(' | ')}`] : [],
      ...(profile.voice.dontExamples || []).length ? [`Nunca escreva como: ${(profile.voice.dontExamples || []).join(' | ')}`] : [],
    ].join('\n');
  }

  /** Aprende a voz a partir de samples/campanhas (FR-070). */
  async function learn(orgId, { samples = [] } = {}) {
    const result = await llm({
      system: 'Você analisa a comunicação de uma empresa e responde apenas com JSON válido.',
      user: [
        'aprenda o tom de voz da marca a partir dos exemplos abaixo.',
        'Responda SOMENTE com JSON:',
        '{"toneNotes":"...","doExamples":["..."],"dontExamples":["..."]}',
        '--- EXEMPLOS ---',
        samples.join('\n').slice(0, 8000),
      ].join('\n'),
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 700,
      tag: 'studio:brand-learn',
    });
    const voice = parseJsonLoose(result.content) || { toneNotes: null, doExamples: [], dontExamples: [] };
    const rows = await prisma.studioBrandProfile.findMany({ where: { orgId } });
    if (rows[0]) {
      return prisma.studioBrandProfile.update({
        where: { id: rows[0].id },
        data: { voice: { ...rows[0].voice, ...voice, learnedFrom: samples } },
      });
    }
    return prisma.studioBrandProfile.create({
      data: { orgId, voice: { ...voice, learnedFrom: samples } },
    });
  }

  /** Verificador de consistência (FR-072): trecho desviante + sugestão. */
  async function checkConsistency(orgId, { text }) {
    const rows = await prisma.studioBrandProfile.findMany({ where: { orgId } });
    const voice = rows[0]?.voice || {};
    const result = await llm({
      system: 'Você audita a consistência de textos com o tom de voz de uma marca, respondendo apenas com JSON válido.',
      user: [
        'Verifique a consistência do texto com o tom da marca.',
        voice.toneNotes ? `Tom declarado: ${voice.toneNotes}` : '',
        voice.doExamples?.length ? `Exemplos corretos: ${voice.doExamples.join(' | ')}` : '',
        voice.dontExamples?.length ? `Exemplos incorretos: ${voice.dontExamples.join(' | ')}` : '',
        'Responda SOMENTE com JSON:',
        '{"deviations":[{"excerpt":"...","reason":"...","suggestion":"..."}]}',
        '--- TEXTO ---',
        String(text || '').slice(0, 8000),
      ]
        .filter(Boolean)
        .join('\n'),
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 900,
      tag: 'studio:brand-check',
    });
    const parsed = parseJsonLoose(result.content) || { deviations: [] };
    return { deviations: parsed.deviations || [] };
  }

  /** Kit: aplica logo/cores/fontes (retorna defaults quando não configurado). */
  async function getKit(orgId) {
    const rows = await prisma.studioBrandProfile.findMany({ where: { orgId } });
    return rows[0]?.kit || {};
  }

  return { voiceDirective, learn, checkConsistency, getKit };
}

module.exports = { createBrandService };
