'use strict';

/**
 * studio/variables.js — catálogo fechado de variáveis de personalização e
 * renderização com fallback (specs/010, T010 / FR-033, SC-011).
 *
 * Regra inegociável da spec: nenhuma mensagem sai com variável literal não
 * resolvida ("{{nome}}" ao lead é bug zero — SC-011). O fallback é
 * configurável por variável; o default é string vazia (omite o trecho).
 */

const CATALOG = {
  firstName: { label: 'Nome do contato', source: (lead) => splitFirst(lead.contactName), example: 'Ana' },
  lastName: { label: 'Sobrenome do contato', source: (lead) => splitLast(lead.contactName), example: 'Silva' },
  companyName: { label: 'Nome da empresa', source: (lead) => lead.companyName || lead.tradeName || null, example: 'MB Máquinas' },
  tradeName: { label: 'Nome fantasia', source: (lead) => lead.tradeName || null, example: 'MB' },
  city: { label: 'Cidade', source: (lead) => lead.city || null, example: 'São Paulo' },
  state: { label: 'Estado', source: (lead) => lead.state || null, example: 'SP' },
  industry: { label: 'Setor', source: (lead) => lead.industry || null, example: 'indústria metalúrgica' },
  employees: { label: 'Funcionários', source: (lead) => lead.employees || null, example: '120' },
  revenueEstimate: { label: 'Faturamento estimado', source: (lead) => lead.revenueEstimate || null, example: '5000000' },
  email: { label: 'E-mail do lead', source: (lead) => lead.cnpjEmail || null, example: 'contato@empresa.com.br' },
};

function splitFirst(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts[0] || null;
}

function splitLast(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Valida placeholders de um conteúdo contra o catálogo.
 * Retorna `{ ok, unknown[] }` — 400 UNKNOWN_VARIABLE no endpoint.
 */
function validatePlaceholders(text) {
  const unknown = [];
  const str = String(text || '');
  for (const match of str.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (!CATALOG[name] && !unknown.includes(name)) unknown.push(name);
  }
  return { ok: unknown.length === 0, unknown };
}

/** Todos os placeholders usados num texto (inclui desconhecidos). */
function usedPlaceholders(text) {
  return [...String(text || '').matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

/**
 * Renderiza placeholders com os dados do lead.
 * - valor existente → interpolado (com escape leve para HTML quando `escapeHtml`)
 * - sem valor → fallback da variável (options.fallbacks[var]) ou string vazia
 * Garantia SC-011: o resultado nunca contém "{{...}}".
 */
function renderTemplate(text, lead, options = {}) {
  const fallbacks = options.fallbacks || {};
  const out = String(text || '').replace(PLACEHOLDER_RE, (_all, name) => {
    if (!CATALOG[name]) return fallbacks[name] != null ? String(fallbacks[name]) : '';
    const raw = CATALOG[name].source(lead || {});
    if (raw == null || raw === '') {
      return fallbacks[name] != null ? String(fallbacks[name]) : '';
    }
    return options.escapeHtml ? escapeHtml(String(raw)) : String(raw);
  });
  // Cinto e suspensório (SC-011): qualquer resíduo de placeholder é removido.
  return out.replace(/\{\{[^}]*\}\}/g, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { CATALOG, validatePlaceholders, usedPlaceholders, renderTemplate, escapeHtml };
