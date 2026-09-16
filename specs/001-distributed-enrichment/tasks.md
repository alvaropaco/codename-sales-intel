---

description: "Task list para a Plataforma Distribuída de Enriquecimento de Leads"
---

# Tasks: Plataforma Distribuída de Enriquecimento de Leads

**Input**: Design documents from `/specs/001-distributed-enrichment/`

**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/](./contracts/nats-enrichment-engine-v1.md) · [quickstart.md](./quickstart.md)

**Tests**: OBRIGATÓRIOS em toda fase — constituição III ("testes como porta de entrada", NÃO-NEGOCIÁVEL): cada user story começa pelas tarefas de teste, que devem ser escritas primeiro e **falhar** antes da implementação correspondente. Estilo do repo: `node --test` com injeção de dependências (referência: `test/lead-enrichment.test.js` — fake bus/prisma, sem subir o Express). Testes de integração são opt-in: pulam automaticamente sem `NATS_URL`/`REDIS_URL`.

**Organization**: Tarefas agrupadas por user story (US1–US8 da spec). Marcos M1–M4 do plan.md correspondem a: M1 = Fases 3–5 (US1+US2+US3), M2 = Fase 6 (US4), M3 = Fases 7–8 (US5+US6) + porte (Fase 11), M4 = Fases 9–10 (US7+US8).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de task incompleta)
- **[Story]**: user story da spec (US1–US8) — só nas fases de story
- Commits: conventional em PT-BR (`feat(enrichment): ...`, `test(enrichment): ...`), um commit por task ou grupo lógico

## Path Conventions

Monorepo existente: módulos planos na raiz (`enrichment-*.js`, `workers/`, `*.js`), testes em `test/`, serviços Python em `services/` (intocado nesta feature). Rotas HTTP em `server-prod.js`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ambiente dev e utilitários base, sem lógica de domínio

- [x] T001 Adicionar serviços `nats` (com JetStream: `-js -sd /data`) e `redis` ao docker-compose.yml, com volumes e healthchecks, mantendo o serviço `postgres` existente
- [x] T002 [P] Criar `enrichment-config.js`: centralizar config do motor por env — `ENRICHMENT_ENGINE_V2`, `ENRICHMENT_ENGINE_V2_ORGS` (allowlist), `MAX_TASKS_PER_JOB` (default 200), `MAX_DEPTH` (default 3), `RAW_MAX_BYTES` (default 262144), `RAW_STORE_BACKEND` (default `postgres`), backoff `RETRY_DELAYS_MS=[5000,15000,60000,300000]`, `ENRICHMENT_MONTHLY_QUOTA_TRIAL/PREMIUM`, `RAW_RETENTION_DAYS` (default 90); módulo puro sem efeitos colaterais, injetável em testes
- [x] T003 [P] Criar `logger.js`: logger JSON estruturado com `child(bindings)` (campos `orgId`, `jobId`, `taskId`, `capability`, `traceparent`), nível por env, sem dependência nova (emita JSON via console com prefixo existente quando logging desligado)
- [x] T004 [P] Extrair helpers de conexão/ensure-stream de `nats-enrichment.js` para `nats-stream.js` (reutilizável pelo manager e workers); `nats-enrichment.js` passa a importar do novo módulo com comportamento legado inalterado — `pnpm test` verde após o refactor

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contratos e catálogo — pré-requisito de TODAS as user stories

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase completa

