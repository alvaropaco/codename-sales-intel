// =============================================================================
// nats-enrichment.js
// Integração com o pipeline de enriquecimento via NATS JetStream.
//
// Fluxo (documentação do enrichment-worker):
//   1. Publicamos  enrichment.company.requested.v1
//      com { cnpj, company_id, request_event_id } e header Nats-Msg-Id=event_id
//      (Dedup no envio: reenvios dentro de 2 min são ignorados pelo stream).
//   2. Consumidor durável exclusivo (b2base-results) escuta
//      enrichment.company.completed.v1 e persiste o resultado IDEMPOTENTE
//      (chave: company_id + enrichment_version), ACK somente após persistir,
//       nak() em erro para reentrega.
//   3. Monitoramos a DLQ enrichment.company.dlq.v1 (ex.: CNPJ inválido).
//
// Entrega é at-least-once: o consumidor pode receber a mesma mensagem mais de
// uma vez. A persistência idempotente garante que não duplicamos nem perdemos.
//
// O cliente `nats` (npm) expõe a mesma API da doc: connect(), StringCodec(),
// JSONCodec(), jetstream(), pull_subscribe dada a durabilidade. Aqui usamos a
// API JS: js.consumers.get(), consumer.fetch() e AckPolicy.
// =============================================================================

const { connect, StringCodec, JSONCodec, headers } = require('nats');
const { randomUUID, createHash } = require('crypto');

const sc = StringCodec();
const jc = JSONCodec();

// Namespace fixo para derivar um UUID determinístico (uuidv5) do CNPJ.
// O enrichment-worker exige `company_id` como UUID e usa esse ID para versionar
// os enriquecimentos (enrichment_version). Derivar do CNPJ garante estabilidade
// entre chamadas (re-enriquecimento mantém a mesma empresa no lado do worker).
const B2BASE_NAMESPACE = '6f4c1a2e-9b7d-4e3a-8c5f-1d2e3a4b5c6d';

