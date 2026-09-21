// =============================================================================
// discovery/providers/crtsh.js — Certificate Transparency via crt.sh (T017, US2).
// Coletor passivo: certificados emitidos para o domínio → subdomínios reais.
// Bounded: timeout de collector (45s) e limite de certificados processados.
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const MAX_CERTS = 200;

function isConfigured() {
  return true; // serviço público, sem chave
}

async function execute(input = {}, { fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const domain = normalizer.baseDomain(input.domain);
  if (!domain) {
    const e = new Error('crtsh: domínio semente obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  const entries = await httpJson(`https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`, {
    timeoutMs,
    fetchImpl,
    okStatuses: [200, 502], // crt.sh devolve 502 com corpo vazio em pico; tratamos como vazio
  });
  const list = Array.isArray(entries) ? entries.slice(0, MAX_CERTS) : [];

  const seen = new Map(); // subdomain → { notBefore min, issuers }
  for (const entry of list) {
    const names = String(entry.name_value || entry.common_name || '')
      .split(/\n+/)
      .map((n) => normalizer.normalizeDomain(n));
    for (const name of names) {
      if (!name || !name.endsWith(`.${domain}`)) continue; // só subdomínios da semente
      const current = seen.get(name) || { firstSeen: null, issuer: null };
      const notBefore = entry.not_before || entry.notBefore || null;
      if (!current.firstSeen || (notBefore && notBefore < current.firstSeen)) current.firstSeen = notBefore;
      if (!current.issuer && entry.issuer_name) current.issuer = entry.issuer_name;
      seen.set(name, current);
    }
  }

  const items = [...seen.entries()].map(([host, meta]) => ({
    entityType: 'subdomain',
    value: host,
    displayName: host,
    attributes: { baseDomain: domain, certificateIssuer: meta.issuer, certificateNotBefore: meta.firstSeen },
    evidenceType: 'ct_log',
    confidence: confidenceFor('crtsh'),
    sourceProvider: 'crtsh',
    sourceUrl: `https://crt.sh/?q=${encodeURIComponent(host)}`,
    sourceRef: `ct:${host}`,
    observedAt: meta.firstSeen ? new Date(meta.firstSeen) : null,
    related: [],
  }));
  return { items, requests: 1, estimatedCost: 0, partial: list.length >= MAX_CERTS };
}

module.exports = { name: 'crtsh', capabilities: ['digital.domains'], isConfigured, execute, MAX_CERTS };