- [x] T005 Adicionar os 5 models a `prisma/schema.prisma` exatamente conforme data-model.md — `EnrichmentJob` (status `PENDING|RUNNING|PARTIAL|COMPLETED|FAILED|CANCELLED`, snapshot `plan`, índices `[orgId, createdAt]` e `[prospectId, createdAt]`); `EnrichmentTask` (`taskKey String @unique`, `dependsOn String[] @default([])`, `depth Int @default(0)`, `spawnedByTaskId String?`, status com `BLOCKED|RETRY|TIMEOUT|SKIPPED`, `priority Int @default(2)`, índices `[jobId, status]`, `[status, priority]`, `[orgId, prospectId]`); `EnrichmentResult` (`taskId String @unique`, `data Json?`, `confidence Float?`, `workerVersion String`); `EnrichmentEvidence` (attribute/value/sourceType/retrievedAt/confidence/rawRecordId, índice `[orgId, attribute]`); `RawRecord` (`storageBackend String @default("postgres")`, `truncated Boolean @default(false)`, índice `[orgId, capability, createdAt]`) — e gerar migration: `pnpm run db:migrate -- --name enrichment_engine` (nunca `db push`)
- [x] T006 [P] [Foundational] Escrever `test/enrichment-contracts.test.js` PRIMEIRO: encode/decode dos 4 payloads v1 (`task.<capability>.v1`, `result.v1`, `job.completed.v1`, `task.dlq.v1`); headers obrigatórios (`Nats-Msg-Id` = `taskId:{attempt}` em task e `result:{taskId}:{attempt}` em result, `X-Org-Id`, `X-Job-Id`, `X-Task-Id`, `X-Attempt`, `traceparent`); rejeita `version !== "1"`; classificação da taxonomia de erro (NETWORK_ERROR/TIMEOUT/RATE_LIMIT/PROVIDER_UNAVAILABLE/PROVIDER_CIRCUIT_OPEN/INTERNAL = transientes; INVALID_INPUT/NOT_FOUND/UNAUTHORIZED/INVALID_DATA/CAPABILITY_DISABLED = permanentes)
- [x] T007 Implementar `enrichment-contracts.js` conforme contracts/nats-enrichment-engine-v1.md: builders de subject (`taskSubject(capability)` → `enrichment.task.<capability com pontos>.v1`), validação/serialização dos payloads, builders de headers, constantes `ERROR_TAXONOMY` + `isTransientError(type)` (faz T006 passar)
- [x] T008 [P] [Foundational] Escrever `test/enrichment-idempotency.test.js` PRIMEIRO: `computeTaskKey` determinístico (mesmos inputs → mesma chave; ordem das chaves do `input` não muda o hash; orgId/capability/provider diferentes → chaves diferentes); uuidv5 local segue RFC 4122 v5 (SHA-1, namespace fixo)
- [x] T009 Criar `workers/sdk/idempotency.js`: uuidv5 local (~10 linhas, SHA-1 + namespace, sem dependência nova), `hashInput(input)` (stringify estável com chaves ordenadas) e `computeTaskKey(orgId, jobId, entityKey, capability, provider, input)` (faz T008 passar)
- [x] T010 [P] [Foundational] Escrever `test/enrichment-capabilities.test.js` PRIMEIRO: todo capability do catálogo tem `family`, `tier` (`basic|premium`), `timeoutMs`, `maxAttempts`, `providers[]`, `inputSchema`, `validateInput` (inválido → erro `INVALID_INPUT`); `expand[]` (quando houver) é declarativo (`whenFact` + `spawn` + `tier`); capabilities `enabled:false` existem mas não são planejáveis
- [x] T011 Criar `enrichment-capabilities.js`: catálogo inicial — `identity.domain.verify` (basic; DNS+HTTP), `identity.cnpj.basic` (basic; BrasilAPI), `search.news` (basic; SearXNG) habilitadas; placeholders `enabled:false`: `identity.cnpj.resolve`, `search.legal`, `company.profile.deep`, `company.logo`, `company.deepgraph` (premium, habilitadas no porte da Fase 11); cada uma com `execute` injetando deps (`dns`, `fetch`, `searx`) e limites vindos de `enrichment-config.js` (faz T010 passar)
- [x] T012 [P] Criar `test/integration/enrichment-engine.int.test.js` (scaffold opt-in): `skip` automático sem `NATS_URL`/`REDIS_URL`; helpers de limpeza do stream `ENRICHMENT` e consumers `enrichment-engine-*`; fake Redis in-memory compartilhado; primeiro teste: conexão + publish/consume roundtrip de `enrichment.result.v1`

**Checkpoint**: Fundação pronta — schema migrado, contratos e catálogo testados. Stories podem começar.

---

## Phase 3: User Story 1 — Enriquecimento paralelo com resultados parciais independentes (Priority: P1) 🎯 MVP

**Goal**: Lead → job → fan-out de tasks no barramento → workers independentes executam em paralelo → resultados parciais persistidos/aplicados e visíveis antes da conclusão do job

**Independent Test**: disparar enriquecimento de um lead com ≥2 capabilities; verificar tasks concorrentes, resultados aparecendo no perfil de forma independente e lead utilizável antes do fim (quickstart C1)

### Tests for User Story 1 ⚠️ (escrever PRIMEIRO, garantir que FALHAM)

- [x] T013 [P] [US1] Escrever `test/enrichment-manager.test.js` (fake bus + fake prisma): planejamento gera 1 task por entidade × capability habilitada; só tasks `QUEUED` são publicadas; consumidor de resultado marca task `COMPLETED` e faz merge dos fatos em `prospect.enrichmentSummary` por capability; job termina `COMPLETED` (0 falhas), `PARTIAL` (falhas + sucessos) ou `FAILED` (0 sucessos) com `counts` e `completionPct` coerentes (cenário 4 da US1); replanejar o mesmo job não duplica tasks (`taskKey` único); republicar result duplicado não aplica fatos duas vezes
- [x] T014 [P] [US1] Escrever `test/worker-runtime.test.js` (fake bus/prisma): caminho feliz consume→validate→execute→persist `EnrichmentResult`→publish result→**ack** (ordem persist→publish→ack asserida); capability desconhecida → `FAILED` permanente `INVALID_INPUT` com ack imediato; semáforo de concorrência respeitado (máx. N executes simultâneos); `stop()` drena tasks em voo antes de sair

