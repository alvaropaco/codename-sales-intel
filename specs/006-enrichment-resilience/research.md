# Research: Resiliência e Observabilidade do Enriquecimento

**Feature**: 006-enrichment-resilience | **Date**: 2026-09-20

Decisões técnicas da fase de planejamento, ancoradas no código e na infra atual
(diagnóstico de produção de 2026-09-20: 1.869 FAILED, 756 PARTIAL, circuito PDL
`cb:pdl:last = OPEN`, workers vivos, NATS sem backlog).

## R1 — PARKED: estado de banco + agendamento, não contrato NATS novo

**Decision**: `PARKED` é um novo valor de `EnrichmentTask.status` com campos
`nextAttemptAt` (agendamento) e `parkedAt`/`parkCycles`. O sweeper re-publica a
task **pelos subjects NATS existentes** (mesmo payload de retry de hoje) — nenhum
subject/stream novo. Auditoria de cada ciclo na tabela nova
`EnrichmentTaskRetryEvent`.

**Rationale**: o caminho de retry atual já publica re-execução com attempt+1 e os
workers são idempotentes (runtime SDK); reusar o mesmo pipeline evita contrato
novo (constituição II) e qualquer worker antigo continua entendendo a mensagem.

**Alternatives considered**: tópico dedicado `enrichment.task.parked.v1` com
consumer próprio — rejeitado: duplica mecanismo de entrega e cria consumidor
novo para um fluxo que o resync já sabe publicar; guardar parked só no Redis —
rejeitado: estado de retry precisa ser durável e consultável (jobs PARTIAL dependem dele).

## R2 — Sweeper: in-process no server-prod, com lock em Redis

**Decision**: sweeper roda no server-prod (intervalo `ENRICHMENT_SWEEPER_INTERVAL_MS`,
default 60s; execução no boot + `setInterval`), re-publicando tasks `PARKED` com
`nextAttemptAt <= now`, em lotes, com **token bucket em Redis por provedor**
(`ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN`, default 6/min) e lock de líder
(Redis SET NX) para sobreviver a réplicas futuras. Endpoint SRE
`POST /api/system/enrichment-sweeper/run` (mesmo `X-Internal-Token`) para
disparo manual.

**Rationale**: o server-prod já é o dono do enrichment-manager e do padrão
`resumePendingEnrichments` (boot + endpoint SRE); replicar o padrão elimina
novidade operacional. Lock de líder é barato e resolve réplica futura.

**Alternatives considered**: sweeper como worker dedicado (deployment próprio) —
rejeitado: mais deploy para um loop de 60s; cron externo — rejeitado: estados
internos do motor são insumo.

## R3 — Retry respeita `retryAfterMs` do circuito (A4)

**Decision**: ao aplicar falha com `PROVIDER_CIRCUIT_OPEN`/`RATE_LIMIT`, o
`retryAfterMs` devolvido pelo provider-registry define o `nextAttemptAt` (em vez
do degrau genérico de `RETRY_DELAYS_MS`). A janela imediata é estendida para
`10s, 30s, 2m, 10m, 30m` (`RETRY_DELAYS_MS` default atualizado) antes de park.

**Rationale**: o circuito já sabe quando o provedor tende a aceitar; usar esse
valor elimina tentativas fadadas a falhar (hoje o PDL reabre o circuito a cada
degrau curto).

## R4 — Invariante "nunca FAILED transitório" e janela de desistência

**Decision**: em `applyFailure`, quando `attempt >= maxAttempts` e o erro é
TRANSIENTE (contrato §TRANSIENT: TIMEOUT, RATE_LIMIT, PROVIDER_CIRCUIT_OPEN,
PROVIDER_UNAVAILABLE, NETWORK_ERROR, INTERNAL) → task `PARKED`
(`nextAttemptAt = now + plateau`), **nunca FAILED**. Não-transiente → FAILED
terminal + notificação (US5). `PARKED` tem janela de desistência
(`ENRICHMENT_PARK_WINDOW_HOURS`, default 72h): estourou → `FAILED` real
(`reason: PARK_WINDOW_EXPIRED`) + notificação — não há loop infinito.

**Rationale**: atende a premissa sem transformar lixo em loop; a janela longa dá
tempo para incidentes de horas (padrão observado: MCP degradado por horas,
DeepInfra sem saldo por horas).

