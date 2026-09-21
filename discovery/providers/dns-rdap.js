// =============================================================================
// discovery/providers/dns-rdap.js — DNS + RDAP (T018, US2).
// DNS via node:dns (injetável para testes); registro via RDAP (rdap.org).
// Emite hosts (A/AAAA), MX, NS, TXT e atributos de registro do domínio.
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const DEFAULT_RESOLVER = {
  resolve4: async () => [],
  resolve6: async () => [],
  resolveMx: async () => [],
  resolveNs: async () => [],
  resolveTxt: async () => [],
};

function isConfigured() {
  return true;
}

async function execute(input = {}, { resolver = DEFAULT_RESOLVER, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const domain = normalizer.normalizeDomain(input.domain);
  if (!domain) {
    const e = new Error('dns-rdap: domínio semente obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  // DNS: falha de um registro individual não derruba o provider (SC-001).
  const safe = (p) => p.catch(() => null);
  const [a, aaaa, mx, ns, txt] = await Promise.all([
    safe(resolver.resolve4(domain)),
    safe(resolver.resolve6(domain)),
    safe(resolver.resolveMx(domain)),
    safe(resolver.resolveNs(domain)),
    safe(resolver.resolveTxt(domain)),
  ]);

  const attributes = {
    addresses: Array.isArray(a) ? a : [],
    addressesV6: Array.isArray(aaaa) ? aaaa : [],
    mailServers: Array.isArray(mx) ? mx.map((r) => r.exchange).filter(Boolean) : [],
    nameServers: Array.isArray(ns) ? ns : [],
    txt: Array.isArray(txt) ? txt.flat().slice(0, 20) : [],
  };

  const items = [];
  for (const ip of attributes.addresses) {
    items.push(hostObservation(ip, domain, { version: 4 }));
  }
  for (const ip of attributes.addressesV6) {
    items.push(hostObservation(ip, domain, { version: 6 }));
  }
  for (const exchange of attributes.mailServers) {
    const host = normalizer.normalizeDomain(exchange);
    if (!host) continue;
    items.push({
      entityType: 'subdomain', value: host, displayName: host,
      attributes: { baseDomain: domain, role: 'mail' },
      evidenceType: 'dns', confidence: confidenceFor('dns-rdap'),
      sourceProvider: 'dns-rdap', sourceUrl: null, sourceRef: `dns:mx:${host}`,
      observedAt: null,
      related: [],
    });
  }

  // RDAP: registro do domínio (registrar, datas). Falha → segue sem registro.
  let rdap = null;
  try {
    rdap = await httpJson(`https://rdap.org/domain/${domain}`, { timeoutMs: Math.min(timeoutMs, 20000), fetchImpl });
  } catch (_e) {
    rdap = null;
  }
  if (rdap) {
    const registrar = (rdap.entities || []).find((ent) => (ent.roles || []).includes('registrar'));
    const registrarName = registrar && registrar.vcardArray && Array.isArray(registrar.vcardArray[1])
      ? (registrar.vcardArray[1].find((f) => f[0] === 'fn') || [])[3]
      : null;
    const events = {};
    for (const ev of rdap.events || []) events[ev.eventAction] = ev.eventDate;
    attributes.registration = {
      registrar: registrarName || null,
      registeredAt: events.registration || null,
      expiresAt: events.expiration || null,
      updatedAt: events['last changed'] || null,
    };
  }

  // Observação do próprio domínio com os atributos DNS/registro consolidados.
  items.push({
    entityType: 'domain',
    value: domain,
    displayName: domain,
    attributes,
    evidenceType: 'dns',
    confidence: confidenceFor('dns-rdap'),
    sourceProvider: 'dns-rdap',
    sourceUrl: `https://rdap.org/domain/${domain}`,
    sourceRef: `dns:${domain}`,
    observedAt: null,
    related: [],
  });

  return { items, requests: 1 + (rdap ? 1 : 0), estimatedCost: 0 };
}

function hostObservation(ip, domain, { version }) {
  return {
    entityType: 'host',
    value: ip,
    displayName: ip,
    attributes: { ipVersion: version, baseDomain: domain },
    evidenceType: 'dns',
    confidence: confidenceFor('dns-rdap'),
    sourceProvider: 'dns-rdap',
    sourceUrl: null,
    sourceRef: `dns:a:${ip}`,
    observedAt: null,
    related: [],
  };
}

module.exports = { name: 'dns-rdap', capabilities: ['digital.infrastructure'], isConfigured, execute };