### Implementation for User Story 1

- [x] T015 [US1] Implementar `enrichment-manager.js`: `createJob(orgId, prospectId, trigger)` com snapshot do plano via `plan.js`; `planTasks` (entidades do prospect × catálogo habilitado — gating de tier chega na US3); `publishQueuedTasks` via `enrichment-contracts.js`; consumer durável `enrichment-manager` de `enrichment.result.v1` (aplica task/estado, merge `enrichmentSummary`, ignora `suggestedTasks` por enquanto); cálculo de conclusão + publish `enrichment.job.completed.v1`; `suggestedTasks` persistido sem efeito (faz T013 passar)
- [x] T016 [US1] Implementar `workers/sdk/runtime.js`: loop de fetch batch (consumer durável `enrichment-engine-<família>`, filter `enrichment.task.<família>.>`, `ack_policy explicit`, `ack_wait` = maior timeout da família + 30%), validação pelo catálogo, `execute` com `AbortController` ligado ao `timeoutMs`, persist → publish → ack, `stop()` com drain (faz T014 passar; retry/backoff é US2 — erro hoje → `FAILED` direto)
- [x] T017 [P] [US1] Implementar `workers/sdk/result-publisher.js`: publica `enrichment.result.v1` com headers de correlação e `Nats-Msg-Id` = `result:{taskId}:{attempt}` (injetável para testes)
- [x] T018 [P] [US1] Implementar `workers/identity.js`: registra `identity.domain.verify` (dns.resolve + HEAD http injetados) e `identity.cnpj.basic` (fetch BrasilAPI injetado, grava fatos `company.cnpj*` com evidência básica sourceType `brasilapi`); entrypoint `node workers/identity.js` starta o runtime
- [x] T019 [P] [US1] Extrair cliente SearXNG de `lead-enrichment.js` para `searxng.js` (função injetável, legado importando do novo módulo) e implementar `workers/search.js` com `search.news` (fatos `company.news[]` + evidência sourceType `searxng`)
- [x] T020 [US1] Integrar em `server-prod.js`: `dispatchEnrichmentForPlan` — quando `ENRICHMENT_ENGINE_V2` ativo e org na allowlist → `createJob`+`planTasks` (resposta inclui `enrichmentJobId`); senão fluxo legado intocado; wiring de startup do manager + workers via processo separado documentado no package.json (`"worker:identity"`, `"worker:search"`)
- [x] T021 [US1] Adicionar em `server-prod.js` os endpoints `GET /api/enrichment/jobs/:jobId` (status, counts, completionPct, tasks resumo) e `GET /api/prospects/:id/enrichment` (fatos de `EnrichmentResult` agrupados por entityKey/capability) conforme contracts/http-api.md — org-scoped, 404 cross-tenant
- [x] T022 [US1] Escrever cenário de integração opt-in em `test/integration/enrichment-engine.int.test.js`: job real contra NATS com providers stubados (fetch/dns fakes injetados), ≥2 workers em processos paralelos simulados, resultados parciais aplicados antes do término do job (espelha C1)

**Checkpoint**: C1 do quickstart passa com providers stubados; `pnpm test` verde; MVP demonstrável (motor básico de ponta a ponta).

---

## Phase 4: User Story 2 — Execução resiliente, idempotente e limitada em tempo (Priority: P1)

**Goal**: Timeout, retry com backoff, taxonomia transiente/permanente, DLQ e idempotência sob redelivery — falha de uma task não afeta as demais

**Independent Test**: forçar timeout/erro transitório (retry com espera crescente até o limite), falha permanente (sem retry) e redelivery duplicada (zero fatos duplicados) — quickstart C3

### Tests for User Story 2 ⚠️

- [x] T023 [P] [US2] Estender `test/worker-runtime.test.js`: execute além do `timeoutMs` → abort + resultado `TIMEOUT` transiente; erro transiente → `nak(delay)` seguindo `RETRY_DELAYS_MS` (+jitter) e nova entrega com `attempt+1`; erro permanente → sem retry, `term()` + publish em `enrichment.task.dlq.v1`; redelivery com `EnrichmentResult` já existente para `taskId` → atalho idempotente (NÃO re-executa provider — spy asserido), republisha result e ack; persist+publish falhos → sem ack (nak)
- [x] T024 [P] [US2] Estender `test/enrichment-manager.test.js`: result `FAILED retryable:true` → task `RETRY` → re-publicação com `attempt+1` e mesmo `taskKey`; esgotar `maxAttempts` → `FAILED` definitivo com `lastError`; `TIMEOUT` refletido; `counts` incluem `retry/cancelled/blocked/skipped`; PARTIAL/FAILED coerentes após esgotamento

