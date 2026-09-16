// =============================================================================
// workers/search.js — worker da família search (specs/001-distributed-
// enrichment). Executa capabilities de busca:
//   - search.news : notícias da empresa/pessoa via SearXNG
//   (search.legal entra no porte — Fase 11)
//
// APENAS lógica de negócio — infraestrutura é do SDK (workers/sdk).
// Rodar: `node workers/search.js` (ou pnpm run worker:search).
// =============================================================================

const { createWorkerRuntime } = require('./sdk/runtime');
const { makeResultPublisher } = require('./sdk/result-publisher');
const capabilities = require('../enrichment-capabilities');
const { createLogger } = require('../logger');
const { createRawStore } = require('../raw-store');
const natsStream = require('../nats-stream');
const { searxSearch } = require('../searxng');

const executors = {
  async 'search.news'(task, { logger }) {
    const companyName = String(task.input.companyName || '').trim();
    const query = task.input.query || `${companyName} notícias`;
    let results = [];
    try {
      results = await searxSearch(query, { limit: 8 });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const e = new Error(`SearXNG indisponível: ${err.message}`);
      e.code = 'PROVIDER_UNAVAILABLE';
      throw e;
    }
    logger.info(`search.news "${query}": ${results.length} resultados`);
    return {
      status: 'COMPLETED',
      provider: 'searxng',
      data: {
        query,
        news: results.map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
      },
      facts: [
        {
          attribute: 'company.news',
          value: results.map((r) => ({ title: r.title, url: r.url })),
          confidence: results.length ? 0.7 : 0.5,
          evidence: {
            sourceType: 'searxng',
            provider: 'searxng',
            url: results[0] ? results[0].url : null,
            retrievedAt: new Date().toISOString(),
          },
        },
      ],
    };
  },
};

/** Monta o runtime completo (boot e testes de integração). */
function createSearchWorker({ prisma, js, jsm = null, deps = {} } = {}) {
  const logger = createLogger({ component: 'worker', family: 'search' });
  const rawStore = prisma ? createRawStore({ prisma }) : null;
  const runtime = createWorkerRuntime({
    name: 'search',
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

module.exports = { createSearchWorker, executors };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  (async () => {
    const prisma = new PrismaClient();
    const nc = await natsStream.connectNats({ name: 'b2base-worker-search' });
    const jsm = await nc.jetstreamManager();
    const js = nc.jetstream();
    const runtime = createSearchWorker({ prisma, js, jsm });
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
    console.error(`[worker:search] falha no boot: ${err.message}`);
    process.exit(1);
  });
}
