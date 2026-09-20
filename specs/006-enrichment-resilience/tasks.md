# Tasks: Resiliência e Observabilidade do Enriquecimento

**Input**: Design documents from `/specs/006-enrichment-resilience/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUÍDOS por exigência da constituição (princípio III: testes antes da
implementação). Plataforma: `node --test` (`pnpm test`) com fixtures puras e
`test/helpers/fake-prisma.js` — sem banco/rede real. Esteira Python:
`pytest services/company-enrichment-worker/tests/unit -q` (stubs de scan, sem
rede). Quality gate do web: build/typecheck (nenhuma mudança de SPA nesta
feature).

**Organization**: Tasks grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Três superfícies (plan.md):
1. **Plataforma** — raiz do monorepo (módulos planos `*.js`, `test/`, `prisma/`, `scripts/`)
2. **Esteira profunda Python** — `services/company-enrichment-worker/` (pytest)
3. **Infra GitOps** — repo irmão `k8s-infra` (branch `master`; anotações de scrape e dashboard Grafana como código)

## Notas de escopo (research.md R1–R12)

- `PARKED` é estado de banco re-publicado pelos **subjects NATS atuais** — nenhum
  contrato novo (R1). Job `DEGRADED` é valor novo de `EnrichmentJob.status` (R5).
- O sweeper roda in-process no server-prod com lock de líder em Redis e token
  bucket por provedor (R2/R3).
- `retryAfterMs` do provider-registry passa a definir o agendamento (R3).
- Notificador platform-side: Slack em tempo real + digest por e-mail via
  transactional-email; dedup durable em `OpsNotification` (R9).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuração e documentação de ambiente para todas as stories

- [X] T001 [P] Documentar variáveis de ambiente novas em .env.example: `ENRICHMENT_SWEEPER_INTERVAL_MS` (60000), `ENRICHMENT_PARK_WINDOW_HOURS` (72), `ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN` (6), `RETRY_DELAYS_MS` (nova default `10000,30000,120000,600000,1800000`), `OSINT_BBOT_DEADLINE_S` (240), `OSINT_SPIDERFOOT_DEADLINE_S` (480), `OSINT_SPIDERFOOT_MIN_EVENTS` (5) — e nota de que `SLACK_WEBHOOK_URL`/`ALERT_EMAIL_TO` são segredos no Infisical `/b2base` (constituição V)
- [ ] T002 [P] [OPS] Cadastrar `SLACK_WEBHOOK_URL` e `ALERT_EMAIL_TO` no Infisical `/b2base` (env prod) — operacional, fora do git; o código lê do env
  - ⚠️ Reaberta pelo converge (2026-09-20): marcada sem os valores existirem — pré-requisito real para C7 (notificações)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema de dados e métricas base que TODAS as stories exigem

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Alterar prisma/schema.prisma conforme specs/006-enrichment-resilience/data-model.md: `EnrichmentTask` ganha `status 'PARKED'`, `nextAttemptAt DateTime?`, `parkedAt DateTime?`, `parkCycles Int @default(0)` + índice `(status, nextAttemptAt)`; nova tabela `EnrichmentTaskRetryEvent` (taskId FK Cascade, orgId, cycle, errorType, provider?, message?, scheduledFor, publishedAt?, createdAt; índices `(taskId, attempt)` análogo e `(orgId, createdAt)`); nova tabela `OpsNotification` (id, `dedupKey @unique`, kind, severity, orgId?, title, payload Json, channels Json, deliveredAt?, createdAt); `EnrichmentJob.status` documenta valor `DEGRADED`
- [X] T004 Gerar e aplicar a migração via Prisma (`pnpm run db:migrate`, nome `enrichment_resilience`) — nunca `db push`; conferir índice `(status, nextAttemptAt)` na task
- [X] T005 [P] Registrar métricas em metrics.js conforme specs/006-enrichment-resilience/contracts/api.md §1: gauge `b2base_enrichment_tasks_parked` (label `provider`), counters `b2base_enrichment_tasks_parked_total`, `b2base_enrichment_tasks_republished_total` (label `provider`), `b2base_enrichment_park_expired_total` (label `capability`), `b2base_enrichment_failures_real_total` (labels `capability`,`error_type`), gauge `b2base_enrichment_jobs_degraded`, gauge `b2base_enrichment_provider_circuit_state` (label `provider`, 0/1/2) — com helpers inc/set seguindo o padrão existente do arquivo

**Checkpoint**: Foundation ready — schema migrado; user stories podem começar

---

## Phase 3: User Story 1 — Task nunca termina FAILED por erro transitório (Priority: P1) 🎯 MVP

**Goal**: Erro transiente com tentativas esgotadas → `PARKED` com agendamento; sweeper re-publica com taxa por provedor respeitando `retryAfterMs`; job vira `DEGRADED` (não-terminal) e refinaliza ao concluir; janela de 72h → falha real notificável

**Independent Test**: com provedor simulado fora do ar, a task vai a PARKED (nunca FAILED); voltando o provedor, conclui sozinha no próximo ciclo do sweeper; não-transiente continua FAILED + registrada

### Tests for User Story 1 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T006 [P] [US1] Criar test/enrichment-resilience.test.js (fake-prisma, padrão test/qualification.test.js) cobrindo por specs/006-enrichment-resilience/data-model.md: applyFailure com erro TRANSIENTE esgotado → task `PARKED` com `nextAttemptAt` = max(retryAfterMs do provider, plateau do backoff) e `EnrichmentTaskRetryEvent` cycle 1; erro NÃO-transiente → `FAILED` terminal (sem parked); task parked sem sucesso por `ENRICHMENT_PARK_WINDOW_HOURS` → `FAILED` com `lastError.type='PARK_WINDOW_EXPIRED'` + callback de notificação; job cujas tasks restantes são todas PARKED → status `DEGRADED` e SEM publicação de completion; última parked conclui → job refinaliza `COMPLETED` e publica
- [X] T007 [P] [US1] Criar test/enrichment-sweeper.test.js (fake-prisma + fake-redis/`test/helpers/fake-redis.js`) cobrindo: seleciona apenas `PARKED` com `nextAttemptAt <= now`; re-publica pelo subject atual da capability com attempt+1; token bucket por provedor limita re-publicações a `ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN`; grava `publishedAt` no retry event do ciclo (nunca publica o mesmo ciclo 2×); lock de líder Redis SET NX impede dois sweepers simultâneos; lead excluído → descarta silencioso; expõe contadores para métricas

### Implementation for User Story 1

- [X] T008 [US1] Atualizar enrichment-config.js: `RETRY_DELAYS_MS` default → `10000,30000,120000,600000,1800000`; novas envs `ENRICHMENT_SWEEPER_INTERVAL_MS`, `ENRICHMENT_PARK_WINDOW_HOURS`, `ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN` (padrões do contracts/api.md §4) exportadas como funções
- [X] T009 [US1] Alterar enrichment-manager.js: `applyFailure` — erro TRANSIENTE (lista de enrichment-contracts §TRANSIENT) com tentativas esgotadas → `PARKED` com `nextAttemptAt = now + max(retryAfterMs || 0, plateau do backoff)`, `parkedAt`, `parkCycles+1` + linha em `EnrichmentTaskRetryEvent` + métrica parked; não-transiente → `FAILED` + callback de falha real; `maybeFinalizeJob` — sobrevindo só tasks PARKED → job `DEGRADED` sem publicar completion; conclusão tardia refinaliza (R5)
- [X] T010 [US1] Criar enrichment-sweeper.js: `createEnrichmentSweeper({ prisma, js, redis, config, notifier, logger, now })` — lock de líder (SET NX), varre `PARKED` vencidas, token bucket por provedor, re-publica no subject da capability (payload de retry existente), grava `publishedAt`, expira janela (`PARK_WINDOW_EXPIRED` → falha real + notifier), métricas via `onMetric`; exporta `createSweeperLoop` (intervalo + boot)
- [X] T011 [US1] Ajustar workers/sdk/runtime.js para respeitar `retryAfterMs` do provider como atraso do re-publicar (hoje usa só o degrau de backoff) — mantendo os subjects e payload atuais (R3)
- [X] T012 [US1] Ligar no server-prod.js: sweeper no boot (lock + intervalo) + endpoint interno `POST /api/system/enrichment-sweeper/run` (X-Internal-Token, body `{limit}` opcional, responde `{scanned, republished}`) + `GET /api/system/enrichment/parked?limit=50` (inspeção de tasks parked por org)

**Checkpoint**: US1 independente — nenhum transiente novo vira FAILED; parked drena sozinha; `pnpm test` verde

---

## Phase 4: User Story 2 — Backlog atual volta ao processamento (Priority: P1)

**Goal**: 1.869 FAILED transitórios + capabilities faltantes de 756 PARTIAL re-enfileirados de forma idempotente; jobs recalculam para concluído

**Independent Test**: `--dry` mostra contagem coerente; rodada real re-publica em lotes (taxa do sweeper); segunda rodada não duplica; jobs PARTIAL recalculam ao longo das horas

### Tests for User Story 2 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T013 [P] [US2] Criar test/backfill-requeue-failed.test.js (fake-prisma) cobrindo: re-enfileira apenas FAILED com `lastError.type` TRANSIENTE; não-transiente fica de fora e é retornado em `skippedRealFailures`; job PARTIAL ganha só as capabilities ausentes/falhadas-transitórias (nada de recriar as concluídas); idempotente na 2ª passada; `--dry` não escreve; escalonamento (`nextAttemptAt` distribuído por lote) conforme contracts/api.md

### Implementation for User Story 2

- [X] T014 [US2] Criar scripts/backfill-requeue-failed.js (padrão scripts/backfill-*): seleção por `lastError.type` ∈ TRANSIENTE (enrichment-contracts), re-publicação escalonada via sweeper/park (`PARKED` + `nextAttemptAt` distribuído), recriação de capabilities faltantes de jobs PARTIAL mantendo `enrichmentVersion`, CLI `--dry --limit --org`; resumo `{ scanned, requeued, skippedRealFailures }` per FR-008

**Checkpoint**: US2 independente — backlog drenando com taxa controlada; jobs recalculam para concluído

---

## Phase 5: User Story 3 — Timeout de OSINT profundo não é falha (Priority: P1)

**Goal**: bbot/spiderfoot com deadline + sucesso parcial (flag `partial`); spiderfoot só como fallback do bbot; métricas de scans

**Independent Test**: scan lento força deadline → task conclui parcial com eventos coletados; bbot com conteúdo não dispara spiderfoot; `pytest` do worker verde

### Tests for User Story 3 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T015 [P] [US3] Criar/adicionar em services/company-enrichment-worker/tests/unit (pytest, stubs de scan sem rede) cobrindo: scan que excede o deadline conclui com sucesso `partial=True` e os eventos coletados até o corte (nenhum TIMEOUT); planner não agenda spiderfoot quando o bbot retornou ≥ `OSINT_SPIDERFOOT_MIN_EVENTS`; agenda spiderfoot quando o bbot volta vazio/insuficiente; métrica de scan (outcome full/partial/empty) incrementa

### Implementation for User Story 3

- [X] T016 [US3] Implementar deadline no runtime de capabilities do worker Python (services/company-enrichment-worker/src/company_enrichment/workers/capability.py e workers/ de bbot/spiderfoot): execução com `OSINT_BBOT_DEADLINE_S`/`OSINT_SPIDERFOOT_DEADLINE_S`; ao expirar, completar com sucesso `partial=True` + `events_collected` (FR-010) em vez de levantar TIMEOUT
- [X] T017 [US3] Alterar o planejador de capabilities (services/company-enrichment-worker/src/company_enrichment — graph planner/registry) para incluir spiderfoot apenas como fallback quando o bbot vier vazio/insuficiente (`OSINT_SPIDERFOOT_MIN_EVENTS`), preservando o resultado mesclado atual quando ele roda (FR-011)
- [X] T018 [US3] Expor métricas dos scans no módulo metrics do worker Python (services/company-enrichment-worker/src/company_enrichment/metrics/metrics.py): `enrichment_osint_scans_total{tool,outcome}`, `enrichment_osint_scan_duration_seconds{tool}`, `enrichment_osint_fallback_total{from,to}` (contracts/api.md §1) per FR-012

**Checkpoint**: US3 independente — nenhum TIMEOUT de OSINT vira falha; fallback reduz a latência típica

---

## Phase 6: User Story 4 — Dashboard Grafana (Priority: P2)

**Goal**: Visão consolidada por org/capability: sucesso, falhas reais, parked/travadas, circuitos, filas — provisionada como código

**Independent Test**: abrir o Grafana e ver os painéis com dados < 1 min, filtrando por organização e capability

### Implementation for User Story 4

*(repo k8s-infra — branch `master`; Fluxo GitOps de lá aplica no cluster)*

- [X] T019 [P] [US4] Adicionar anotações de scrape nos deployments do b2base em k8s-infra/apps/b2base/templates/deployment.yaml e worker-deployment.yaml (`prometheus.io/scrape: "true"`, `prometheus.io/port: "9090"`) e, para o worker Python, exposição do servidor Prometheus em `:9091` no boot (services/company-enrichment-worker — `start_http_server` em `app.py`/`__main__.py` usando prometheus_client já presente) + anotação equivalente no helm do serviço (services/company-enrichment-worker/helm) per FR-012/R7
- [X] T020 [US4] Criar k8s-infra/apps/b2base/templates/grafana-dashboard.yaml: ConfigMap com label `grafana_dashboard: "1"` e JSON do dashboard por specs/006-enrichment-resilience/contracts/api.md §1 — painéis: sucesso+taxa+duração p50/p95, falhas reais por capability/provedor/org, parked por idade/provedor, estado dos circuitos, jobs por estado (COMPLETED/DEGRADED/PARTIAL), filas NATS; variáveis `org` e `capability`; refresh 30s per FR-013

**Checkpoint**: US4 independente — operação vê o estado sem consultar o banco

---

## Phase 7: User Story 5 — Notificação de falhas reais (Priority: P2)

**Goal**: Falha real (não-transiente, park expirado) e circuito persistente notificam no Slack em tempo real (dedup) + digest diário por e-mail

**Independent Test**: falha não-transiente forçada gera 1 alerta Slack com org/lead/capability/erro (sem duplicar); digest diário chega com o consolidado

### Tests for User Story 5 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T021 [P] [US5] Criar test/enrichment-notifier.test.js (node --test, fetch stubado) cobrindo: task terminal não-transiente → 1 alerta Slack com payload de contracts/api.md §2 e dedupKey `task_failed:<taskId>` (repetição não reenvia); circuito aberto > 1h → alerta único por hora (dedupKey `circuit:<provider>:<yyyymmddhh>`); park expirado → alerta; digest agrega por org (concluídas, falhas por motivo, parked mais antigas, taxa) e envia e-mail 1× por dia (dedupKey `digest:<data>`); falha de entrega do Slack/e-mail é só log e não propaga (FR-017)

### Implementation for User Story 5

- [X] T022 [US5] Criar enrichment-notifier.js: `notifyTaskFailed`, `notifyCircuitOpen`, `notifyParkExpired`, `sendDailyDigest` — Slack via `POST SLACK_WEBHOOK_URL` (blocks do contrato), e-mail via transactional-email.js, dedup durable em `OpsNotification` (insert conflict → skip), entrega best-effort com log (R9/FR-017)
- [X] T023 [US5] Ligar os gatilhos: enrichment-manager (falha terminal não-transiente e park expirado) e enrichment-sweeper (detecção de circuito aberto > 1h via estado do registry/Redis) chamam o notifier; digest agendado no boot do server-prod.js (12:00 UTC) per FR-014/015/016

**Checkpoint**: US5 independente — operação é avisada das falhas reais, sem ruído

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Validação integrada e documentação

- [X] T024 [P] Revisar logs estruturados dos novos fluxos (sweeper: taskId/provider/próxima tentativa; notifier: dedupKey/canal/entrega; Python: outcome/duração) sem dados sensíveis além do necessário à operação (constituição VII)
- [X] T025 [P] Criar scripts/backfill-requeue-failed com modo `--org` para drenagem por organização e documentar no spec da feature o procedimento pós-deploy (rodar 1×; idempotente)
- [ ] T026 Executar a validação ponta a ponta de specs/006-enrichment-resilience/quickstart.md (C1–C8), incluindo a recuperação automática (C2) e as notificações reais (C7)
  - ⚠️ Pendente de ambiente: exige pod em produção com gateway LiteLLM, webhook Slack e ALERT_EMAIL_TO configurados. Executado: migração aplicada localmente, suíte 351 testes + 102 pytest verdes, gates de build OK.
- [X] T027 Rodar os quality gates completos: `pnpm test`, `pytest services/company-enrichment-worker/tests/unit -q` + lint/typecheck do serviço Python, e (se houver mudança de SPA) build do web
- [X] T028 [P] Atualizar k8s-infra/apps/b2base/values.yaml com as envs novas não-secretas do sweeper/park (constituição V: segredos no Infisical) e anotar em specs/006-enrichment-resilience/plan.md os desvios encontrados (insumo para `$speckit-converge`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: imediato (T002 é operacional — Infisical — pode paralelizar com tudo)
- **Foundational (Phase 2)**: schema migrado + métricas — **BLOQUEIA todas as stories**
- **US1 (Phase 3)**: Foundational → US1 — caminho crítico (premissa do produto)
- **US2 (Phase 4)**: depende de US1 (usa park + sweeper para drenar)
- **US3 (Phase 5)**: depende só da Foundational — **pode rodar em paralelo com US1/US2** (serviço Python, arquivos distintos)
- **US4 (Phase 6)**: depende de US1 (métricas de parked) + US3 (métricas de scans); mudanças em k8s-infra
- **US5 (Phase 7)**: depende de US1 (gatilhos parked/expiração); paralelizável com US3/US4
- **Polish (Phase 8)**: depende de todas as stories desejadas

### User Story Dependencies

- **US1**: Foundational → US1 (sem outras dependências) — **MVP estrutural**
- **US2**: US1 (drena pelo sweeper; sem US1 não há park)
- **US3**: Foundational → US3 (independente de US1/US2 — código Python)
- **US4**: US1 + US3 → US4 (métricas existirem; deploy GitOps)
- **US5**: US1 → US5 (notifica park expirado/circuito)

### Within Each User Story

- Testes ANTES da implementação (constituição III) — ver falhar primeiro
- Config antes de módulo (`enrichment-config` → `enrichment-manager` → sweeper → server-prod)
- Plataforma antes de infra (k8s-infra por último na US4)
- Story completa antes da próxima prioridade (ou paralela, se arquivos não conflitam)

### Parallel Opportunities

- T001–T002 (Setup) em paralelo
- T005 (Foundational) paralelo a nada crítico — mas rápido
- T006–T007 (testes US1) em paralelo entre si
- T013 (teste US2) paralelo a T006/T007? Não — fases distintas; dentro da fase sim
- **US3 (Python) em paralelo total com US1+US2** (após Foundational) — arquivos disjuntos
- **US4 e US5 em paralelo** após US1+US3
- T024, T025, T028 em paralelo na Polish

---

## Parallel Example: User Story 1

```bash
# Testes primeiro, em paralelo:
Task: "Criar test/enrichment-resilience.test.js (park/DEGRADED/janela)"
Task: "Criar test/enrichment-sweeper.test.js (seleção/token bucket/lock)"

