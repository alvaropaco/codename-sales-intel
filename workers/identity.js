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

/** Normaliza a resposta Receita Federal (BrasilAPI ou minhareceita) → result. */
function cnpjBasicResult(cnpj, raw, provider) {
  const url = provider === 'brasilapi.cnpj'
    ? `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`
    : `https://minhareceita.org/${cnpj}`;
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
    provider,
    data,
    facts: [
      { attribute: 'company.legal_name', value: data.legal_name, confidence: 0.99,
        evidence: { sourceType: provider, provider, url, retrievedAt: new Date().toISOString() } },
      { attribute: 'company.registration_status', value: data.registration_status, confidence: 0.99,
        evidence: { sourceType: provider, provider, retrievedAt: new Date().toISOString() } },
      { attribute: 'company.capital', value: data.capital, confidence: 0.99,
        evidence: { sourceType: provider, provider, retrievedAt: new Date().toISOString() } },
      { attribute: 'company.main_cnae', value: data.main_cnae, confidence: 0.99,
        evidence: { sourceType: provider, provider, retrievedAt: new Date().toISOString() } },
    ],
  };
}

const notFoundErr = (cnpj) => Object.assign(new Error(`CNPJ não encontrado na base oficial: ${cnpj}`), { code: 'NOT_FOUND' });

/**
 * Espelho minhareceita.org (mesma base oficial da Receita, mesmos campos).
 * Usado quando a BrasilAPI falha com 403/429/5xx/rede — Cloudflare bloqueia
 * a BrasilAPI de forma intermitente em produção. 404 no espelho também é
 * NOT_FOUND permanente (mesma base).
 */
async function cnpjBasicViaMinhareceita(cnpj, { signal, logger, reason }) {
  try {
    const res = await fetch(`https://minhareceita.org/${cnpj}`, { signal });
    if (res.ok) {
      const raw = await res.json();
      if (raw && (raw.razao_social || raw.cnpj)) {
        if (logger) logger.warn(`cnpj.basic ${cnpj}: ${reason}; servido por minhareceita.org`);
        return cnpjBasicResult(cnpj, raw, 'minhareceita.cnpj');
      }
      throw notFoundErr(cnpj);
    }
    if (res.status === 404) throw notFoundErr(cnpj);
    throw new Error(`minhareceita HTTP ${res.status}`);
  } catch (err) {
    if (err && err.code) throw err; // já classificado (NOT_FOUND)
    if (err && err.name === 'AbortError') throw err; // timeout é da task
    const e = new Error(`BrasilAPI e minhareceita indisponíveis (${reason}; espelho: ${err.message})`);
    e.code = 'PROVIDER_UNAVAILABLE';
    throw e;
  }
}

const executors = {
  async 'identity.cnpj.resolve'(task, { logger }) {
    const { resolveCnpj } = require('../lead-enrichment');
    const resolved = await resolveCnpj({
      companyName: task.input.companyName,
      city: task.input.city,
      state: task.input.state,
    });
    if (!resolved || !resolved.cnpj) {
      return { status: 'FAILED', error: { type: 'NOT_FOUND', message: 'CNPJ não resolvido pelas fontes públicas', retryable: false } };
    }
    logger.info(`cnpj.resolve ${task.input.companyName} → ${resolved.cnpj}`);
    return {
      status: 'COMPLETED',
      provider: 'searxng.rfb',
      data: { cnpj: resolved.cnpj, legal_name: resolved.legalName || null, source: resolved.source || null },
      facts: [
        { attribute: 'company.cnpj', value: resolved.cnpj, confidence: resolved.score >= 0.62 ? 0.95 : 0.7,
          evidence: { sourceType: resolved.source || 'searxng.rfb', provider: 'searxng.rfb', retrievedAt: new Date().toISOString() } },
      ],
    };
  },

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

  async 'identity.cnpj.basic'(task, { signal, logger } = {}) {
    const cnpj = String(task.input.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      const err = new Error(`CNPJ inválido: ${cnpj}`);
      err.code = 'INVALID_INPUT';
      throw err;
    }
    let res;
    try {
      res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err; // timeout é da task
      return cnpjBasicViaMinhareceita(cnpj, { signal, logger, reason: `BrasilAPI inacessível: ${err.message}` });
    }
    if (res.status === 404 || res.status === 400) {
      throw notFoundErr(cnpj);
    }
    if (!res.ok) {
      const reason = `BrasilAPI HTTP ${res.status}`;
      return cnpjBasicViaMinhareceita(cnpj, { signal, logger, reason });
    }
    const raw = await res.json();
    return cnpjBasicResult(cnpj, raw, 'brasilapi.cnpj');
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
      onMetric: (event, data) => {
        if (event === 'task_duration') require('../metrics').observeEnrichmentTaskDuration(data.capability, data.durationMs / 1000);
        if (event === 'provider_state') require('../metrics').setEnrichmentProviderState(data.provider, data.state);
      },
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
    const registry = require('../enrichment-provider-registry').getWorkerRegistry();
    const runtime = createIdentityWorker({ prisma, js, jsm, deps: { registry } });
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
