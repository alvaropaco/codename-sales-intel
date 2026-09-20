# Contracts: Resiliência e Observabilidade do Enriquecimento

**Feature**: 006-enrichment-resilience | **Date**: 2026-09-20

Três superfícies: métricas Prometheus (para o Grafana), notificações
(Slack/e-mail) e endpoints SRE. Nenhum contrato NATS existente é alterado — a
re-publicação do sweeper reusa os subjects atuais (`enrichment.task.*`), com os
campos de retry já previstos no contrato (attempt/maxAttempts).

## 1. Métricas Prometheus

### Plataforma (Node) — `:9090/metrics` (metrics.js)

| Métrica | Tipo | Labels | Descrição |
|---|---|---|---|
| `b2base_enrichment_tasks_parked` | Gauge | `provider` | Tasks parked agora (aguardando sweeper) |
| `b2base_enrichment_tasks_parked_total` | Counter | `provider` | Total de entradas em parked desde o boot |
| `b2base_enrichment_tasks_republished_total` | Counter | `provider` | Re-publicações efetuadas pelo sweeper |
| `b2base_enrichment_park_expired_total` | Counter | `capability` | Tasks que desistiram após a janela longa (falha real) |
| `b2base_enrichment_failures_real_total` | Counter | `capability`, `error_type` | Falhas terminais não-transientes |
| `b2base_enrichment_jobs_degraded` | Gauge | — | Jobs em estado degradado (aguardando parked) |
| `b2base_enrichment_task_duration_seconds` | Histograma | `capability` | Já existe (`observeEnrichmentTaskDuration`) — painel p50/p95 |
| `b2base_enrichment_provider_circuit_state` | Gauge | `provider` | 0 = HEALTHY, 1 = HALF-OPEN/DEGRADED, 2 = OPEN (espelho do Redis) |

### Worker Python (`:9091/metrics`, novo servidor)

| Métrica | Tipo | Labels | Descrição |
|---|---|---|---|
| `enrichment_osint_scans_total` | Counter | `tool` (bbot\|spiderfoot), `outcome` (full\|partial\|empty) | Scans por desfecho — `partial` é sucesso com deadline |
| `enrichment_osint_scan_duration_seconds` | Histograma | `tool` | Duração real do scan |
| `enrichment_osint_fallback_total` | Counter | `from`, `to` | Ativações de fallback (ex.: bbot→spiderfoot) |

### Exposição (k8s-infra)

- Anotações nos pods (`prometheus.io/scrape: "true"`, `prometheus.io/port`):
  b2base-app `9090`, workers engine `9090`, worker Python `9091`.
- Prometheus do monitoring-stack já coleta anotações de pod (sem mudança lá).
- Grafana: ConfigMap com label `grafana_dashboard: "1"` (sidecar importa);
  datasource Prometheus já provisionado.

## 2. Notificações (Slack + e-mail)

### Dedup e registro

`dedupKey` único em `OpsNotification`:
- task terminal não-transiente: `task_failed:<taskId>` (permanente);
- circuito aberto > 1h: `circuit:<provider>:<yyyymmddhh>` (janela 1h — alerta
  único por hora enquanto persiste);
- park expirado: `park_expired:<taskId>`;
- digest diário: `digest:<yyyymmdd>`.

### Slack (alertas em tempo real)

`POST SLACK_WEBHOOK_URL` com blocks:

```json
{
  "text": "🔴 Enriquecimento: falha real",
  "blocks": [{
    "type": "section",
    "text": { "type": "mrkdwn", "text": "*<título>*\n*Org:* <nome>\n*Lead:* <empresa> (<cnpj|sem CNPJ>)\n*Capability:* <capability>\n*Erro:* <tipo — mensagem>\n*Task:* <taskId>" }
  }]
}
```

Condições de envio imediato: `task_failed` (terminal não-transiente),
`park_expired`, `circuit_open` persistente (> 1h — com contagem de tasks
afetadas). Dedup via `OpsNotification.dedupKey` (insert conflict → não envia).

### E-mail (digest diário, 12:00 UTC)

Para `ALERT_EMAIL_TO` via transactional-email (Resend). Conteúdo (texto/HTML
simples, PT-BR):

- Concluídas nas últimas 24h (count + taxa de sucesso);
- Falhas reais por tipo/capability (com os dedupKeys do dia);
- Parked mais antigas (top 10: lead, provedor, horas aguardando);
- Jobs degradados (count) e circuitos abertos no período.

### Env vars (Infisical `/b2base` — nunca em git)

| Var | Uso |
|---|---|
| `SLACK_WEBHOOK_URL` | webhook de entrada dos alertas |
| `ALERT_EMAIL_TO` | destinatário(s) do digest/alertas (separados por vírgula) |

## 3. Endpoints SRE (internos, `X-Internal-Token`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/system/enrichment-sweeper/run` | Dispara um ciclo do sweeper agora (body: `{ "limit": 100 }` opcional). Responde `{ scanned, republished }` |
| GET | `/api/system/enrichment/parked?limit=50` | Lista tasks parked (taskId, org, provedor, cycle, idade, próximo momento) — inspeção sem banco |

## 4. Configuração (env, não-segredos)

| Var | Default | Descrição |
|---|---|---|
| `ENRICHMENT_SWEEPER_INTERVAL_MS` | 60000 | Ciclo do sweeper |
| `ENRICHMENT_PARK_WINDOW_HOURS` | 72 | Janela antes de desistir (→ falha real) |
| `ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN` | 6 | Re-publicações máx./min por provedor |
| `RETRY_DELAYS_MS` | `10000,30000,120000,600000,1800000` | Nova janela imediata estendida |
| `OSINT_BBOT_DEADLINE_S` | 240 | Deadline do bbot (worker Python) |
| `OSINT_SPIDERFOOT_DEADLINE_S` | 480 | Deadline do spiderfoot |
| `OSINT_SPIDERFOOT_MIN_EVENTS` | 5 | bbot abaixo disso → spiderfoot roda como fallback |

## 5. Contratos NATS — o que muda (e o que não muda)

**Não muda**: subjects, payloads e consumidores existentes. O sweeper re-publica
o mesmo evento de retry de hoje (attempt/maxAttempts no payload) — o parked é
estado de banco, não de fila.

**Comportamental (aditivo)**: um `enrichment.job.completed.v1` pode ser seguido
de um segundo evento do mesmo job (quando capabilities re-enfileiradas concluem
depois) — consumidores idempotentes (padrão do runtime) atualizam estado sem
duplicar. Nenhuma migração `.v2` necessária.
