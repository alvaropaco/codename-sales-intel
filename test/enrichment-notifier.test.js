'use strict';

/**
 * Testes do notificador de falhas de enriquecimento (feature 006, US5):
 * dedup durable por dedupKey, alerta Slack em tempo real, digest diário por
 * e-mail e tolerância a falha de entrega (nunca propaga — FR-017).
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createEnrichmentNotifier } = require('../enrichment-notifier');

function setup({ slackError = null, emailError = null } = {}) {
  const prisma = createFakePrisma();
  const slackCalls = [];
  const emailCalls = [];
  const notifier = createEnrichmentNotifier({
    prisma,
    sendSlack: async (payload) => {
      if (slackError) throw slackError;
      slackCalls.push(payload);
    },
    sendEmail: async (mail) => {
      if (emailError) throw emailError;
      emailCalls.push(mail);
    },
    logger: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  return { prisma, slackCalls, emailCalls, notifier };
}

const FAILURE = {
  taskId: 'task-1', orgId: 'org-1', jobId: 'job-1', prospectId: 'p-1',
  capability: 'company.profile.deep', errorType: 'VALIDATION',
  message: 'entrada inválida', provider: 'pdl',
};

test('task_failed: envia Slack 1× e registra OpsNotification com dedupKey', async () => {
  const { prisma, slackCalls, emailCalls, notifier } = setup();
  await notifier.notifyTaskFailed(FAILURE);
  await notifier.notifyTaskFailed(FAILURE); // repetição: dedup

  assert.strictEqual(slackCalls.length, 1);
  assert.strictEqual(emailCalls.length, 0);
  assert.strictEqual(prisma.opsNotification.rows.length, 1);
  assert.strictEqual(prisma.opsNotification.rows[0].dedupKey, 'task_failed:task-1');
  assert.strictEqual(prisma.opsNotification.rows[0].kind, 'task_failed');
  assert.ok(prisma.opsNotification.rows[0].deliveredAt);
});

test('circuito aberto: alerta único por hora (dedupKey com janela)', async () => {
  const { prisma, slackCalls, notifier } = setup();
  await notifier.notifyCircuitOpen({ provider: 'pdl', affected: 12 });
  await notifier.notifyCircuitOpen({ provider: 'pdl', affected: 14 }); // mesma hora

  assert.strictEqual(slackCalls.length, 1);
  assert.strictEqual(prisma.opsNotification.rows.length, 1);
  const row = prisma.opsNotification.rows[0];
  assert.strictEqual(row.kind, 'circuit_open');
  assert.match(row.dedupKey, /^circuit:pdl:\d{10}$/);
});

test('digest diário: e-mail 1× por dia com agregados (FR-016)', async () => {
  const { prisma, emailCalls, notifier } = setup();
  await prisma.opsNotification.create({
    data: { dedupKey: 'task_failed:x', kind: 'task_failed', severity: 'critical', title: 'x', payload: {} },
  });

  const out = await notifier.sendDailyDigest({ completed24h: 120, failedByReason: { VALIDATION: 2 }, parkedOldest: [], successRate: 0.97 });
  const again = await notifier.sendDailyDigest({ completed24h: 120, failedByReason: {}, parkedOldest: [], successRate: 0.97 });

  assert.strictEqual(out.sent, true);
  assert.strictEqual(again.sent, false); // dedup diário
  assert.strictEqual(emailCalls.length, 1);
  assert.match(emailCalls[0].subject, /digest/i);
  assert.strictEqual(prisma.opsNotification.rows.filter((r) => r.kind === 'digest').length, 1);
});

test('falha de entrega do Slack é best-effort (nunca propaga, FR-017)', async () => {
  const { notifier } = setup({ slackError: new Error('slack fora') });
  const out = await notifier.notifyTaskFailed(FAILURE);
  assert.strictEqual(out.delivered, false); // registrado, sem estourar
});

test('sem SLACK_WEBHOOK_URL configurado: pula Slack silenciosamente', async () => {
  const prisma = createFakePrisma();
  const notifier = createEnrichmentNotifier({ prisma, webhookUrl: null, sendSlack: null, logger: { info() {}, warn() {}, error() {} } });
  const out = await notifier.notifyTaskFailed(FAILURE);
  assert.strictEqual(out.slackSkipped, true);
  assert.strictEqual(prisma.opsNotification.rows.length, 1); // registro existe
});
