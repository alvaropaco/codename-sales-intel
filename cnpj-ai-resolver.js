'use strict';

/**
 * cnpj-ai-resolver.js — estágio assistido por IA para resolver o CNPJ de
 * leads importados sem identificador (feature 005; motivação: 370+ leads de
 * planilha parados sem CNPJ porque a busca simples não achava).
 *
 * Segurança do dado (regra de ouro): o CNPJ NUNCA vem da memória do modelo.
 * A IA só (1) cria variações de busca da razão social e (2) julga candidatos
 * extraídos de resultados reais, confirmados por lookup oficial RFB. DV do
 * CNPJ validado antes de qualquer aceite.
 *
 * Puro + DI (callLlm/searxSearch/getCompanyByCnpj injetáveis) — testável sem
 * rede, padrão deep-analysis.js.
 */

const { callLlm, parseJsonLoose } = require('./llm-client');
const { isValidCnpj } = require('./csv-import');

const MATCH_CONFIDENCE_THRESHOLD = 0.7;
const MAX_VARIANTS = 5;
const MAX_CANDIDATES = 4;

const VARIANTS_SYSTEM = [
  'Você gera variações de busca para encontrar o CNPJ de uma empresa brasileira a partir da razão social informada (que pode vir abreviada ou com erro de digitação).',
  'Regras: expanda abreviações óbvias (IND. → INDUSTRIA, COM. → COMERCIO, S.A. → SA);',
  'crie no máximo 5 variações; inclua a razão social original praticamente como veio;',
  'não invente cidades, CNPJs ou dados que não foram informados.',
  'Responda APENAS com JSON: {"variants": ["...", "..."]}',
].join('\n');

const MATCH_SYSTEM = [
  'Você verifica se um CNPJ candidato corresponde à empresa buscada.',
  'Recebe a empresa procurada (razão social, cidade, estado) e candidatos com dados oficiais (razão social RFB, município, UF).',
  'Considere abreviações, ordem das palavras e grafias sem acento como equivalentes.',
  'Homônima em cidade diferente NÃO é match. Não invente CNPJ fora da lista.',
  'Responda APENAS com JSON: {"cnpj": "<o escolhido>", "confidence": <0-1>, "reason": "<curto>"}',
  'Se nenhum candidato corresponde com segurança, responda {"cnpj": null, "confidence": 0, "reason": "sem match"}',
].join('\n');

function normalizeCnpj(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Valida e normaliza as variações de busca geradas pelo LLM.
 * Lança em entrada inválida (o chamador degrada para null).
 */
function parseVariants(raw) {
  const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!parsed || !Array.isArray(parsed.variants)) {
    throw new Error('cnpj-ai-resolver: variações inválidas');
  }
  const clean = parsed.variants
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
  if (clean.length === 0) throw new Error('cnpj-ai-resolver: nenhuma variação útil');
  return clean;
}

/**
 * Valida o veredito do LLM sobre o melhor candidato.
 * Retorna { cnpj, confidence, reason } ou null (sem match confiável).
 * Lança em entrada inválida ou CNPJ com DV incorreto.
 */
function parseMatch(raw, threshold = MATCH_CONFIDENCE_THRESHOLD) {
  const parsed = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('cnpj-ai-resolver: veredito do match inválido');
  }
  const cnpj = normalizeCnpj(parsed.cnpj);
  if (!cnpj) return null; // o modelo pode honestamente não encontrar match
  if (cnpj.length !== 14 || !isValidCnpj(cnpj)) {
    throw new Error(`cnpj-ai-resolver: CNPJ com DV inválido (${cnpj})`);
  }
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('cnpj-ai-resolver: confidence inválida');
  }
  if (confidence < threshold) return null;
  return { cnpj, confidence: Number(confidence.toFixed(2)), reason: String(parsed.reason || '').slice(0, 200) };
}

/**
 * Extrai CNPJs (DV válido, sem repetição) de resultados de busca.
 */