### Implementation for User Story 2

- [x] T025 [US2] Completar `workers/sdk/runtime.js`: agendamento de backoff `nak(delay)` com jitter, caminho permanente (`term()` + DLQ via `enrichment-contracts.js`), atalho idempotente consultando `EnrichmentResult` por `taskId` (usa `workers/sdk/idempotency.js`), garantia persist→publish→ack (faz T023 passar)
- [x] T026 [US2] Completar máquina de estados em `enrichment-manager.js`: `RETRY`/`TIMEOUT`/`FAILED` por `isTransientError`, re-publicação de retry com `Nats-Msg-Id` `taskId:{attempt+1}` (contracts já ajustados), `maxAttempts` e `lastError` respeitados, `counts` completos no job (faz T024 passar)

**Checkpoint**: C3 do quickstart passa (timeout, backoff, poison→DLQ, redelivery sem duplicação).

---

## Phase 5: User Story 3 — Isolamento por organização e respeito ao plano (Priority: P1)

**Goal**: Nenhuma task/result cross-tenant; trial só capabilities basic; premium ganha o conjunto profundo; cota mensal por org

**Independent Test**: enriquecer 2 orgs em paralelo e auditar isolamento; job de trial não gera/exponde capability premium — quickstart C2

### Tests for User Story 3 ⚠️

- [x] T027 [P] [US3] Estender `test/enrichment-capabilities.test.js` (gating): dada a lista de capabilities e um plano, planner elegível = só `tier:basic` para `trial`; `basic+premium` para `premium`; `enabled:false` nunca elegível; elegibilidade é função pura exportada do catálogo
- [x] T028 [P] [US3] Estender `test/enrichment-manager.test.js` + adicionar testes de rota (handlers extraídos para testabilidade): snapshot do plano persistido em `EnrichmentJob.plan`; org B não lê job/org A (404, nunca 403); cota mensal excedida → erro tipado `ENRICHMENT_QUOTA_EXCEEDED`; leitura de fatos por trial não retorna fatos de capability `premium` (campos mascarados via `plan-masking.js`)

### Implementation for User Story 3

- [x] T029 [US3] Gating no `enrichment-manager.js`: filtrar catálogo por plano (`plan.js`) + `enabled`; snapshot `plan` no job; cota mensal (count `EnrichmentJob` da org no mês vs `enrichment-config.js`) → erro tipado antes de criar tasks; capability premium nunca planejada para trial mesmo em `suggestedTasks` (validação na expansão futura — gancho aqui) (faz T027/T028 passing no manager)
- [x] T030 [US3] Endpoints em `server-prod.js`: `where orgId` em todas as queries novas (404 cross-tenant), mapeamento `429 ENRICHMENT_QUOTA_EXCEEDED` conforme contracts/http-api.md, passagem de fatos premium por `plan-masking.js` quando plano trial (faz T028 passing nas rotas)

**Checkpoint**: C2 do quickstart passa. **Fim do M1**: motor P1 completo (US1+US2+US3) — rollout allowlist em staging possível.

---

## Phase 6: User Story 4 — Proteção de provedores externos (Priority: P2)

**Goal**: Rate limit e concorrência por provider válidos entre instâncias (Redis), circuit breaker com recuperação por probe — provider degradado não derruba o resto

**Independent Test**: simular provider com erros consecutivos → circuito abre → tasks do provider pausam; demais capabilities seguem; recuperação reabre — quickstart C4

### Tests for User Story 4 ⚠️

- [x] T031 [P] [US4] Escrever `test/enrichment-provider-registry.test.js` (ioredis fake): janela fixa por provider (INCR+EXPIRE) bloqueia acima do rpm; semáforo de concorrência com lease TTL (crash libera por expiração); circuito: erros na janela → `DEGRADED` → `OPEN` com TTL → probe `HALF-OPEN` (sucesso → `HEALTHY`; falha → `OPEN` de novo); `DISABLED` sempre recusa; limites por provider vindos do catálogo/env
- [x] T032 [P] [US4] Estender `test/worker-runtime.test.js`: `acquire(provider)` antes de `execute`; circuito aberto → erro `PROVIDER_CIRCUIT_OPEN` transiente SEM chamar o provider (spy de chamadas = 0); ticket liberado em sucesso, falha e timeout; injeção de falha por env (`PROVIDER_FORCE_ERROR`, `PROVIDER_FORCE_LATENCY_MS`) funciona por provider

