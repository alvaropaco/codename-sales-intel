// =============================================================================
// discovery/providers/spiderfoot.js — adapter de compatibilidade SpiderFoot
// (T043, Phase 9). OPCIONAL e FORA do caminho crítico: só roda quando
// explicitamente habilitado no providerConfig do job, com hard timeout — o
// pipeline nativo (CT/DNS/RDAP/HTTP) não depende dele (SC-003).
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const HARD_TIMEOUT_MS = 60 * 1000;

function isConfigured() {
  return Boolean(process.env.SPIDERFOOT_URL);
}

/**
 * Dispara um scan rápido (sfp-scan de superfície passiva) e agrega os
 * elementos de endereços/hosts. Contrato com a instância:
 *   POST {base}/startscan {scanname, scandefaults: "passive", seed}
 *   GET  {base}/scandeleted?  → não usado; GET {base}/scanlog?id=…
 * Resposta agregada aceita { events: [{ type, data }] } (formato SF_JSON).
 */
async function execute(input = {}, { fetchImpl = fetch, baseUrl = process.env.SPIDERFOOT_URL, timeoutMs = Number(process.env.SPIDERFOOT_TIMEOUT_MS) || HARD_TIMEOUT_MS } = {}) {
  const domain = normalizer.normalizeDomain(input.domain);
  if (!domain) {
    const e = new Error('spiderfoot: domínio semente obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!baseUrl) {
    const e = new Error('spiderfoot: SPIDERFOOT_URL ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const base = String(baseUrl).replace(/\/+$/, '');
  const started = await httpJson(`${base}/startscan`, {
    method: 'POST',
    headers: process.env.SPIDERFOOT_API_KEY ? { Authorization: `Bearer ${process.env.SPIDERFOOT_API_KEY}` } : {},
    body: { scanname: `b2base-discovery-${domain}-${Date.now()}`, modulelist: 'sfp_hosting,sfp_dnsresolve,sfp_ssl', target: domain },
    timeoutMs: 20000,
    fetchImpl,
  });
  const scanId = started.scanId || started.id || started.eventId || null;

  const eventsJson = await httpJson(`${base}/scanlog?id=${encodeURIComponent(scanId || '')}&eventtype=all&output=SF_JSON`, {
    timeoutMs,
    fetchImpl,
  }).catch(() => null);
  const events = (eventsJson && eventsJson.events) || [];

  const seen = new Set();
  const items = [];
  for (const ev of events) {
    const host = normalizer.normalizeDomain(ev.data || '');
    if (!host || !host.endsWith(domain) || seen.has(host)) continue;
    seen.add(host);
    items.push({
      entityType: 'subdomain',
      value: host,
      displayName: host,
      attributes: { baseDomain: domain, source: 'spiderfoot', eventType: ev.type || null },
      evidenceType: 'dns',
      confidence: confidenceFor('spiderfoot'),
      sourceProvider: 'spiderfoot',
      sourceUrl: null,
      sourceRef: `sf:${host}`,
      observedAt: ev.created ? new Date(ev.created) : null,
      related: [],
    });
    if (items.length >= 500) break; // bounded
  }
  return { items, requests: 2, estimatedCost: 0, scanId };
}

module.exports = { name: 'spiderfoot', capabilities: ['digital.infrastructure'], isConfigured, execute, HARD_TIMEOUT_MS };
