// =============================================================================
// discovery/http.js — fetch compartilhado dos providers de discovery.
//
// Timeout por AbortController, erro mapeado para a taxonomia de contracts.js
// (TIMEOUT / RATE_LIMIT / UNAUTHORIZED / PROVIDER_UNAVAILABLE / INVALID_DATA).
// `fetchImpl` é injetável para testes sem rede (fixtures/fakes — research.md).
// =============================================================================

async function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 20000, fetchImpl = fetch, okStatuses = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
      const e = new Error(`timeout após ${timeoutMs}ms: ${url}`);
      e.code = 'TIMEOUT';
      throw e;
    }
    const e = new Error(`rede indisponível: ${err.message}`);
    e.code = 'NETWORK_ERROR';
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const e = new Error(`rate limit (429): ${url}`);
    e.code = 'RATE_LIMIT';
    throw e;
  }
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`não autorizado (${res.status}): ${url}`);
    e.code = 'UNAUTHORIZED';
    throw e;
  }
  if (okStatuses ? !okStatuses.includes(res.status) : !res.ok) {
    const e = new Error(`HTTP ${res.status}: ${url}`);
    e.code = res.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_DATA';
    throw e;
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    const e = new Error(`resposta não-JSON de ${url}`);
    e.code = 'INVALID_DATA';
    throw e;
  }
}

module.exports = { httpJson };
