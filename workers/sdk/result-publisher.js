// =============================================================================
// workers/sdk/result-publisher.js — publica enrichment.result.v1 com headers
// de correlação e Nats-Msg-Id por tentativa (T017). Injetável no runtime
// (testes usam publisher fake que só captura).
// =============================================================================

const contracts = require('../../enrichment-contracts');

function makeResultPublisher({ js, contracts: c = contracts, timeoutMs = 5000 } = {}) {
  if (!js) throw new Error('result-publisher: js é obrigatório');
  return async function publishResult(result) {
    const natsStream = require('../../nats-stream');
    const hdr = natsStream.headers();
    for (const [k, v] of Object.entries(c.buildResultHeaders(result))) hdr.set(k, v);
    await js.publish(c.RESULT_SUBJECT, c.serializePayload(result), { headers: hdr, timeout: timeoutMs });
    return { seq: 0 };
  };
}

module.exports = { makeResultPublisher };