# Implementação após vermelho:
Task: "enrichment-config (delays/envs)" → "enrichment-manager (PARKED/DEGRADED)"
→ "enrichment-sweeper.js" → "runtime retryAfterMs" → "server-prod (boot/SRE)"
```

## Implementation Strategy

### MVP First (US1 apenas)

1. Concluir Setup + Foundational (schema migrado)
2. Concluir US1 → **STOP and VALIDATE**: nenhum transiente novo vira FAILED;
   parked drena sozinha; job DEGRADED refinaliza
3. Deploy/demo se pronto — a premissa "nunca falha" está valendo

### Incremental Delivery

1. Setup + Foundational → fundação pronta
2. US1 → validar → **a criação de novos travados para**
3. US2 → validar → **backlog drenando** (756/1.869 em direção a concluído)
4. US3 (paralela a US2 se capacidade) → validar → timeouts de OSINT acabam
5. US4 + US5 (paralelas) → validar → observabilidade e notificação completas
6. Polish → quickstart C1–C8 → gates

### Parallel Team Strategy

1. Time conclui Setup + Foundational juntos
2. Dev A: US1 → US2 (plataforma, caminho crítico)
3. Dev B: US3 (Python) logo após Foundational
4. Dev C (após US1+US3): US4 (k8s-infra/Grafana) · Dev D: US5 (notifier)

---

## Notes

- [P] tasks = arquivos diferentes, sem dependências
- [Story] label mapeia a task para a user story (rastreabilidade com spec.md)
- Testes falham antes da implementação correspondente (constituição III)
- Commit após cada task ou grupo lógico — conventional commits em PT-BR (ex.: `feat(enrichment): ...`, `fix(enrichment-sweeper): ...`)
- Parar em qualquer checkpoint para validar a story independentemente
- T002 (Infisical) é ação operacional — pode ser feita a qualquer momento antes do deploy das US5
- Mudanças no k8s-infra seguem o fluxo GitOps de lá (branch `master`)
- Evitar: tasks vagas, conflito de mesmo arquivo entre tasks paralelas, dependência entre stories que quebre independência

---

## Phase 9: Convergence

**Purpose**: Lacunas encontradas pelo $speckit-converge (2026-09-20) após o primeiro implement

- [X] T029 Agendar o digest diário no server-prod.js (12:00 UTC, tick por minuto com dedup por dia) chamando `enrichmentNotifier.sendDailyDigest` com agregados do banco (concluídas 24h, falhas por motivo, parked mais antigas, taxa de sucesso) per FR-016 (partial)
- [X] T030 Adicionar label `orgId` às métricas de resiliência em metrics.js (`tasks_parked`, `tasks_parked_total`, `failures_real`) e agrupar por organização no resilienceTick/onFailureReal do server-prod.js, viabilizando o filtro por organização do dashboard per FR-012/FR-013 (partial)
- [ ] T031 Cadastrar `SLACK_WEBHOOK_URL` e `ALERT_EMAIL_TO` no Infisical `/b2base` com os valores reais da operação (sem isso, alertas Slack/digest não enviam) per FR-017 (missing) — [OPERACIONAL: requer valores que só a operação tem]
- [X] T032 Ajustar a redação de FR-018 em specs/006-enrichment-resilience/spec.md: usuários finais veem apenas agregados/detalhes da própria organização; o canal de operação (interno) recebe detalhes completos (org, lead, capability, erro) per FR-014 vs FR-018 (partial)