function deterministicCompanyId(cnpj) {
  const ns = Buffer.from(B2BASE_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(String(cnpj || ''), 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.round(n);
}

// O worker envia um `summary` reduzido no evento completed.v1. Aceitamos tanto
// as chaves antigas (tech_count, commercial_potential) quanto as atuais
// (technologies, people, social_platforms...) publicadas pelo _summary do job_runner.
function buildEnrichmentSummary(summary) {
  return {
    domain: summary.domain ?? null,
    website_active: summary.website_active != null ? Boolean(summary.website_active) : null,
    corporate_email: summary.corporate_email != null ? Boolean(summary.corporate_email) : null,
    launch_velocity: toNumberOrNull(summary.launch_velocity),
    operational_readiness: toNumberOrNull(summary.operational_readiness),
    commercial_potential: toNumberOrNull(summary.commercial_potential),
    tech_count: toIntOrNull(summary.tech_count ?? summary.technologies),
    people: toIntOrNull(summary.people),
    social_platforms: toIntOrNull(summary.social_platforms),
    financial_indicators: toIntOrNull(summary.financial_indicators),
    relationship_edges: toIntOrNull(summary.relationship_edges),
  };
}

// ---------------------------------------------------------------------------
// Config (env com defaults)
// ---------------------------------------------------------------------------
const NATS_URL = process.env.NATS_URL || 'nats://legal-nats.laweragent.svc.cluster.local:4222';
const NATS_STREAM = process.env.NATS_STREAM || 'ENRICHMENT';
const NATS_DURABLE = process.env.NATS_DURABLE || 'b2base-results';
const NATS_REQUEST_SUBJECT = process.env.NATS_REQUEST_SUBJECT || 'enrichment.company.requested.v1';
const NATS_COMPLETED_SUBJECT = process.env.NATS_COMPLETED_SUBJECT || 'enrichment.company.completed.v1';
const NATS_DLQ_SUBJECT = process.env.NATS_DLQ_SUBJECT || 'enrichment.company.dlq.v1';
const NATS_BATCH = parseInt(process.env.NATS_BATCH || '20', 10);
const NATS_FETCH_TIMEOUT_MS = parseInt(process.env.NATS_FETCH_TIMEOUT_MS || '5000', 10);
const NATS_ACK_WAIT_S = parseInt(process.env.NATS_ACK_WAIT_S || '30', 10);

let _nc = null;          // conexão NATS ativa
let _js = null;          // JetStream
let _consumerRunning = false;

function isNatsEnabled() {
  // Desliga o consumer se explicitamente desabilitado (ex.: dev local sem NATS)
  return String(process.env.NATS_ENABLED || 'true') === 'true';
}

function normalizeCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

async function connectNats() {
  if (_nc && !_nc.isClosed()) return _nc;
  try {
    _nc = await connect({
      servers: NATS_URL,
      name: 'b2base-backend',
      reconnect: true,
      maxReconnectAttempts: -1,          // nunca desiste; fica tentando
      reconnectTimeWait: 2000,
      waitOnFirstConnect: false,          // não bloqueia o boot do servidor
    });
    _js = _nc.jetstream();
    console.log(`[nats] conectado a ${NATS_URL}`);
    return _nc;
  } catch (error) {
    // Primeira conexão falhou (ex.: NATS fora do ar). Limpa para permitir
    // nova tentativa na próxima chamada sem estado inconsistente.
    _nc = null;
    _js = null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PUBLISH — enrichment.company.requested.v1
// ---------------------------------------------------------------------------
// Envia um pedido de enriquecimento. Best-effort: se o NATS estiver fora do
// ar, loga e não quebra o request HTTP. Retorna o event_id usado (dedup).
async function requestEnrichment(prisma, prospectOrId) {
  const prospect = typeof prospectOrId === 'string'
    ? await prisma.prospect.findUnique({ where: { id: prospectOrId } })
    : prospectOrId;
  if (!prospect) return null;
  if (!isNatsEnabled()) {
    console.log(`[nats] desabilitado; ignorando pedido para prospect ${prospect.id}`);
    return null;
  }

  const eventId = randomUUID();
  const cnpj = normalizeCnpj(prospect.cnpj);
  // O worker valida `company_id` como UUID (Pydantic uuid.UUID). O id do
  // Prospect é um CUID, então derivamos um UUID estável do CNPJ.
  const companyId = deterministicCompanyId(cnpj);

  if (cnpj.length !== 14) {
    console.warn(`[nats] CNPJ inválido para prospect ${prospect.id}: "${prospect.cnpj}" -> irá para a DLQ.`);
    // Ainda publicamos; o worker manda para a DLQ enrichment.company.dlq.v1.
  }

  const payload = {
    version: '1',
    event_id: eventId,
    company_id: companyId,
    cnpj,
    company_name: prospect.companyName || undefined,
    trade_name: prospect.tradeName || undefined,
    published_at: new Date().toISOString(),
  };

  try {
    const nc = await connectNats();
    // js.publish exige ack do JetStream: se o stream não conseguir armazenar a
    // mensagem (ex.: storage do server cheio), o erro volta aqui em vez de ser
    // descartado silenciosamente como no publish core (fire-and-forget).
    const js = nc.jetstream();
    // Nats-Msg-Id: dedup no envio (reenvios dentro de 2 min são ignorados).
    const hdr = headers();
    hdr.set('Nats-Msg-Id', eventId);
    await js.publish(
      NATS_REQUEST_SUBJECT,
      jc.encode(payload),
      { headers: hdr, timeout: 5000 }
    );
    console.log(`[nats] pedido publicado ${NATS_REQUEST_SUBJECT} company=${companyId} cnpj=${cnpj} event=${eventId}`);
    return eventId;
  } catch (error) {
    console.error(`[nats] falha ao publicar pedido para ${companyId}: ${error.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PERSISTÊNCIA IDEMPOTENTE
// ---------------------------------------------------------------------------
// Upsert da linha de enriquecimento com chave única (companyId, enrichmentVersion).
// Depois aplica os campos no Prospect somente se a versão for mais nova do que
// a já aplicada (protege contra reordering / mensagens antigas chegando depois).
async function persistEnrichmentResult(prisma, result) {
  // O evento CompanyResultEventV1 traz enrichment_version/status/cnpj/company_id
  // no TOPO do payload; `summary` contém apenas os 7 campos reduzidos (domain,
  // commercial_potential etc.). Ler essas chaves do topo evita cair no default.
  const summary = result.summary || {};
  const cnpj = normalizeCnpj(result.cnpj || summary.cnpj);
  const companyId = result.company_id || summary.company_id || deterministicCompanyId(cnpj);
  // O worker publica `enrichment_version: null` e `version` como string ("1").
  // Sem a coerção o Prisma rejeita a query (Expected Int, provided String) e a
  // mensagem entra em loop de nak até ser abandonada (max_deliver).
  const enrichmentVersion = toIntOrNull(result.enrichment_version ?? result.version) ?? 1;
  const status = (result.status || 'COMPLETED').toUpperCase();
  const requestEventId = result.request_event_id || null;

  if (!companyId && !cnpj) {
    throw new Error('Enrichment result sem company_id nem cnpj — impossível persistir');
  }

  // Registra/upsert idempotente. Se já existe com a mesma (companyId, version),
  // mantemos os dados originais (não sobrescreve com duplicata).
  const existing = await prisma.cnpjEnrichment.findUnique({
    where: { companyId_enrichmentVersion: { companyId, enrichmentVersion } },
  });

  const row = await prisma.cnpjEnrichment.upsert({
    where: { companyId_enrichmentVersion: { companyId, enrichmentVersion } },
    create: {
      companyId,
      cnpj,
      enrichmentVersion,
      requestEventId,
      status,
      errorCode: summary.error_code || null,
      errorMessage: summary.error_message || null,
      score: toIntOrNull(summary.commercial_potential),
      rawPayload: result,
    },
    update: {
      // Nunca sobrescreve dados válidos já persistidos com campo undefined/null.
      ...((existing?.status !== 'COMPLETED' && status === 'COMPLETED') ? {
        status,
        errorCode: summary.error_code || null,
        errorMessage: summary.error_message || null,
      } : {}),
    },
  });

  // Aplica no Prospect apenas se for um resultado mais novo do que o aplicado.
  // Correlacionamos por CNPJ (único), pois o `company_id` do pipeline é um UUID
  // derivado do CNPJ (não é o id CUID do Prospect).
  const prospect = cnpj
    ? await prisma.prospect.findUnique({ where: { cnpj } })
    : null;

  if (prospect) {
    const appliedVersion = prospect.enrichmentVersion || 0;
    if (status === 'COMPLETED' || status === 'PARTIAL') {
      if (enrichmentVersion > appliedVersion) {
        const commercialPotential = toIntOrNull(summary.commercial_potential);
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            ...(commercialPotential != null ? { opportunityScore: commercialPotential } : {}),
            enrichmentSummary: buildEnrichmentSummary(summary),
            enrichmentStatus: status === 'PARTIAL' ? 'partial' : 'enriched',
            enrichmentSource: 'nats.enrichment',
            enrichmentError: null,
            enrichmentVersion,
            enrichedAt: new Date(),
            // Enriquecimento concluído: card em "Em Qualificação" avança
            // automaticamente para "Prontas para contato".
            ...(prospect.status === 'prospect' ? { status: 'qualified' } : {}),
          },
        });

        // Suíte multicanal pós-enriquecimento (email/WhatsApp). Falhas
        // isoladas não afetam o consumer.
        try {
          const campaignSuite = require('./campaign-suite');
          await campaignSuite.onLeadEnriched(prisma, {
            ...prospect,
            enrichmentStatus: status === 'PARTIAL' ? 'partial' : 'enriched',
            enrichmentVersion,
          });
        } catch (suiteErr) {
          console.error('[suite] erro pós-enriquecimento (nats):', suiteErr.message);
        }
      }
    } else if (status === 'FAILED') {
      if (enrichmentVersion > appliedVersion) {
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            enrichmentStatus: 'error',
            enrichmentSource: 'nats.enrichment',
            enrichmentError: row.errorMessage || summary.error_message || 'Enrichment failed',
            enrichmentVersion,
            enrichedAt: new Date(),
          },
        });
      }
    }
    // DISCARDED: pedido inválido — marcamos sem aplicar dados.
  }

  return row;
}

// ---------------------------------------------------------------------------
// CONSUMER — enrichment.company.completed.v1 (durável, idempotente)
// ---------------------------------------------------------------------------
async function startEnrichmentConsumer(prisma) {
  if (!isNatsEnabled()) {
    console.log('[nats] consumer desabilitado (NATS_ENABLED=false).');
    return;
  }

  try {
    const nc = await connectNats();
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();

    // Garante o consumer durável exclusivo (cria se não existir).
    try {
      await jsm.consumers.info(NATS_STREAM, NATS_DURABLE);
      console.log(`[nats] consumer durável já existe: ${NATS_DURABLE}`);
    } catch (_e) {
      await jsm.consumers.add(NATS_STREAM, {
        durable_name: NATS_DURABLE,
        filter_subject: NATS_COMPLETED_SUBJECT,
        ack_policy: 'explicit',
        ack_wait: NATS_ACK_WAIT_S * 1000 * 1000 * 1000, // nanoseconds
        max_deliver: 5,
      });
      console.log(`[nats] consumer durável criado: ${NATS_DURABLE}`);
    }

    _consumerRunning = true;
    console.log(`[nats] consumindo ${NATS_COMPLETED_SUBJECT} (durável=${NATS_DURABLE})`);

    // Loop de consumo em pull. Roda em background e reconecta sozinho.
    (async function consumeLoop() {
      while (_consumerRunning) {
        try {
          const info = await jsm.consumers.info(NATS_STREAM, NATS_DURABLE);
          const consumer = js.consumers.getPullConsumerFor(info);
          const msgs = await consumer.fetch({ max_messages: NATS_BATCH, expires: NATS_FETCH_TIMEOUT_MS });
          for await (const m of msgs) {
            try {
              const result = jc.decode(m.data);
              await persistEnrichmentResult(prisma, result);
              await m.ack();            // ACK somente após persistir
            } catch (err) {
              console.error('[nats] erro ao processar mensagem:', (err && (err.stack || err.message)) || String(err));
              try {
                await m.nak();          // reentrega se falhar
              } catch (_) { /* ignora */ }
            }
          }
        } catch (err) {
          // Timeout/sem mensagens é normal; apenas segue o loop.
          if (!(err && (String(err.message).includes('timeout') || String(err.message).includes('nothing') || err.code === '404'))) {
            console.error('[nats] erro no loop do consumer:', err.message);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();
  } catch (error) {
    console.error('[nats] falha ao iniciar consumer:', error.message);
  }
}

// ---------------------------------------------------------------------------
// DLQ MONITOR — enrichment.company.dlq.v1
// ---------------------------------------------------------------------------
async function startDlqMonitor() {
  if (!isNatsEnabled()) return;
  try {
    const nc = await connectNats();
    const sub = nc.subscribe(NATS_DLQ_SUBJECT);
    (async () => {
      for await (const m of sub) {
        try {
          const data = jc.decode(m.data);
          console.warn(`[nats][DLQ] mensagem rejeitada: ${JSON.stringify(data)}`);
        } catch (_e) {
          console.warn(`[nats][DLQ] mensagem não-JSON recebida: ${sc.decode(m.data)}`);
        }
      }
    })();
    console.log(`[nats] monitorando DLQ ${NATS_DLQ_SUBJECT}`);
  } catch (error) {
    console.error('[nats] falha ao monitorar DLQ:', error.message);
  }
}

async function shutdown() {
  _consumerRunning = false;
  if (_nc) {
    try { await _nc.drain(); } catch (_e) { /* ignora */ }
    try { await _nc.close(); } catch (_e) { /* ignora */ }
    _nc = null;
    _js = null;
  }
}

module.exports = {
  isNatsEnabled,
  connectNats,
  requestEnrichment,
  startEnrichmentConsumer,
  startDlqMonitor,
  persistEnrichmentResult,
  shutdown,
  NATS_URL,
  NATS_STREAM,
  NATS_DURABLE,
};
