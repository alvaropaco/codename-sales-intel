// =============================================================================
// workers/discovery.js — worker do Discovery Engine (specs/006-discovery-
// engine). Consome discovery.job.requested.v1 e executa jobs inteiros
// (fan-out/fan-in dos providers). Rodar: `pnpm run worker:discovery`.
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const natsStream = require('../nats-stream');
const { bootstrapWorker } = require('../discovery');
const { createLogger } = require('../logger');

const logger = createLogger({ component: 'worker', family: 'discovery' });

if (require.main === module) {
  (async () => {
    const prisma = new PrismaClient();
    await bootstrapWorker({ prisma, logger });
    const shutdown = async () => {
      await natsStream.closeAll();
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })().catch((err) => {
    logger.error(`[worker:discovery] falha no boot: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { bootstrapWorker };
