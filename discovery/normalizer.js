// =============================================================================
// discovery/normalizer.js — normalização e chaves canônicas (T006).
//
// Toda identidade entra no motor NORMALIZADA: CNPJ só dígito validado, domínio
// host minúsculo, nome sem acento/caixa. A canonicalKey é o identificador
// estável que consolida entidades (SC-002): mesma chave → mesma entidade.
// Módulo puro.
// =============================================================================

const { createHash } = require('crypto');

// ── CNPJ ────────────────────────────────────────────────────────────────────

function cnpjDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Validação dos dígitos verificadores (padrão Receita Federal). */
function isValidCnpj(value) {
  const cnpj = cnpjDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base) => {
    let weight = base.length - 7;
    let sum = 0;
    for (const d of base) {
      sum += Number(d) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12]) && calc(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

function formatCnpj(value) {
  const d = cnpjDigits(value);
  if (d.length !== 14) return String(value || '');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** CNPJ canônico: 14 dígitos; null se inválido (contrato: nunca ambíguo). */
function normalizeCnpj(value) {
  const d = cnpjDigits(value);
  return isValidCnpj(d) ? d : null;
}

// ── Domínio / host ──────────────────────────────────────────────────────────

/** Host canônico de qualquer input (URL, e-mail ou host solto): minúsculo,
 * sem esquema/porta/caminho. Null se não parecer um hostname. */
function normalizeDomain(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('@')) {
    const at = raw.lastIndexOf('@');
    raw = raw.slice(at + 1);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    try {
      raw = new URL(raw).hostname;
    } catch {
      return null;
    }
  } else {
    raw = raw.split('/')[0].split('?')[0].split(':')[0];
  }
  raw = raw.replace(/\.+$/, '');
  // `www.` é alias do apex — consolidar (SC-002); subdomínios reais permanecem.
  raw = raw.replace(/^www\./, '');
  // hostname: labels alfanuméricos + hífen interno; TLD mínimo 2 letras.
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(raw)) return null;
  return raw;
}

// Sufixos "duas-em-um" mais comuns no Brasil para extrair o domínio base.
const MULTI_LEVEL_SUFFIXES = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'ind.br', 'blog.br',
  'app.br', 'dev.br', 'eco.br', 'com.ar', 'com.mx', 'com.au', 'co.uk',
  'org.uk', 'gov.uk', 'co.jp', 'com.pt',
]);

/** Domínio base (registrable domain): sub.exemplo.com.br → exemplo.com.br. */
function baseDomain(host) {
  const normalized = typeof host === 'string' ? host : normalizeDomain(host);
  if (!normalized) return null;
  const parts = normalized.split('.');
  if (parts.length <= 2) return normalized;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// ── URL / e-mail / telefone / nome ──────────────────────────────────────────

/** URL canônica: esquema+host minúsculo, sem fragmento e porta default. */
function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    u.hash = '';
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, u.pathname === '/' ? '' : '/');
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) return null;
  return raw;
}

/** Telefone canônico: dígitos com DDI 55 quando faltar (padrão BR). */
function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length !== 12 && d.length !== 13) return null;
  return d.startsWith('55') ? d : null;
}

/** Nome para comparação: sem acento, minúsculo, espaços colapsados. */
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(ltda|limitada|s\s*a|s\/a|me|eireli|epp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Chaves canônicas (SC-002) ───────────────────────────────────────────────

function nameKey(value) {
  const n = normalizeName(value);
  return n ? createHash('sha256').update(n).digest('hex').slice(0, 24) : null;
}

/**
 * Chave canônica por tipo de entidade. Null quando o valor não suporta o tipo:
 * o chamador NÃO persiste entidade sem chave estável (identidade fraca não
 * consolida — vira evidência apenas).
 */
function canonicalKey(type, value) {
  switch (type) {
    case 'company':
    case 'partner':
      if (isValidCnpj(value)) return `cnpj:${cnpjDigits(value)}`;
      return null;
    case 'domain':
    case 'subdomain': {
      const d = normalizeDomain(value);
      return d ? `host:${d}` : null;
    }
    case 'email': {
      const e = normalizeEmail(value);
      return e ? `email:${e}` : null;
    }
    case 'phone': {
      const p = normalizePhone(value);
      return p ? `phone:${p}` : null;
    }
    case 'url': {
      const u = normalizeUrl(value);
      return u ? `url:${createHash('sha256').update(u).digest('hex').slice(0, 24)}` : null;
    }
    case 'person': {
      const k = nameKey(value);
      return k ? `person:${k}` : null;
    }
    case 'legal_case': {
      const id = String(value || '').trim();
      return id ? `case:${id.replace(/\W+/g, '').toLowerCase()}` : null;
    }
    case 'legal_event':
    case 'legal_document': {
      const raw = String(value || '').trim();
      if (!raw) return null;
      const prefix = type === 'legal_event' ? 'event' : 'doc';
      return `${prefix}:${createHash('sha256').update(raw.toLowerCase()).digest('hex').slice(0, 24)}`;
    }
    case 'funding_round': {
      const v = String(value || '').trim();
      return v ? `funding:${nameKey(v) || v.toLowerCase()}` : null;
    }
    case 'technology': {
      const slug = normalizeName(value).replace(/\s+/g, '-');
      return slug ? `tech:${slug}` : null;
    }
    case 'social_profile': {
      const u = normalizeUrl(value);
      return u ? `social:${createHash('sha256').update(u).digest('hex').slice(0, 24)}` : null;
    }
    default:
      return null;
  }
}

module.exports = {
  cnpjDigits,
  isValidCnpj,
  formatCnpj,
  normalizeCnpj,
  normalizeDomain,
  baseDomain,
  normalizeUrl,
  normalizeEmail,
  normalizePhone,
  normalizeName,
  nameKey,
  canonicalKey,
};
