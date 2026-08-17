/**
 * Bull v4 queue factory for outreach jobs.
 *
 * QUEUES:
 *   outreach:prepare    — creates outreach_contact, generates AI message
 *   outreach:message-send — sends one email via Gmail API
 *   outreach:gmail-sync — syncs mailbox via Gmail History API
 *
 * Uses bull v4. The default export is the Queue constructor.
 */
const Bull = require('bull');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null;

function redisConfig() {
  const cfg = { host: REDIS_HOST, port: REDIS_PORT };
  if (REDIS_PASSWORD) cfg.password = REDIS_PASSWORD;
  return cfg;
}

const QUEUES = Object.freeze({
  OUTREACH_PREPARE: 'outreach:prepare',
  OUTREACH_SEND: 'outreach:message-send',
  OUTREACH_GMAIL_SYNC: 'outreach:gmail-sync',
});

function createQueue(name) {
  return new Bull(name, { redis: redisConfig() });
}

let _queues = null;

function getQueues() {
  if (!_queues) {
    _queues = {
      prepare: createQueue(QUEUES.OUTREACH_PREPARE),
      send: createQueue(QUEUES.OUTREACH_SEND),
      gmailSync: createQueue(QUEUES.OUTREACH_GMAIL_SYNC),
    };
  }
  return _queues;
}

const _workers = [];

/**
 * Register a processor on a queue name and return the queue.
 * @param {string} name     - Bull queue name
 * @param {Function} processor - async(job) => result
 * @param {number} concurrency - how many jobs to process in parallel
 * @returns {import('bull').Queue}
 */
function registerProcessor(name, processor, concurrency = 1) {
  const queue = createQueue(name);
  queue.process(concurrency, async (job) => {
    try {
      return await processor(job);
    } catch (err) {
      console.error(`[worker:${name}] job ${job.id} failed:`, err.message);
      throw err;
    }
  });
  _workers.push(queue);
  return queue;
}

async function closeAllQueues() {
  const q = getQueues();
  await Promise.all([q.prepare, q.send, q.gmailSync].map((q) => q.close()));
  _queues = null;
}

async function closeAllWorkers() {
  await Promise.all(_workers.map((w) => w.close()));
  _workers.length = 0;
}

module.exports = {
  QUEUES,
  getQueues,
  createQueue,
  registerProcessor,
  closeAllQueues,
  closeAllWorkers,
  redisConfig,
};