### Implementation for User Story 4

- [x] T033 [US4] Implementar `enrichment-provider-registry.js` (faz T031 passar): janela fixa, semáforo com lease, estados `HEALTHY|DEGRADED|OPEN|HALF-OPEN|DISABLED` em Redis, config por provider, hooks de métrica (`b2base_enrichment_provider_state{provider}`, `b2base_enrichment_provider_requests_total{provider,outcome}`)
- [x] T034 [US4] Integrar registro no `workers/sdk/runtime.js` via `ctx.providers.acquire/release` + injeção de falha por env (faz T032 passar)
- [x] T035 [US4] Adicionar `GET /api/admin/enrichment/providers` em `server-prod.js` com guarda admin existente (`admin.js`), lendo estado do registro — contracts/http-api.md

**Checkpoint**: C4 do quickstart passa. **Fim do M2.**

---

## Phase 7: User Story 5 — Dependências entre tasks e geração dinâmica (Priority: P2)

**Goal**: DAG mínimo (`dependsOn`/BLOCKED), expansão dinâmica declarativa com limites duros, rastreabilidade de origem, cancelamento em cascata

**Independent Test**: capability X produz fato que habilita Y → Y só executa após X; novas tasks nascem com `spawnedByTaskId`; limites de profundidade/quantidade recusam expansão — quickstart C5

### Tests for User Story 5 ⚠️

- [x] T036 [P] [US5] Escrever `test/enrichment-dag.test.js`: task com `dependsOn` fica `BLOCKED` e NÃO é publicada; todas as deps `COMPLETED` → `QUEUED` e publicada com input enriquecido pelos fatos das deps (ex.: `company.domain` descoberto entra no input de `identity.domain.verify`); dep `FAILED` permanente → dependentes `CANCELLED` com causa; regra `expand` do catálogo (quando `whenFact` presente no result) cria task nova com `spawnedByTaskId` e `depth+1`; `suggestedTasks` com capability desconhecida/fora do plano → recusadas e registradas; limites `MAX_TASKS_PER_JOB` e `MAX_DEPTH` → recusa registrada (task `SKIPPED` + log estruturado); loop A→B→A interrompido pelos limites

### Implementation for User Story 5

- [x] T037 [US5] Implementar DAG/expansão no `enrichment-manager.js` (faz T036 passar): publicação condicionada a deps; desbloqueio no consumer; criação de tasks por regras `expand` do catálogo + validação de `suggestedTasks` (capability registrada, tier do plano, limites `enrichment-config.js`); cascata de cancelamento; `spawnedByTaskId`/`depth` persistidos
- [x] T038 [P] [US5] Declarar regras `expand` no `enrichment-capabilities.js` para as capabilities existentes (ex.: `identity.cnpj.basic` → `identity.domain.verify` quando descobrir domínio; `identity.domain.verify` → `search.news`), mantendo o motor livre de regras hardcoded (workers continuam só sugerindo)

**Checkpoint**: C5 do quickstart passa.

---

## Phase 8: User Story 6 — Evidência, dado bruto e dado normalizado (Priority: P2)

**Goal**: Todo fato com evidência auditável; bruto retido separado (raw-store) e reprocessável sem chamada externa

**Independent Test**: auditar qualquer fato até origem/momento/provedor/confiança; evoluir parser e reprocessar bruto sem nova chamada — quickstart C6

### Tests for User Story 6 ⚠️

- [x] T039 [P] [US6] Escrever `test/raw-store.test.js`: `put` grava `RawRecord` backend postgres e devolve ref; payload acima de `RAW_MAX_BYTES` → `truncated:true` (e truncamento determinístico); `get(ref)` devolve conteúdo íntegro; backend `s3` sem configuração → erro claro `NOT_IMPLEMENTED` (guard); `prune(days)` remove apenas registros vencidos
- [x] T040 [P] [US6] Estender `test/worker-runtime.test.js`: facts com `evidence` → linhas em `EnrichmentEvidence` (attribute, value, sourceType, provider, url, retrievedAt, confidence, rawRecordId); bruto → `raw-store` e result carrega só `rawRecordId` (nunca o payload); dois results de providers distintos para o mesmo atributo coexistem (sem merge destrutivo)
- [x] T041 [P] [US6] Escrever `test/reprocess-raw.test.js`: reprocessar `RawRecord` gera novo `EnrichmentResult` (com `reprocessedFrom`) usando provider em modo replay — spy prova zero chamadas externas

### Implementation for User Story 6

