/**
 * metrics.js — endpoint Prometheus (/metrics) para monitorar outreach e
 * disparo de campanhas.
 *
 * Expõe:
 *   - b2base_queue_jobs{queue,state}          profundidade das filas Bull
 *   - b2base_outreach_emails_sent_total       emails enviados (counter)
 *   - b2base_outreach_emails_failed_total     emails que falharam (counter)
 *   - b2base_outreach_emails_rate_limited_total  envios adiados por rate limit
 *   - b2base_whatsapp_messages_sent_total     WhatsApp enviado (counter)
 *   - b2base_whatsapp_messages_failed_total   WhatsApp falhou (counter)
 *   - b2base_outreach_messages{status}        total por status (Postgres)
 *   - b2base_whatsapp_messages{status}        total por status (Postgres)
 *   - process_* e nodejs_*                    métricas padrão do runtime
 *
 * O servidor de métricas roda em METRICS_PORT (default 9090), separado do
 * app (3001), para não expor /metrics no ingress público.
 *
 * O require do prom-client é defensivo: se a dependência não estiver
 * instalada, o módulo vira um no-op e o app continua subindo normalmente.
 */
const http = require('http');

let client = null;
try {
  client = require('prom-client');
} catch (_) {
  client = null;
}
const enabled = Boolean(client);

const registry = enabled ? new client.Registry() : null;
if (registry) registry.setDefaultLabels({ app: 'b2base' });

const QUEUE_NAMES = [
  'outreach:prepare',
  'outreach:message-send',
  'outreach:gmail-sync',
  'whatsapp:sequence',
  'whatsapp:send',
];

const queueJobsGauge = enabled
  ? new client.Gauge({
      name: 'b2base_queue_jobs',
      help: 'Número de jobs Bull por fila e estado',
      labelNames: ['queue', 'state'],
      registers: [registry],
    })
  : null;

const emailsSentTotal = enabled
  ? new client.Counter({
      name: 'b2base_outreach_emails_sent_total',
      help: 'Emails de outreach enviados com sucesso',
      registers: [registry],
    })
  : null;
const emailsFailedTotal = enabled
  ? new client.Counter({
      name: 'b2base_outreach_emails_failed_total',
      help: 'Emails de outreach que falharam',
      registers: [registry],
    })
  : null;
const emailsRateLimitedTotal = enabled
  ? new client.Counter({
      name: 'b2base_outreach_emails_rate_limited_total',
      help: 'Envios de email adiados por rate limit',
      registers: [registry],
    })
  : null;
const whatsappSentTotal = enabled
  ? new client.Counter({
      name: 'b2base_whatsapp_messages_sent_total',
      help: 'Mensagens WhatsApp enviadas com sucesso',
      registers: [registry],
    })
  : null;
const whatsappFailedTotal = enabled
  ? new client.Counter({
      name: 'b2base_whatsapp_messages_failed_total',
      help: 'Mensagens WhatsApp que falharam',
      registers: [registry],
    })
  : null;

const outreachMessagesGauge = enabled
  ? new client.Gauge({
      name: 'b2base_outreach_messages',
      help: 'Total de mensagens de outreach por status (Postgres)',
      labelNames: ['status'],
      registers: [registry],
    })
  : null;
const whatsappMessagesGauge = enabled
  ? new client.Gauge({
      name: 'b2base_whatsapp_messages',
      help: 'Total de mensagens WhatsApp por status (Postgres)',
      labelNames: ['status'],
      registers: [registry],
    })
  : null;

if (enabled) {
  client.collectDefaultMetrics({ register: registry });
}

function inc(counter) {
  if (counter) counter.inc();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('metrics timeout')), ms)),
  ]);
}

