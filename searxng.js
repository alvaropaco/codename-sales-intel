// =============================================================================
// searxng.js — cliente SearXNG compartilhado. Extraído de lead-enrichment.js
// (T019) para reuso pelo motor distribuído (workers/search.js). Comportamento
// idêntico ao original; URL por env SEARXNG_URL.
// =============================================================================

const SEARXNG_URL = (process.env.SEARXNG_URL || 'https://search.0xcloud.net').replace(/\/+$/, '');

async function searxSearch(query, { timeoutMs = 15000, limit = 8 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SEARXNG_URL}/search?format=json&q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`searxng HTTP ${res.status}`);
    const json = await res.json();
    return (json.results || []).slice(0, limit).map((r) => ({
      title: r.title || '',
      content: r.content || '',
      url: r.url || '',
    }));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searxSearch, SEARXNG_URL };