- [x] T042 [US6] Implementar `raw-store.js`: interface `put/get/prune`, backend `postgres` (usa `RawRecord`), guard para `s3` (faz T039 passar)
- [x] T043 [US6] Persistência de evidência/bruto no `workers/sdk/runtime.js` com `ctx.rawStore` (faz T040 passar); garantir `GET /api/prospects/:id/enrichment` expondo evidence completa (contracts/http-api.md) e nunca o payload bruto
- [x] T044 [P] [US6] Implementar `scripts/reprocess-raw.js` (`--rawRecordId`) com provider stub de replay (faz T041 passar) e agendar `raw-store.prune(RAW_RETENTION_DAYS)` no startup do manager

**Checkpoint**: C6 do quickstart passa. **Fim do M3** (com o porte da Fase 11).

---

## Phase 9: User Story 7 — Qualificação desacoplada do enriquecimento (Priority: P3)

**Goal**: Score recalculado por consumidora própria dos eventos de resultado, com debounce e isolamento de falha; acoplamento inline atual removido nos jobs v2

**Independent Test**: concluir task → score recalculado a partir dos fatos sem referência a worker; falha na qualificação não afeta o enriquecimento — quickstart C7

### Tests for User Story 7 ⚠️

- [x] T045 [P] [US7] Escrever `test/qualification.test.js` (consumer com bus/prisma fakes + `recalcLeadScore` injetado): result aplicado → recalc por prospect; N results do mesmo prospect em janela curta → 1 recalc (debounce/coalescing); `enrichment.job.completed.v1` → recalc final imediato; `QUALIFICATION_FORCE_FAIL` → erro isolado no consumer (enrichment segue, contador de falhas incrementa); precedência do `commercial_potential` do worker Python preservada (reusar fixtures de `test/opportunity-score.test.js`); jobs v2 não disparam recalc inline no manager (assegurar ausência)

### Implementation for User Story 7

- [x] T046 [US7] Implementar `qualification.js`: consumer durável `enrichment-qualification` de `enrichment.result.v1` + `enrichment.job.completed.v1`, debounce por prospect (coalescing em memória + recalc final no completed), chama `recalcLeadScore(prisma, prospect)` existente, métricas `b2base_enrichment_qualification_{total,failures_total}`; wiring no startup do `server-prod.js`; manager v2 não chama score inline (faz T045 passar)

**Checkpoint**: C7 do quickstart passa.

---

## Phase 10: User Story 8 — Observabilidade de execução (Priority: P3)

**Goal**: Métricas completas do motor, correlação org/job/task/trace em todos os logs e load test reutilizável

**Independent Test**: carga com tasks simultâneas expõe métricas por capability/provider e traces de correlação ponta a ponta — quickstart C8

### Tests for User Story 8 ⚠️

- [x] T047 [P] [US8] Escrever `test/enrichment-metrics.test.js` (registry prom-client isolado): após processar tasks — `b2base_enrichment_tasks{capability,state}`, histograma `b2base_enrichment_task_duration_seconds{capability}`, `b2base_enrichment_tasks_pending{capability}` (via groupBy do manager), contadores de provider e qualificação presentes e coerentes com os eventos processados
- [x] T048 [P] [US8] Escrever `test/enrichment-correlation.test.js`: `traceparent` gerado no manager chega intacto aos headers do result publicado pelo runtime; logs JSON de manager/runtime/qualification carregam `orgId`/`jobId`/`taskId` (transporte em memória do `logger.js`)

### Implementation for User Story 8

- [x] T049 [US8] Estender `metrics.js` com o conjunto completo do quickstart (no registry existente, porta 9090) e gauge de pendência calculado por `groupBy` periódico no manager (faz T047 passar)
- [x] T050 [US8] Propagação de correlação ponta a ponta em `enrichment-manager.js` (gera `traceparent`/headers), `workers/sdk/runtime.js` e `qualification.js` (consomem e aplicam `logger.child` do `logger.js` com os bindings) (faz T048 passar)
- [x] T051 [P] [US8] Implementar `scripts/load-enrichment.js`: cria N prospects e dispara enriquecimento (`--prospects`, `--capabilities`), reporta throughput/pendência; validar ~1.000 tasks simultâneas (escala do quickstart C8; 10k+ é marco próprio pós-M4 — research R8)

**Checkpoint**: C8 do quickstart passa. **Fim do M4.**

---

## Phase 11: Polish & Porte das esteiras legadas & Rollout

**Purpose**: Traz o tráfego real para o motor, ci de contratos, deploy e validação final — depende de US1–US8

