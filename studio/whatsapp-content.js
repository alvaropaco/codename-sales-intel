'use strict';

/**
 * studio/whatsapp-content.js — validações e fallbacks do WhatsApp Studio
 * (US6, T066/T068).
 *
 * Validações: texto, botões e template no formato compatível Meta (categoria
 * e variáveis posicionais {{1}}, {{2}} — FR-042). Fallbacks comportamentais
 * (FR-044): opened_no_click, clicked_no_reply, email_failed — função pura
 * avaliada com os eventos reais do lead.
 */

const { validatePlaceholders } = require('./variables');

const MAX_TEXT = 4096;
const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const VALID_FALLBACKS = ['opened_no_click', 'clicked_no_reply', 'email_failed'];

function validateWhatsAppContent({ whatsappText, whatsappMeta }) {
  const errors = [];
  if (!whatsappText && !(whatsappMeta && whatsappMeta.template)) {
    errors.push('Mensagem vazia: informe texto ou template.');
  }
  if (whatsappText && whatsappText.length > MAX_TEXT) {
    errors.push(`Texto excede ${MAX_TEXT} caracteres.`);
  }
  if (whatsappText) {
    const { ok, unknown } = validatePlaceholders(whatsappText);
    if (!ok) errors.push(`Variáveis fora do catálogo: ${unknown.join(', ')}`);
  }
  const meta = whatsappMeta || {};
  if (meta.template) {
    if (!VALID_CATEGORIES.includes(meta.template.category)) {
      errors.push(`Categoria Meta inválida: ${meta.template.category}`);
    }
    for (const v of meta.template.variables || []) {
      if (!/^\{\{\d+\}\}$/.test(v)) {
        errors.push(`Variável posicional inválida no template Meta: ${v} (use {{1}}, {{2}}…)`);
      }
    }
  }
  for (const button of (meta.buttons || []).slice(0, 5)) {
    if (!['quick_reply', 'url'].includes(button.type)) {
      errors.push(`Botão com tipo inválido: ${button.type}`);
    }
    if (button.type === 'url' && !button.url) {
      errors.push('Botão de URL sem destino.');
    }
  }
  if ((meta.buttons || []).length > 3) {
    errors.push('Máximo de 3 botões por mensagem.');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Fallback comportamental (FR-044): dado o histórico do lead no e-mail,
 * a condição é satisfeita após o atraso configurado?
 * @param {object} events {sent: Date|null, opened: Date|null, clicked: Date|null, replied: Date|null, failed: Date|null}
 * @param {{condition: string, delayDays: number}} rule
 * @param {Date} now
 */
function matchesFallback(events, rule, now = new Date()) {
  if (!VALID_FALLBACKS.includes(rule.condition)) return false;
  const days = (ms) => ms / 86_400_000;
  const since = (d) => (d ? days(now.getTime() - new Date(d).getTime()) : null);
  const { sent, opened, clicked, replied, failed } = events || {};
  if (replied) return false; // respondeu → nenhuma automação continua (FR-053)
  switch (rule.condition) {
    case 'opened_no_click':
      return Boolean(opened && !clicked && since(sent) !== null && since(sent) >= (rule.delayDays ?? 2));
    case 'clicked_no_reply':
      return Boolean(clicked && !replied && since(clicked) !== null && since(clicked) >= (rule.delayDays ?? 2));
    case 'email_failed':
      return Boolean(failed);
    default:
      return false;
  }
}

module.exports = { validateWhatsAppContent, matchesFallback, VALID_FALLBACKS };