function extractCandidatesFromResults(results) {
  const text = (results || [])
    .map((r) => `${r.title || ''} ${r.content || ''} ${r.url || ''}`)
    .join(' \n ');
  const found = [];
  const re = /\d{2}\.?\s?\d{3}\.?\s?\d{3}\/?\s?\d{4}-?\s?\d{2}|\d{14}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const cnpj = normalizeCnpj(m[0]);
    if (cnpj.length === 14 && isValidCnpj(cnpj) && !found.includes(cnpj)) {
      found.push(cnpj);
      if (found.length >= MAX_CANDIDATES * 2) break;
    }
  }
  return found;
}

/**
 * Orquestrador: variações de busca (LLM) → SearXNG → candidatos → lookup
 * oficial RFB → juiz do LLM. Retorna { cnpj, source: 'ia', confidence,
 * matchedName } ou null quando não resolve com confiança.
 *
 * @param {{ companyName: string, city?: string|null, state?: string|null }} lead
 * @param {object} [deps] callLlm, searxSearch, getCompanyByCnpj, isValidCnpj (injetáveis)
 */
async function resolveWithAi(lead, deps = {}) {
  const llm = deps.callLlm || callLlm;
  const search = deps.searxSearch;
  const lookup = deps.getCompanyByCnpj;
  if (!lead || !lead.companyName || !search || !lookup) return null;

  // 1) Variações de busca (LLM; falha aqui encerra o estágio de graça)
  let variants;
  try {
    const { content } = await llm({
      system: VARIANTS_SYSTEM,
      user: JSON.stringify({ razao_social: lead.companyName, cidade: lead.city || null, uf: lead.state || null }),
      temperature: 0.2,
      maxTokens: 300,
      jsonMode: true,
      tag: 'cnpj-resolver',
      ...(process.env.DEEP_ANALYSIS_LLM_MODEL ? { model: process.env.DEEP_ANALYSIS_LLM_MODEL } : {}),
    });
    variants = parseVariants(content);
  } catch (err) {
    console.warn(`[cnpj-ai-resolver] variações falharam: ${err.message}`);
    return null;
  }
  variants.unshift(lead.companyName); // a razão social original sempre entra

  // 2) Busca por variação (degrada silenciosamente; sem resultados → null)
  let candidates = [];
  for (const variant of variants.slice(0, MAX_VARIANTS)) {
    const query = lead.city ? `${variant} ${lead.city} CNPJ` : `${variant} CNPJ`;
    const results = await search(query).catch(() => []);
    candidates.push(...extractCandidatesFromResults(results));
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  candidates = [...new Set(candidates)].slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return null;

  // 3) Lookup oficial RFB (point lookup rápido) — dados reais para o juiz
  const official = [];
  for (const cnpj of candidates) {
    const company = await lookup(cnpj).catch(() => null);
    if (company) official.push(company);
  }
  if (official.length === 0) return null;

  // 4) Juiz do LLM: escolhe o match contra os dados oficiais
  try {
    const { content, model } = await llm({
      system: MATCH_SYSTEM,
      user: JSON.stringify({
        procurada: { razao_social: lead.companyName, cidade: lead.city || null, uf: lead.state || null },
        candidatos: official.map((c) => ({
          cnpj: c.cnpj,
          razao_social: c.legalName || null,
          nome_fantasia: c.tradeName || null,
          municipio: c.city || null,
          uf: c.state || null,
          situacao: c.status || c.situation || null,
        })),
      }),
      temperature: 0.1,
      maxTokens: 250,
      jsonMode: true,
      tag: 'cnpj-resolver',
      ...(process.env.DEEP_ANALYSIS_LLM_MODEL ? { model: process.env.DEEP_ANALYSIS_LLM_MODEL } : {}),
    });
    const match = parseMatch(content, MATCH_CONFIDENCE_THRESHOLD);
    if (!match) return null;
    const chosen = official.find((c) => normalizeCnpj(c.cnpj) === match.cnpj);
    return {
      cnpj: match.cnpj,
      source: 'ia',
      confidence: match.confidence,
      matchedName: (chosen && (chosen.legalName || chosen.tradeName)) || match.reason || null,
      model: model || null,
    };
  } catch (err) {
    console.warn(`[cnpj-ai-resolver] juiz falhou: ${err.message}`);
    return null;
  }
}

module.exports = {
  parseVariants,
  parseMatch,
  extractCandidatesFromResults,
  resolveWithAi,
};