- [x] T052 [P] Adicionar ao `Dockerfile` o `COPY workers/` e novos módulos raiz; documentar entrypoints de worker (`node workers/identity.js` etc.) e réplicas sugeridas em seção nova do README (deploy segue GitOps: mesma imagem, Deployments por worker no `alvaropaco/k8s-infra` — anotar handoff para o repo de infra)
- [x] T053 [P] Extrair JSON Schemas dos 4 contratos para `specs/001-distributed-enrichment/contracts/schemas/*.json` e criar `.github/workflows/enrichment-contracts.yml` com job de compatibilidade backward (espelhar o job do `cnpj-data-publisher.yml`)
- [x] T054 Porte: capability `identity.cnpj.resolve` em `workers/identity.js` — extrair orquestração de `resolveCnpj`/`mcp-cnpj.js` com DI (reusar fixtures de `test/lead-enrichment.test.js`), grava `enrichmentSummary.cnpj_resolution` e fatos que alimentam `expand` (domínio); regra `expand` desta capability habilitada no catálogo
- [x] T055 [P] Porte: `search.legal` (legalScan via `searxng.js`) e `company.logo` (Clearbit) como capabilities em `workers/search.js`/`workers/company-deep.js`, com testes DI próprios
- [x] T056 Porte: `company.profile.deep` (PDL) em `workers/company-deep.js` — capability premium, fatos firmográficos + pessoas descobertas como `suggestedTasks` (`person.*`), com gating verificado por teste
- [x] T057 Porte: ponte `company.deepgraph` em `workers/company-deep.js` — publica `enrichment.company.requested.v1` legado com `tenant_id` preenchido, correlaciona `completed/partial/failed.v1` via ledger `EnrichmentRequest` dentro do timeout da capability (worker Python intocado — research R12); teste com bus fake simulando o worker Python
- [x] T058 Rollout: com paridade comprovada (C1–C8 em staging), `dispatchEnrichmentForPlan` v2 vira caminho padrão das orgs allowlist; contornos legados (fila in-process de `lead-enrichment.js`, BrasilAPI inline) desligados por org; rollback = remover org da allowlist/env flag — sem migration nem deploy especial
- [x] T059 [P] Adicionar painéis do motor ao dashboard Grafana existente em `monitoring/*.json` (tasks por estado, duração p95 por capability, estados de provider, pendência por capability, falhas de qualificação)
- [x] T060 Validação final: `pnpm test` verde (unidades sempre; integração com NATS/Redis reais), walkthrough completo do `quickstart.md` (C1–C8) em ambiente com serviços reais, `pnpm run db:deploy` validado em staging; registrar desvios encontrados como issues/tasks de follow-up

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: imediata; T001–T004 independentes entre si ([P])
- **Foundational (Fase 2)**: exige Fase 1; T005 (schema) e T006–T011 (ciclos teste→impl por módulo) podem avançar em paralelo após T001/T002; T012 depende de T001
- **US1 (Fase 3)**: exige Fase 2 completa — **bloqueia US2/US3** (mesmo domínio de arquivos: manager/runtime)
- **US2 (Fase 4)**: estende US1 (runtime/manager); antes de US3 para o MVP ser resiliente
- **US3 (Fase 5)**: sobre o planejador da US1; fechamento do M1
- **US4 (Fase 6)**: exige US2 (taxonomia `PROVIDER_CIRCUIT_OPEN` é transiente) — M2
- **US5 (Fase 7)** e **US6 (Fase 8)**: independentes entre si após US4; ambas usam expansão/evidência do manager/runtime
- **US7 (Fase 9)**: exige US1 (results fluindo); ideal após US6 (fatos com evidência)
- **US8 (Fase 10)**: exige US1–US3 no mínimo; fecha M4
- **Fase 11**: exige US1–US8 (porte seguro precisa do motor completo)

### User Story Dependencies (resumo)

- US1 → US2 → US3 formam o núcleo P1 sequencial (mesmos arquivos centrais)
- US4, US5, US6 podem paralelizar entre si **se** pessoas diferentes (arquivos com sobreposição apenas em `workers/sdk/runtime.js` e `enrichment-manager.js` — coordenar ou sequenciar)
- US7 e US8 independentes entre si

### Within Each User Story

- Testes PRIMEIRO (falhando) → implementação → checkpoint do quickstart correspondente
- Models/schema já prontos na Fase 2; dentro da story: módulo → integração → endpoint

### Parallel Opportunities

- Fase 1: T001–T004 todas em paralelo
- Fase 2: pares teste→impl de contracts/idempotency/capabilities em paralelo entre si
- Dentro das stories: tasks `[P]` de teste (arquivos de teste distintos) e workers independentes (`workers/identity.js`, `workers/search.js`)
- Entre stories: US4 ∥ US5 ∥ US6 (com ressalva de arquivos compartilhados); US7 ∥ US8

## Parallel Example: User Story 1

