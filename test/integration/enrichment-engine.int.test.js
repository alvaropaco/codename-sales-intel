// Scaffold opt-in: só roda contra NATS JetStream e Redis reais (quickstart).
// Sem NATS_URL/REDIS_URL, todos os testes pulam — unidades cobrem o resto.
const test = require('node:test');

const RUN = Boolean(process.env.NATS_URL && process.env.REDIS_URL);

test('integração: stream ENRICHMENT aceita publish/consume roundtrip', { skip: RUN ? false : 'NATS_URL/REDIS_URL ausentes' }, async (t) => {
  const natsStream = require('../../nats-stream');
  const contracts = require('../../enrichment-contracts');

  const nc = await natsStream.connectNats({ name: 'b2base-int-test' });
  const jsm = await nc.jetstreamManager();
  await natsStream.ensureStream(jsm);
  const js = nc.jetstream();

  const result = {
    version: '1', taskId: `it-${Date.now()}`, taskKey: 'it-key', jobId: 'it-job',
    orgId: 'it-org', prospectId: 'it-prospect', entityKey: 'prospect:it',
    entityType: 'prospect', capability: 'identity.domain.verify', provider: 'dns.direct',
    status: 'COMPLETED', data: {}, facts: [], error: null, durationMs: 1,
    workerVersion: 'integration', suggestedTasks: [], completedAt: new Date().toISOString(),
  };
  const headers = contracts.buildResultHeaders({ ...result, attempt: 1 });
  const hdr = natsStream.headers();
  for (const [k, v] of Object.entries(headers)) hdr.set(k, v);
  await js.publish(contracts.RESULT_SUBJECT, contracts.serializePayload(result), { headers: hdr, timeout: 5000 });

  await natsStream.ensurePullConsumer(jsm, {
    durable: `it-result-${Date.now()}`,
    filterSubject: contracts.RESULT_SUBJECT,
    ackWaitMs: 5000,
    maxDeliver: 2,
  });
  const consumer = js.consumers.get({ stream: natsStream.NATS_STREAM, durable: `it-result-${Date.now()}` });
  const msgs = await consumer.fetch({ max_messages: 1, expires: 3000 });
  for await (const m of msgs) {
    const parsed = contracts.parsePayload(m.data);
    t.diagnostic(`recebido: ${parsed.taskId}`);
    assert.strictEqual(parsed.taskId, result.taskId);
    await m.ack();
  }
  await natsStream.closeAll();
});