/** Atualiza os gauges de profundidade de fila a partir do Redis (Bull). */
async function refreshQueueMetrics() {
  if (!queueJobsGauge) return;
  const { getQueues } = require('./outreach-queues');
  const { getWhatsAppQueues } = require('./whatsapp-queues');

  let queues = {};
  try {
    const q = getQueues();
    const wq = getWhatsAppQueues();
    queues = {
      'outreach:prepare': q.prepare,
      'outreach:message-send': q.send,
      'outreach:gmail-sync': q.gmailSync,
      'whatsapp:sequence': wq.sequence,
      'whatsapp:send': wq.send,
    };
  } catch (_) {
    return;
  }

  for (const [name, q] of Object.entries(queues)) {
    if (!q) continue;
    try {
      const counts = await withTimeout(q.getJobCounts(), 3000);
      for (const [state, n] of Object.entries(counts)) {
        queueJobsGauge.set({ queue: name, state }, Number(n) || 0);
      }
    } catch (_) {
      // Redis indisponível — mantém o último valor.
    }
  }
}

/** Atualiza os gauges de total por status a partir do Postgres. */
async function refreshDbMetrics(prisma) {
  if (!prisma || !outreachMessagesGauge) return;
  try {
    const [emailRows, waRows] = await Promise.all([
      prisma.outreachMessage.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.whatsAppMessage.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    outreachMessagesGauge.reset();
    for (const r of emailRows) {
      outreachMessagesGauge.set({ status: r.status }, r._count._all);
    }

    whatsappMessagesGauge.reset();
    for (const r of waRows) {
      whatsappMessagesGauge.set({ status: r.status }, r._count._all);
    }
  } catch (_) {
    // Postgres indisponível — mantém o último valor.
  }
}

async function renderMetrics(prisma) {
  await refreshQueueMetrics();
  await refreshDbMetrics(prisma);
  return registry.metrics();
}

/** Sobe o servidor HTTP de métricas em METRICS_PORT (default 9090). */
function startMetricsServer(prisma) {
  if (!enabled) {
    console.warn('[metrics] prom-client não instalado — /metrics desabilitado (rode `pnpm add prom-client`).');
    return null;
  }

  const port = Number(process.env.METRICS_PORT || 9090);
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' || req.url === '/') {
      try {
        const body = await renderMetrics(prisma);
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('metrics error');
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[metrics] /metrics em http://0.0.0.0:${port}`);
  });
  return server;
}

// ── Métricas do motor de enriquecimento distribuído (spec US8) ──────────────
const enrichmentTasksGauge = enabled
  ? new client.Gauge({
      name: 'b2base_enrichment_tasks',
      help: 'Tasks do motor de enriquecimento por capability e estado',
      labelNames: ['capability', 'state'],
      registers: [registry],
    })
  : null;
const enrichmentDurationHist = enabled
  ? new client.Histogram({
      name: 'b2base_enrichment_task_duration_seconds',
      help: 'Duração da execução de tasks por capability',
      labelNames: ['capability'],
      registers: [registry],
    })
  : null;
const providerRequestsTotal = enabled
  ? new client.Counter({
      name: 'b2base_enrichment_provider_requests_total',
      help: 'Chamadas a providers por resultado (ok/error/rejected)',
      labelNames: ['provider', 'outcome'],
      registers: [registry],
    })
  : null;
const providerStateGauge = enabled
  ? new client.Gauge({
      name: 'b2base_enrichment_provider_state',
      help: 'Estado do circuit breaker por provider (1 = estado vigente)',
      labelNames: ['provider', 'state'],
      registers: [registry],
    })
  : null;
const enrichmentPendingGauge = enabled
  ? new client.Gauge({
      name: 'b2base_enrichment_tasks_pending',
      help: 'Tasks pendentes/em voo por capability (base para autoscaling futuro)',
      labelNames: ['capability'],
      registers: [registry],
    })
  : null;
const qualificationTotal = enabled
  ? new client.Counter({
      name: 'b2base_enrichment_qualification_total',
      help: 'Recalques de score executados pelo consumidor de qualificação',
      registers: [registry],
    })
  : null;
const qualificationFailures = enabled
  ? new client.Counter({
      name: 'b2base_enrichment_qualification_failures_total',
      help: 'Falhas do consumidor de qualificação (isoladas do enriquecimento)',
      registers: [registry],
    })
  : null;

const _lastProviderState = new Map(); // provider → estado vigente (para zerar o anterior)

function setEnrichmentTaskState(capability, state, count) {
  if (enrichmentTasksGauge) enrichmentTasksGauge.set({ capability, state }, count);
}
function observeEnrichmentTaskDuration(capability, seconds) {
  if (enrichmentDurationHist) enrichmentDurationHist.observe({ capability }, seconds);
}
function incEnrichmentProviderRequest(provider, outcome) {
  if (providerRequestsTotal) providerRequestsTotal.inc({ provider, outcome });
}
function setEnrichmentProviderState(provider, state) {
  if (!providerStateGauge) return;
  const previous = _lastProviderState.get(provider);
  if (previous && previous !== state) {
    providerStateGauge.set({ provider, state: previous }, 0);
  }
  providerStateGauge.set({ provider, state }, 1);
  _lastProviderState.set(provider, state);
}
function setEnrichmentPending(capability, count) {
  if (enrichmentPendingGauge) enrichmentPendingGauge.set({ capability }, count);
}
function incQualificationTotal() {
  if (qualificationTotal) qualificationTotal.inc();
}
function incQualificationFailure() {
  if (qualificationFailures) qualificationFailures.inc();
}

/** Pendência por capability (groupby de tasks ativas) — chamada em intervalo. */
async function refreshEnrichmentPendingMetrics(prisma) {
  if (!enabled || !prisma || !prisma.enrichmentTask) return;
  const groups = await prisma.enrichmentTask.groupBy({
    by: ['capability'],
    where: { status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRY', 'TIMEOUT', 'BLOCKED'] } },
    _count: { _all: true },
  });
  for (const g of groups) {
    enrichmentPendingGauge.set({ capability: g.capability }, g._count._all);
  }
}

/** Renderiza apenas o registro (sem refresh de filas/DB — seguro em testes). */
async function renderEnrichmentMetrics() {
  return registry.metrics();
}

// ============================================================================
// ONBOARDING CONVERSACIONAL (Ava) — feature 004
// ============================================================================
const avaExtractDurationHist = enabled
  ? new client.Histogram({
      name: 'b2base_ava_extract_duration_seconds',
      help: 'Duração da extração de ativos da Ava (onboarding conversacional)',
      registers: [registry],
    })
  : null;
const avaExtractFilesTotal = enabled
  ? new client.Counter({
      name: 'b2base_ava_extract_files_total',
      help: 'Arquivos processados pela extração da Ava, por status (ok/failed/unsupported)',
      labelNames: ['status'],
      registers: [registry],
    })
  : null;
const avaExtractLlmFailures = enabled
  ? new client.Counter({
      name: 'b2base_ava_extract_llm_failures_total',
      help: 'Falhas de LLM na extração de ativos da Ava',
      registers: [registry],
    })
  : null;

function observeAvaExtractDuration(ms) {
  if (avaExtractDurationHist) avaExtractDurationHist.observe(ms / 1000);
}
function incAvaExtractFile(status) {
  if (avaExtractFilesTotal) avaExtractFilesTotal.inc({ status });
}
function incAvaExtractLlmFailure() {
  if (avaExtractLlmFailures) avaExtractLlmFailures.inc();
}

module.exports = {
  startMetricsServer,
  refreshQueueMetrics,
  refreshDbMetrics,
  renderMetrics,
  renderEnrichmentMetrics,
  refreshEnrichmentPendingMetrics,
  setEnrichmentTaskState,
  observeEnrichmentTaskDuration,
  incEnrichmentProviderRequest,
  setEnrichmentProviderState,
  setEnrichmentPending,
  incQualificationTotal,
  incQualificationFailure,
  isEnabled: () => enabled,
  incEmailSent: () => inc(emailsSentTotal),
  incEmailFailed: () => inc(emailsFailedTotal),
  incEmailRateLimited: () => inc(emailsRateLimitedTotal),
  incWhatsAppSent: () => inc(whatsappSentTotal),
  incWhatsAppFailed: () => inc(whatsappFailedTotal),
  observeAvaExtractDuration,
  incAvaExtractFile,
  incAvaExtractLlmFailure,
};
