// =============================================================================
// workers/identity.js — worker da família identity (specs/001-distributed-
// enrichment). Executa capabilities de verificação de identidade:
//   - identity.domain.verify : DNS + presença HTTP do domínio
//   - identity.cnpj.basic    : firmografia oficial (BrasilAPI)
//
// APENAS lógica de negócio vive aqui — infraestrutura é do SDK (workers/sdk).
// Rodar: `node workers/identity.js` (ou pnpm run worker:identity).
// =============================================================================

const { createWorkerRuntime } = require('./sdk/runtime');
const { makeResultPublisher } = require('./sdk/result-publisher');
const capabilities = require('../enrichment-capabilities');
const { createLogger } = require('../logger');
const { createRawStore } = require('../raw-store');
const natsStream = require('../nats-stream');

// ── Deps injetáveis (testes substituem dns/httpFetch) ───────────────────────
const dnsDeps = {
  resolve4: async (host) => (await require('dns').promises.resolve4(host)),
};

/**
 * HEAD https com timeout/abort; retorna { ok, status } sem lançar.
 * Falha de rede = domínio sem presença HTTP (resultado negativo válido).
 */
async function httpProbe(domain, { signal, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`https://${domain}/`, {
      method: 'HEAD',
      signal,
      redirect: 'follow',
    });
    return { ok: res.status < 500, status: res.status };
  } catch (err) {
    if (err && err.name === 'AbortError') throw err; // timeout é da task, não do domínio
    return { ok: false, status: null };
  }
}

const executors = {
  async 'identity.domain.verify'(task, { signal, logger }) {
    const domain = String(task.input.domain || '').toLowerCase().trim();
    let resolves = false;
    let addresses = [];
    try {
      addresses = await dnsDeps.resolve4(domain);
      resolves = addresses.length > 0;
    } catch (_e) {
      resolves = false;
    }
    const http = await httpProbe(domain, { signal });
    logger.info(`domain.verify ${domain}: dns=${resolves} http=${http.status || 'n/a'}`);
    const active = resolves && http.ok;
    return {
      status: 'COMPLETED',
      provider: 'dns.direct',
      data: { domain, resolves, httpStatus: http.status, domain_active: active },
      facts: [
        {
          attribute: 'company.domain_active',
          value: active,
          confidence: active ? 0.9 : 0.6,
          evidence: { sourceType: 'dns', provider: 'dns.direct', url: `https://${domain}/`, retrievedAt: new Date().toISOString() },
        },
      ],
    };
  },

  async 'identity.cnpj.basic'(task) {
    const cnpj = String(task.input.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      const err = new Error(`CNPJ inválido: ${cnpj}`);
      err.code = 'INVALID_INPUT';
      throw err;
    }
    let res;
    try {
      res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: undefined });
    } catch (err) {
      const e = new Error(`BrasilAPI inacessível: ${err.message}`);
      e.code = 'NETWORK_ERROR';
      throw e;
    }
    if (res.status === 404 || res.status === 400) {
      const e = new Error(`CNPJ não encontrado na base oficial: ${cnpj}`);
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (!res.ok) {
      const e = new Error(`BrasilAPI HTTP ${res.status}`);
      e.code = res.status === 429 ? 'RATE_LIMIT' : 'PROVIDER_UNAVAILABLE';
      throw e;
    }
    const raw = await res.json();
    const data = {
      cnpj,
      legal_name: raw.razao_social || null,
      trade_name: raw.nome_fantasia || null,
      registration_status: raw.descricao_situacao_cadastral || null,
      opened_at: raw.data_inicio_atividade || null,
      capital: raw.capital_social ?? null,
      main_cnae: raw.cnae_fiscal_descricao || null,
      city: raw.municipio || null,
      state: raw.uf || null,
    };
    return {
      status: 'COMPLETED',
      provider: 'brasilapi.cnpj',
      data,
      facts: [
        { attribute: 'company.legal_name', value: data.legal_name, confidence: 0.99,
          evidence: { sourceType: 'brasilapi', provider: 'brasilapi.cnpj', url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, retrievedAt: new Date().toISOString() } },
        { attribute: 'company.registration_status', value: data.registration_status, confidence: 0.99,
          evidence: { sourceType: 'brasilapi', provider: 'brasilapi.cnpj', retrievedAt: new Date().toISOString() } },
        { attribute: 'company.capital', value: data.capital, confidence: 0.99,
          evidence: { sourceType: 'brasilapi', provider: 'brasilapi.cnpj', retrievedAt: new Date().toISOString() } },
        { attribute: 'company.main_cnae', value: data.main_cnae, confidence: 0.99,
          evidence: { sourceType: 'brasilapi', provider: 'brasilapi.cnpj', retrievedAt: new Date().toISOString() } },
      ],
    };
  },
};

/** Monta o runtime completo (usado no boot e nos testes de integração). */
function createIdentityWorker({ prisma, js, jsm = null, deps = {} } = {}) {
  const logger = createLogger({ component: 'worker', family: 'identity' });
  const rawStore = prisma ? createRawStore({ prisma }) : null;
  const runtime = createWorkerRuntime({
    name: 'identity',
    capabilities,
    workerVersion: process.env.GIT_SHA || 'dev',
    deps: {
      prisma,
      js,
      jsm,
      publisher: js ? makeResultPublisher({ js }) : null,
      rawStore,
      logger,
      ...deps,
    },
  });
  runtime.registerExecutors(executors);
  return runtime;
}

module.exports = { createIdentityWorker, executors, httpProbe };

// Boot direto: `node workers/identity.js`
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  (async () => {
    const prisma = new PrismaClient();
    const nc = await natsStream.connectNats({ name: 'b2base-worker-identity' });
    const jsm = await nc.jetstreamManager();
    const js = nc.jetstream();
    const runtime = createIdentityWorker({ prisma, js, jsm });
    await runtime.start();
    const shutdown = async () => {
      await runtime.stop();
      await natsStream.closeAll();
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })().catch((err) => {
    console.error(`[worker:identity] falha no boot: ${err.message}`);
    process.exit(1);
  });
}
