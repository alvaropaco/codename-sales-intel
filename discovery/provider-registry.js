// =============================================================================
// discovery/provider-registry.js — registro operacional dos providers de
// discovery (T005). Reaproveita o circuit breaker/rate limit compartilhado do
// enriquecimento (enrichment-provider-registry.js) com os limites do catálogo
// do discovery (contracts.js): keys namespaced com `disc:` para não dividir
// janelas com o motor de enrichment.
// =============================================================================

const { PROVIDER_CATALOG, DEFAULTS } = require('./contracts');
const { createProviderRegistry, createNoopRegistry } = require('../enrichment-provider-registry');

/** Limites por provider: RPM generoso para self-hosted, baixo para pagos. */
function discoveryLimits() {
  const byName = {};
  for (const [name, entry] of Object.entries(PROVIDER_CATALOG)) {
    byName[`disc:${name}`] = {
      rpm: entry.paid ? 30 : 120,
      concurrency: entry.paid ? 2 : DEFAULTS.concurrency,
    };
  }
  return { default: { rpm: 60, concurrency: DEFAULTS.concurrency }, byName };
}

const scoped = (provider) => `disc:${provider}`;

/** Registry do discovery sobre Redis compartilhado; no-op sem REDIS_URL. */
function createDiscoveryRegistry({ redis } = {}) {
  if (!redis) return createNoopRegistry();
  const registry = createProviderRegistry({ redis, limits: discoveryLimits() });
  return {
    acquire: (provider) => registry.acquire(scoped(provider)),
    recordOutcome: (provider, outcome) => registry.recordOutcome(scoped(provider), outcome),
    getState: (provider) => registry.getState(scoped(provider)),
    listProviders: () => registry.listProviders(Object.keys(PROVIDER_CATALOG).map(scoped)),
    disable: (provider) => registry.disable(scoped(provider)),
    enable: (provider) => registry.enable(scoped(provider)),
  };
}

module.exports = { createDiscoveryRegistry, discoveryLimits };
