// =============================================================================
// test/helpers/fake-redis.js — fake in-memory compatível com o subconjunto
// ioredis usado pelo enrichment-provider-registry (incr, expire, get, set,
// setex, del, pttl). Expiração verificada lazy (no acesso).
// =============================================================================

function createFakeRedis({ clock = { now: () => Date.now() } } = {}) {
  const store = new Map(); // key → { value, expiresAt }
  const now = () => clock.now();

  function live(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    return entry;
  }

  return {
    _store: store,
    async incr(key) {
      const entry = live(key);
      if (!entry) {
        store.set(key, { value: '0', expiresAt: null });
        return this.incr(key);
      }
      entry.value = String(parseInt(entry.value, 10) + 1);
      return parseInt(entry.value, 10);
    },
    async decr(key) {
      const entry = live(key);
      const v = entry ? parseInt(entry.value, 10) - 1 : -1;
      if (entry) entry.value = String(v);
      return v;
    },
    async expire(key, seconds) {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = now() + seconds * 1000;
      return 1;
    },
    async pexpire(key, ms) {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = now() + ms;
      return 1;
    },
    async get(key) {
      const entry = live(key);
      return entry ? entry.value : null;
    },
    async set(key, value, ...args) {
      // suporta SET key val PX <ms> e SETEX-like via args
      if (args[0] === 'PX' && args[1] != null) {
        store.set(key, { value: String(value), expiresAt: now() + Number(args[1]) });
      } else {
        store.set(key, { value: String(value), expiresAt: null });
      }
      return 'OK';
    },
    async setex(key, seconds, value) {
      store.set(key, { value: String(value), expiresAt: now() + seconds * 1000 });
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async pttl(key) {
      const entry = live(key);
      if (!entry) return -2;
      return entry.expiresAt ? entry.expiresAt - now() : -1;
    },
  };
}

/** Relógio controlável para testes de janela/circuito. */
function createFakeClock({ start = 1_700_000_000_000 } = {}) {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms) {
      this.t += ms;
    },
  };
}

module.exports = { createFakeRedis, createFakeClock };
