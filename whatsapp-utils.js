/**
 * whatsapp-utils.js — helpers puros e sem efeitos colaterais para o canal WhatsApp:
 *   - normalização de telefone / chatId
 *   - interpolação de template (sanitizada)
 *   - detecção de opt-out
 *   - chaves de idempotência
 */

const crypto = require('crypto');

// ─── Telefones ────────────────────────────────────────────────────────────────
// O WhatsApp usa chatId no formato <digits>@c.us. Normalizamos para E.164
// (Brasil default 55) e derivamos o chatId de forma determinística.

function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;
  // Remove código do país (55) se presente e o número tem comprimento de BR.
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  // Número brasileiro: DDD (2) + número (8 ou 9 dígitos) = 10 ou 11 dígitos.
  if (digits.length >= 10 && digits.length <= 11) {
    digits = '55' + digits;
  }
  return digits;
}

function toChatId(phone) {
  // JIDs completos (ex.: "850...@lid", "1203...@g.us") passam inalterados —
  // reconstruir "<digits>@c.us" quebra chats LID/grupo.
  if (String(phone || '').includes('@')) return String(phone);
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized}@c.us` : null;
}

function phoneFromChatId(chatId) {
  return String(chatId || '').split('@')[0].replace(/\D/g, '');
}

// ─── Interpolação de template (sanitizada) ──────────────────────────────────
// Nunca interpolamos dados diretamente: só as chaves conhecidas são substituídas
// e todo valor é sanitizado (control chars removidos, tamanho limitado). O texto
// é plain-text (WhatsApp não interpreta HTML), então a sanitização foca em
// impedir quebras de linha indevidas/injeção de conteúdo de controle.

function _safe(value) {
  return String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 500);
}

function _firstWord(value) {
  const words = String(value || '').trim().split(/\s+/);
  return words[0] || '';
}

function _partnerName(lead) {
  const partners = Array.isArray(lead.cnpjPartners) ? lead.cnpjPartners : null;
  if (partners && partners.length) {
    const first = partners[0];
    return (first && (first.name || first.nome)) || '';
  }
  return '';
}

function buildTemplateVars(lead) {
  const partner = _partnerName(lead);
  return {
    firstName: _safe(_firstWord(partner || lead.tradeName || lead.companyName || '')),
    companyName: _safe(lead.companyName || ''),
    jobTitle: _safe((lead.cnpjPartners && lead.cnpjPartners[0] && lead.cnpjPartners[0].qual) || ''),
    city: _safe(lead.city || ''),
    industry: _safe(lead.industry || ''),
  };
}

function renderTemplate(template, lead) {
  let out = String(template || '');
  const vars = buildTemplateVars(lead);
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}', 'g'), value);
  }
  // Remove placeholders não resolvidos (evita enviar `{{...}}` cru ao lead).
  out = out.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
  return out.trim();
}

// ─── Opt-out ─────────────────────────────────────────────────────────────────
function _normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

const OPT_OUT_KEYWORDS = [
  'STOP',
  'SAIR',
  'PARAR',
  'SAIA',
  'PARE',
  'NAO QUERO',
  'NAO QUERO RECEBER',
  'CANCELAR',
  'CANCELA',
  'REMOVER',
  'DESCADASTRAR',
  'DESINSCREVER',
  'OPT OUT',
  'OPTOUT',
];

/**
 * Detecta se uma mensagem inbound é um pedido de opt-out.
 * Comparação por palavra isolada + prefixo + igualdade, sobre texto normalizado
 * (acentos removidos, caixa alta).
 */
function isOptOutMessage(text) {
  const t = _normalizeText(text);
  if (!t) return false;
  const tokens = t.split(/\s+/);
  return OPT_OUT_KEYWORDS.some((kw) => {
    const k = _normalizeText(kw);
    if (t === k) return true;
    if (t.startsWith(k + ' ') || t.startsWith(k + '!') || t.startsWith(k + '.')) return true;
    if (k.includes(' ')) return t.includes(k);
    return tokens.includes(k);
  });
}

// ─── Idempotência ────────────────────────────────────────────────────────────
function idempotencyKey(...parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map((p) => String(p == null ? '' : p)).join('|'))
    .digest('hex')
    .slice(0, 32);
}

function stepIdempotencyKey(campaignId, prospectId, stepIndex) {
  return idempotencyKey(campaignId, prospectId, stepIndex);
}

module.exports = {
  normalizePhone,
  toChatId,
  phoneFromChatId,
  renderTemplate,
  buildTemplateVars,
  isOptOutMessage,
  OPT_OUT_KEYWORDS,
  idempotencyKey,
  stepIdempotencyKey,
};