**Alternatives considered**: retry infinito sem janela — rejeitado: tasks de
entrada inválida mal classificadas rodariam para sempre; FAILED com flag
"retryable" — rejeitado: mantém a semântica terminal que causou o problema.

## R5 — Job `DEGRADED` (não-terminal) com compatibilidade de eventos

**Decision**: `EnrichmentJob.status` ganha `DEGRADED` (existiam só tasks
`PARKED` ativas ao finalizar). `maybeFinalizeJob` não finaliza job com tasks
PARKED: o job passa a `DEGRADED`; quando a última parked conclui/falha-real,
finaliza normal (`COMPLETED`/`FAILED`/`PARTIAL`) publicando
`enrichment.job.completed.v1` como hoje. Um job `PARTIAL`/`FAILED` antigo que
ganhar tasks re-enfileiradas também volta a `DEGRADED` e pode refinalizar —
consumidores do evento recebem um segundo `completed.v1` (aditivo; quem persiste
estado idempotente atualiza sem duplicar — padrão já exigido pelo runtime).

**Rationale**: mantém o contrato de evento estável (nenhum subject novo) e dá a
semântica "não terminou, está esperando provedor".

**Alternatives considered**: evento novo `job.degraded.v1` — rejeitado nesta
versão (nenhum consumidor precisa agir sobre degradado; é visível no banco/
dashboard); mutar o payload do `completed.v1` — rejeitado (quebra contrato v1).

## R6 — bbot/spiderfoot: deadline com sucesso parcial + fallback (worker Python)

**Decision**: no `services/company-enrichment-worker`, a execução das capabilities
OSINT ganha deadline interna (bbot 240s, spiderfoot 480s — abaixo dos timeouts
atuais de 300s/600s): ao atingir o prazo, o worker **completa a task com
sucesso** marcando `partial: true` no resultado com os eventos coletados até ali.
O planejador de capabilities (graph planner) passa a incluir spiderfoot apenas
quando o resultado do bbot vier vazio/insuficiente (< N eventos).

**Rationale**: os eventos já chegam incrementalmente (`directive_collected`);
commit no prazo transforma TIMEOUT em dado útil. Fallback corta ~metade do tempo
da esteira (hoje os dois scans sempre rodam). Muda o serviço Python do próprio
monorepo — testes pytest existentes (graph planner, osint providers) cobrem o
caminho.

**Alternatives considered**: fila lenta separada (slow lane) — adiado: útil quando
houver volume, desnecessário agora (YAGNI); substituir spiderfoot por probes
leves — adiado (mudança de cobertura de dados, decisão de produto separada).

## R7 — Exposição de métricas: anotações de pod + porta 9090 (plataforma) e servidor no Python

**Decision**: plataforma — as métricas já existem em `:9090/metrics`
(`startMetricsServer`); falta o Prometheus descobrir: anotações
`prometheus.io/scrape: "true"` + `prometheus.io/port: "9090"` no deployment do
b2base (o scraping configs do monitoring-stack já filtram por essas anotações).
Worker Python — `prometheus_client` já define métricas mas não as expõe: subir
`start_http_server(9091)` no boot do worker + mesmas anotações. Novos indicadores
(plataforma): `enrichment_tasks_parked` (gauge por provedor),
`enrichment_tasks_parked_total`, `enrichment_tasks_republished_total{provider}`,
`enrichment_failures_real_total{capability}`, `enrichment_jobs_degraded`;
(Python): `enrichment_osint_scans_total{tool,outcome=partial|full|timeout}`,
`enrichment_osint_scan_duration_seconds{tool}`.

**Rationale**: zero componente novo — o Prometheus do monitoring-stack já tem o
scrape anotado por pod (values.yaml, additionalScrapeConfigs) e o Grafana já tem
datasource Prometheus provisionado.

**Alternatives considered**: ServiceMonitor CRD — rejeitado: o cluster já usa
anotação de pod no additionalScrapeConfigs (padrão existente vence); pushgateway —
rejeitado (pull é o padrão do stack).

## R8 — Dashboard Grafana provisionado como código (k8s-infra)

