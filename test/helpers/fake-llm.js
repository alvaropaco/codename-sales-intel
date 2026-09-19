'use strict';

/**
 * fake-llm.js — stub do gateway LLM para os testes da análise profunda
 * (feature 005). Compatível com a interface que o deep-analysis.js usa de
 * llm-client.js: recebe opts { system, user, ... } e devolve
 * { content, usage, model }. Permite simular sucesso com JSON (direto ou
 * cercado por ```json), JSON inválido, timeout e falha de rede.
 *
 * Padrão do repo: helpers puros sem rede/banco (cf. test/helpers/fake-prisma.js).
 */

const RESULT_DEFAULT = {
  score_final: 72,
  veredito: 'contact',
  resumo: 'Lead aderente ao perfil comercial da organização, com canais de contato utilizáveis e sinais de operação ativa.',
  impressoes: ['Empresa operando com presença digital ativa', 'Canal corporativo disponível'],
  fatores_pro: ['E-mail corporativo próprio', 'Situação cadastral ativa'],
  fatores_con: ['Porte pequeno para o ICP'],
};

/**
 * Cria uma função `callLlm(opts)` stub.
 *
 * @param {object} [opts]
 * @param {object|Array} [opts.result=RESULT_DEFAULT]  objeto de resultado (ou lista
 *   consumida em ordem — a última é repetida)
 * @param {string}  [opts.rawContent]   conteúdo cru a devolver (sobrepõe result)
 * @param {boolean} [opts.fail=false]   lança erro de rede/gateway em toda chamada
 * @param {boolean} [opts.timeout=false] lança erro de timeout
 * @param {Function} [opts.impl]        implementação custom (recebe opts, retorna
 *   { content, usage, model })
 * @returns {Function & { calls: Array }} stub com registro das chamadas
 */
function createFakeLlm({ result = RESULT_DEFAULT, rawContent, fail = false, timeout = false, impl } = {}) {
  const results = Array.isArray(result) ? result : [result];
  let index = 0;
  const calls = [];

  const stub = async (opts = {}) => {
    calls.push(opts);
    if (timeout) throw new Error('llm_timeout_30000ms');
    if (fail) throw new Error('LiteLLM HTTP 502');
    if (impl) return impl(opts);
    const current = results[Math.min(index, results.length - 1)];
    index += 1;
    const content =
      rawContent != null ? rawContent : JSON.stringify(current);
    return { content, usage: { total_tokens: 421 }, model: opts.model || 'fake-model' };
  };
  stub.calls = calls;
  return stub;
}

/** Resultado positivo (veredito "contact"). */
function contactResult(overrides = {}) {
  return { ...RESULT_DEFAULT, ...overrides };
}

/** Resultado negativo (veredito "no_contact"). */
function noContactResult(overrides = {}) {
  return {
    ...RESULT_DEFAULT,
    score_final: 24,
    veredito: 'no_contact',
    resumo: 'Lead fora do perfil ideal: sem canais de contato utilizáveis e sinais de inatividade.',
    fatores_pro: ['CNPJ ativo'],
    fatores_con: ['Sem e-mail nem telefone capturados', 'Site fora do ar'],
    ...overrides,
  };
}

/** Resultado cercado por cerca de código (modelos que ignoram JSON mode). */
function fencedResult(result) {
  return { result, rawContent: '```json\n' + JSON.stringify(result) + '\n```' };
}

module.exports = { createFakeLlm, contactResult, noContactResult, fencedResult, RESULT_DEFAULT };
