// =============================================================================
// discovery/providers/projectdiscovery.js — adapter compatível com o serviço
// Chaos (ProjectDiscovery) para enumeração passiva de subdomínios (T019, US2).
// BOUNDED: timeout de collector, limite de subdomínios e sem revisita —
// nunca roda no caminho do request (plan.md, Provider Boundary).
// =============================================================================

const { httpJson } = require('../http');
const normalizer = require('../normalizer');
const { confidenceFor } = require('../confidence');

const CHAOS_ENDPOINT = 'https://chaos.projectdiscovery.io/dns/subdomains';
const MAX_SUBDOMAINS = 500;

function isConfigured() {
  return Boolean(process.env.PROJECTDISCOVERY_API_KEY);
}

async function execute(input = {}, { fetchImpl = fetch, apiKey = process.env.PROJECTDISCOVERY_API_KEY, timeoutMs = 45000 } = {}) {
  const domain = normalizer.baseDomain(input.domain);
  if (!domain) {
    const e = new Error('projectdiscovery: domínio semente obrigatório');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('projectdiscovery: PROJECTDISCOVERY_API_KEY ausente');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const json = await httpJson(`${CHAOS_ENDPOINT}/${encodeURIComponent(domain)}`, {
    headers: { 'X-API-Key': apiKey },
    timeoutMs,
    fetchImpl,
  });
  const list = (json.subdomains || []).slice(0, MAX_SUBDOMAINS);
  const items = [];
  for (const raw of list) {
    const host = normalizer.normalizeDomain(`${raw}.${domain}`);
    if (!host) continue;
    items.push({
      entityType: 'subdomain',
      value: host,
      displayName: host,
      attributes: { baseDomain: domain, source: 'chaos' },
      evidenceType: 'dns',
      confidence: confidenceFor('projectdiscovery'),
      sourceProvider: 'projectdiscovery',
      sourceUrl: null,
      sourceRef: `chaos:${host}`,
      observedAt: null,
      related: [],
    });
  }
  return { items, requests: 1, estimatedCost: 0, partial: Boolean(json.subdomains && json.subdomains.length > MAX_SUBDOMAINS) };
}

module.exports = { name: 'projectdiscovery', capabilities: ['digital.domains'], isConfigured, execute, MAX_SUBDOMAINS };