**Decision**: dashboard JSON em
`k8s-infra/apps/b2base/templates/grafana-dashboard.yaml` — ConfigMap com label
`grafana_dashboard: "1"` (sidecar do kube-prometheus-stack já roda e importa).
Painéis: (1) sucesso/taxa/duração p50-p95, (2) falhas reais por
capability/provedor/org, (3) parked por idade/provedor, (4) estado dos circuitos,
(5) volume de jobs por estado (COMPLETED/DEGRADED/PARTIAL), (6) filas NATS
(pending/ack_pending via métricas do JetStream já exportadas). Variável
`org` (label do orgId) nos painéis por organização.

**Rationale**: sidecar já provisiona dashboards automaticamente; GitOps (o
dashboard é versionado e aplicado pelo ArgoCD, constituição VII).

**Alternatives considered**: criar dashboard na UI e exportar depois — rejeitado:
não versiona; Grafana Alerting para as notificações — rejeitado para detalhe
task-level (ver R9), mantido como evolução futura para agregados.

## R9 — Notificador platform-side: Slack (tempo real) + e-mail (digest)

**Decision**: módulo `enrichment-notifier.js` na plataforma:
- **Gatilhos**: (a) task terminal não-transiente; (b) task parked expirando a
  janela (72h); (c) circuito de provedor aberto > 1h (detecção no sweeper).
- **Canais**: Slack via `POST SLACK_WEBHOOK_URL` (alertas imediatos, dedup por
  chave em Redis — `alert:<dedupKey>` com TTL 1h para circuito, permanente para
  task terminal); digest diário por e-mail via `transactional-email.js`
  (`ALERT_EMAIL_TO`), às 12:00 UTC, com agregados do dia por organização.
- **Registro**: tabela `OpsNotification` (dedupKey único, payload, canal,
  enviado em) — auditoria e dedup durable.
- Falha de entrega é apenas log (nunca afeta o enriquecimento).

**Rationale**: o detalhe (org, lead, capability, erro) está no banco da
plataforma — notificar de dentro do serviço evita expor isso via métricas;
reusa a infra de e-mail existente; Slack é um fetch simples sem dependência.

**Alternatives considered**: Alertmanager (kube-prometheus-stack) com receivers
Slack/e-mail — rejeitado para falha task-level: a regra ficaria cega a
org/lead/capability (precisaria exposar isso como labels de métricas de alta
cardinalidade); mantido como evolução futura para agregados de painel.

## R10 — Backlog: reenfileiramento seletivo e idempotente

**Decision**: `scripts/backfill-requeue-failed.js` — seleciona tasks `FAILED`
cujo `lastError.type` ∈ TRANSIENTE e cria o caminho de volta: task → `PARKED`
(`nextAttemptAt` escalonado por lote) para o sweeper drenar; para jobs `PARTIAL`,
recria apenas as capabilities ausentes/falhadas-transitórias (mesma lógica de
criação do planner) mantendo `enrichmentVersion` (merge idempotente). Exclui:
tasks não-transientes, leads que mudaram de org, jobs cancelados. Rate limit do
sweeper protege os provedores durante a drenagem (~1.869 tasks em lotes de
60/min no máximo).

**Rationale**: aproveita integralmente o mecanismo novo (US1) em vez de duplicar
lógica; idempotência por verificação de "já existe retry event para esta
task/versão".

**Alternatives considered**: replay da DLQ NATS — rejeitado: a DLQ é best-effort
(mensagens podem não estar lá); o estado verdadeiro está no Postgres.

## R11 — Configuração e segredos

**Decision**: novas envs na plataforma: `ENRICHMENT_SWEEPER_INTERVAL_MS` (60000),
`ENRICHMENT_PARK_WINDOW_HOURS` (72),
`ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN` (6), `SLACK_WEBHOOK_URL`,
`ALERT_EMAIL_TO`; no worker Python: `OSINT_BBOT_DEADLINE_S` (240),
`OSINT_SPIDERFOOT_DEADLINE_S` (480), `OSINT_SPIDERFOOT_MIN_EVENTS` (5). Segredos
(SLACK_WEBHOOK_URL, destinatários) no Infisical `/b2base` — nunca em git.

**Rationale**: segue o padrão `envInt` do enrichment-config e o caminho de
segredos existente (constituição V).

## R12 — Observabilidade da própria feature

**Decision**: contadores/gauges em `metrics.js` conforme `contracts/metrics.md`;
logs estruturados por ciclo do sweeper (taskId, provider, próxima tentativa) e
por notificação (dedupKey, canal, status de entrega). Python: idem nos scans.

**Rationale**: constituição VII; SC-001/SC-004 dependem desses indicadores.