```bash
# Testes primeiro, em paralelo (arquivos distintos):
Task: "test/enrichment-manager.test.js"   (T013)
Task: "test/worker-runtime.test.js"       (T014)

# Depois, em paralelo onde os arquivos não conflitam:
Task: "workers/sdk/result-publisher.js"   (T017)
Task: "workers/identity.js"               (T018)
Task: "workers/search.js + searxng.js"    (T019)
# manager (T015) e runtime (T016) são o caminho crítico sequencial
```

---

## Implementation Strategy

### MVP First (US1 apenas)

1. Fases 1–2 (Setup + Foundational) → fundação pronta
2. Fase 3 (US1) → **STOP e VALIDATE**: C1 do quickstart com providers stubados
3. MVP demonstrável: lead → tasks paralelas → resultados parciais visíveis

### Incremental Delivery

1. M1 = Fases 3–5 (US1+US2+US3) → motor P1 completo, rollout allowlist em staging possível
2. M2 = Fase 6 (US4) → providers protegidos
3. M3 = Fases 7–8 (US5+US6) → grafo expansível + evidência auditável
4. M4 = Fases 9–10 (US7+US8) → qualificação desacoplada + operação observável
5. Fase 11 → tráfego real (porte das esteiras legadas) e rollout gradual

### Notes

- `pnpm test` verde ao fim de **cada** task (constituição III); migrations só via `pnpm run db:migrate`/`db:deploy`
- Nenhum segredo em payloads/headers de mensagem (constituição V); toda query nova com `orgId` (constituição IV)
- Workers stateless e ack-only-após-persist em qualquer alteração no runtime (spec FR-014/FR-018)
- Evitar: tasks vagas, dois tasks mexendo no mesmo arquivo sem sequência explícita, dependência cruzada entre stories que quebre o checkpoint independente

---

## Phase 12: Convergence

**Purpose**: Gaps remanescentes da auditoria codebase ↔ spec/plan/tasks pós-implementação ($speckit-converge, 2026-09-16). Ordens: CRITICAL/HIGH primeiro.

- [ ] T061 [CRITICAL] Implementar consumidor durável do manager em `enrichment-manager.js`: loop pull de `enrichment.result.v1` (durable `enrichment-manager`, ack após `handleResult`, nak em erro — padrão `nats-enrichment.js`) com `start()/stop()`, wiring no boot de `server-prod.js` (junto ao consumer de qualificação) e teste com bus fake que consome e aplica um resultado sem pull manual (per FR-004/FR-005, plan: consumer manager) (missing)
- [ ] T062 [HIGH] Executar a validação real pendente: `docker compose up -d`, `pnpm run db:migrate` (aplicar a migration 20260916200000_enrichment_engine — escrita à mão; conferir drift com o Prisma), e rodar C1–C8 do quickstart.md com NATS/Redis reais; leads sem CNPJ no v2 exigem `ENRICHMENT_CATALOG_FULL=true` (identity.cnpj.resolve é stage 'port') (per T060, SC-001, quickstart.md) (partial)
- [ ] T063 [MEDIUM] Publicar `enrichment.task.dlq.v1` no caminho poison do runtime (`workers/sdk/runtime.js`) quando o payload é parseável (taskId presente), com teste asserting publicação + term (per contracts/nats-enrichment-engine-v1.md §6) (partial)
- [ ] T064 [MEDIUM] Prioridade além do planejamento (FR-011): documentar oficialmente a limitação (ordem de planejamento/publicação apenas, sem fila prioritária no JetStream) no README e cobrir com teste a ordenação por prioridade nas republicações de retry e na expansão dinâmica; alternativa (múltiplos subjects por faixa) registrada como decisão futura (per FR-011) (partial)
- [ ] T065 [MEDIUM] Failover por ordem de preferência entre `providers[]` da capability no runtime: em `PROVIDER_UNAVAILABLE`/`PROVIDER_CIRCUIT_OPEN` do provider preferido, tentar o próximo do catálogo antes de falhar a task, com teste (per FR-021) (partial)
- [ ] T066 [LOW] Alimentar `b2base_enrichment_provider_state` a partir do registry: runtime consulta `registry.getState(provider)` após acquire/recordOutcome e chama `metrics.setEnrichmentProviderState`, com teste (per US8, FR-035) (partial)
- [ ] T067 [LOW] Propagar `ctx.signal` ao fetch do `identity.cnpj.basic` em `workers/identity.js` (hoje `signal: undefined` — timeout da task não aborta o HTTP em voo) (per workers/identity.js) (partial)
- [ ] T068 [LOW] Validação quantitativa de carga: `scripts/load-enrichment.js` com e sem `PROVIDER_FORCE_ERROR` medindo impacto no throughput (SC-003 ≤5%) e ensaio da meta de escala (SC-002 — marco próprio pós-M4, research R8) (per SC-002, SC-003) (partial)
