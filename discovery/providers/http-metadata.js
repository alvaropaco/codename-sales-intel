// =============================================================================
// discovery/providers/http-metadata.js — metadados HTTP do site (T020, US2).
// Bounded: 1 request ao apex e www, corpo limitado, timeout de collector.
// Extrai título, descrição, e-mails/telefones públicos, perfis sociais e
// tecnologias por headers — sem jamais seguir a aplicação (crawler de 1 nível).
// =============================================================================

const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function isConfigured() {
  return true;
}

async function execute(input = {}, { fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const domain = normalizer.normalizeDomain(input.domain);
  if (!domain) {
    const e = new Error('http-metadata: domínio semente obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  let page = null;
  let fetchError = null;
  for (const candidate of [`https://${domain}`, `http://${domain}`]) {
    try {
      page = await fetchPage(candidate, { fetchImpl, timeoutMs });
      break;
    } catch (err) {
      fetchError = err;
    }
  }
  // Site fora do ar não é falha do provider — é observação vazia legítima
  // (edge case "domínio expirado" do spec). Sem items, run COMPLETED vazio.
  if (!page) {
    if (fetchError && fetchError.code === 'TIMEOUT') throw fetchError;
    return { items: [], requests: 2, estimatedCost: 0 };
  }

  const { url, headers, body } = page;
  const emails = unique([...extractEmails(body), ...extractEmails(headersAndScripts(headers, body))])
    .map(normalizer.normalizeEmail)
    .filter((e) => e && !e.includes('example.com') && !/\.(png|jpg|webp)$/i.test(e))
    .slice(0, 10);
  const phones = unique(extractPhones(body)).slice(0, 5);
  const socials = unique(extractSocials(body)).slice(0, 10);
  const title = matchFirst(body, /<title[^>]*>([^<]{1,300})<\/title>/i);
  const description = matchFirst(body, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
    || matchFirst(body, /<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i);
  const technologies = detectTechnologies(headers, body);

  const items = [];
  items.push({
    entityType: 'domain',
    value: domain,
    displayName: title || domain,
    attributes: {
      website: url,
      title,
      description,
      httpServer: headers.server || null,
      technologies,
      reachable: true,
    },
    evidenceType: 'http',
    confidence: confidenceFor('http-metadata'),
    sourceProvider: 'http-metadata',
    sourceUrl: url,
    sourceRef: `http:${domain}`,
    observedAt: null,
    related: [
      ...emails.map((value) => ({ entityType: 'email', value, type: 'HAS_EMAIL' })),
      ...phones.map((value) => ({ entityType: 'phone', value, type: 'HAS_PHONE' })),
      ...socials.map((value) => ({ entityType: 'social_profile', value, type: 'HAS_SOCIAL' })),
      ...technologies.map((value) => ({ entityType: 'technology', value, type: 'USES_TECH' })),
    ],
  });
  return { items, requests: 1, estimatedCost: 0 };
}

async function fetchPage(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'b2base-discovery/1.0 (+https://b2base.com)', Accept: 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}: ${url}`);
      e.code = res.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_DATA';
      throw e;
    }
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    let body = '';
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        body += decoder.decode(value, { stream: true });
        if (received >= MAX_BODY_BYTES) {
          controller.abort();
          break;
        }
      }
    } else {
      body = String(await res.text()).slice(0, MAX_BODY_BYTES);
    }
    const headers = {};
    for (const [k, v] of Object.entries((res.headers && typeof res.headers.forEach === 'function' ? collectHeaders(res.headers) : res.headers) || {})) {
      headers[k.toLowerCase()] = String(v);
    }
    return { url: res.url || url, headers, body };
  } catch (err) {
    if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
      const e = new Error(`timeout após ${timeoutMs}ms: ${url}`);
      e.code = 'TIMEOUT';
      throw e;
    }
    if (err && err.code) throw err;
    const e = new Error(`rede indisponível: ${err.message}`);
    e.code = 'NETWORK_ERROR';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function collectHeaders(headers) {
  const out = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

function headersAndScripts(headers, body) {
  return `${headers.server || ''}\n${body.slice(0, 50000)}`;
}

function extractEmails(text) {
  const matches = String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return matches.filter((m) => !/sentry|wixpress/.test(m));
}

function extractPhones(text) {
  const matches = String(text || '').match(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g) || [];
  return matches.filter((m) => !/^\d{8}$/.test(m.replace(/\D/g, '')));
}

function extractSocials(text) {
  const matches = String(text || '').match(/https?:\/\/(?:www\.)?(instagram|linkedin|facebook|youtube|twitter|x)\.com\/[A-Za-z0-9_.-]{2,60}/g) || [];
  return matches.map((m) => m.replace(/\/$/, ''));
}

function detectTechnologies(headers, body) {
  const techs = [];
  const server = String(headers.server || '');
  if (/nginx/i.test(server)) techs.push('nginx');
  if (/apache/i.test(server)) techs.push('apache');
  if (/cloudflare/i.test(String(headers.server) + String(headers['cf-ray'] || ''))) techs.push('cloudflare');
  if (headers['x-powered-by']) {
    techs.push(String(headers['x-powered-by']).split(/\s+/)[0].toLowerCase());
  }
  if (/wp-content|wordpress/i.test(body)) techs.push('wordpress');
  if (/shopify/i.test(body)) techs.push('shopify');
  if (/_next\/static/.test(body)) techs.push('next.js');
  if (/react/i.test(body.slice(0, 100000))) techs.push('react');
  return [...new Set(techs)].filter(Boolean).slice(0, 10);
}

function matchFirst(text, re) {
  const m = String(text || '').match(re);
  return m ? m[1].trim() : null;
}

function unique(list) {
  return [...new Set(list)];
}

module.exports = { name: 'http-metadata', capabilities: ['digital.contacts', 'digital.infrastructure'], isConfigured, execute };
