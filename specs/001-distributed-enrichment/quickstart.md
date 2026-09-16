# Quickstart — Validação ponta a ponta

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Guia de validação do motor de enriquecimento distribuído. Comandos e comportamentos esperados; implementação pertence a `tasks.md`/implementação.

---

## Pré-requisitos

- Node 22 + pnpm 9; Docker (Postgres + **NATS JetStream** + **Redis** via `docker-compose.yml` atualizado nesta feature).
- `.env` com: `DATABASE_URL`, `NATS_URL=nats://localhost:4222`, `NATS_ENABLED=true`, `REDIS_URL=redis://localhost:6379`, `ENRICHMENT_ENGINE_V2=true`, `ENRICHMENT_ENGINE_V2_ORGS=<orgId de teste>`.
- Sem `NATS_URL`/`REDIS_URL` os testes de integração se auto-pulam (unidades rodam em qualquer lugar).

## Setup

```bash
pnpm install
docker compose up -d                      # postgres + nats + redis
pnpm run db:migrate                       # migration única dos models novos
pnpm test                                 # porta de entrada: TODOS os testes verdes antes de qualquer demo
```

## Processos (4 terminais)

```bash
pnpm run dev                    # 1. plataforma (API + manager + qualification consumer)
node workers/identity.js        # 2. worker identity (cnpj.resolve, cnpj.basic, domain.verify)
node workers/search.js          # 3. worker search (news, legal)
# 4. logs: os três processos emitem JSON estruturado com orgId/jobId/taskId
```

## Cenários de validação

### C1 — Fan-out com resultado parcial (US1, SC-001, SC-006)

1. `POST /api/prospects` com `companyName` de uma empresa real (ex.: "Nubank") com header de org na allowlist.
2. **Esperado em ≤ 60s**: `GET /api/enrichment/jobs/:enrichmentJobId` mostra `tasks` com ≥ 3 capabilities e estados mistos (`RUNNING`/`COMPLETED`); `GET /api/prospects/:id/enrichment` já exibe fatos das tasks concluídas **antes** do job terminar.
3. **Esperado no fim**: `status` do job = `COMPLETED` ou `PARTIAL`, `completionPct` coerente com `counts`.

### C2 — Gating por plano e multi-tenant (US3, SC-009, SC-010)

1. Repetir C1 com uma org **trial** (fora da allowlist premium).
2. **Esperado**: job contém apenas capabilities `tier=basic` (ex.: `identity.cnpj.basic` — BrasilAPI; sem PDL/deep). Nenhum campo premium mascarado aparece em `GET /prospects/:id/enrichment`.
3. Com dois tenants em paralelo: nenhuma resposta de um tenant contém `jobId`/`entityKey`/fatos do outro (`404` cross-tenant).

### C3 — Resiliência e idempotência (US2, SC-004)

1. **Timeout**: subir `workers/identity.js` com `IDENTITY_CAPABILITY_DELAYS_MS=60000` (delay artificial > `timeoutMs`).
   **Esperado**: task → `TIMEOUT` → `RETRY` com backoff visível nos logs (5s, 15s, 60s) → `FAILED` após `maxAttempts`; demais tasks do job concluem normalmente; job termina `PARTIAL`.
2. **Redelivery**: republicar a mesma task com `nats pub -W 5 enrichment.task.identity.cnpj.basic.v1 @task.json` (ou reentrega forçada elevando `max_deliver` em dev).
   **Esperado**: `EnrichmentResult` continua 1 linha por `taskId`; zero fatos duplicados em `GET /prospects/:id/enrichment`.
3. **Poison**: publicar task com `input` inválido.
   **Esperado**: `FAILED` permanente imediato (`INVALID_INPUT`) + mensagem em `enrichment.task.dlq.v1`; sem retry.

### C4 — Proteção de provider (US4, SC-003)

1. Simular provider ruim: `SEARXNG_FORCE_ERROR=true` no worker `search`.
   **Esperado**: `GET /api/admin/enrichment/providers` mostra `search` passando por `DEGRADED → OPEN` (circuito aberto); tasks `search.*` pausam com `PROVIDER_CIRCUIT_OPEN` (transiente); capabilities `identity.*` continuam concluídas; removida a variável, circuito passa por `HALF-OPEN` e reabre.

### C5 — Grafo: dependência e expansão dinâmica (US5)

1. Job de org premium com `identity.cnpj.resolve` configurado para descobrir domínio (fixture com SearXNG local ou stub).
2. **Esperado**: task `identity.domain.verify` só executa **após** `identity.cnpj.resolve` completar (log mostra `BLOCKED → QUEUED`); nova task aparece com `spawnedByTaskId` preenchido; `depth` respeita `MAX_DEPTH` (configurar `MAX_DEPTH=1` e confirmar que a expansão de 2º nível é recusada e registrada).

### C6 — Evidência e reprocessamento (US6, SC-005, SC-011)

1. `GET /api/prospects/:id/enrichment` → todo fato tem `evidence` com `sourceType`, `retrievedAt`, `provider` e `rawRecordId` não-nulo.
2. Reprocessar bruto sem chamada externa: script de dev `node scripts/reprocess-raw.js --rawRecordId <id>` (stub do provider em modo replay).
   **Esperado**: novo `EnrichmentResult` derivado do mesmo `RawRecord`; contador de chamadas externas do provider não se altera.

### C7 — Qualificação desacoplada (US7, SC-008)

1. Induzir falha permanente no consumer de qualificação (env `QUALIFICATION_FORCE_FAIL=true`).
   **Esperado**: enriquecimento conclui normalmente (workers/tasks ilesos); métrica `b2base_enrichment_qualification_failures_total` sobe.
2. Sem falha: após cada result aplicado, `opportunityScore` + `score_breakdown` atualizam no Prospect; com job parcial (80%/20%), score existe sobre os fatos disponíveis.

### C8 — Carga reduzida (SC-002 em escala de validação)

```bash
node scripts/load-enrichment.js --prospects 200 --capabilities 5   # ~1000 tasks
```

**Esperado**: fila em avanço contínuo (gauge `b2base_enrichment_tasks_pending` cai monotonicamente entre picos), nenhum task órfã após restart de um worker no meio da carga (matar processo e subir de volta: tasks em voo são reprocessadas sem duplicar fatos — SC-004 em carga).

## Métricas para observar durante tudo (porta 9090)

`b2base_enrichment_tasks{capability,state}` · `b2base_enrichment_task_duration_seconds{capability}` · `b2base_enrichment_provider_requests_total{provider, outcome}` · `b2base_enrichment_provider_state{provider}` · `b2base_enrichment_tasks_pending{capability}`.

## Critério de "done" desta feature

C1–C7 verdes num ambiente com NATS/Redis reais + `pnpm test` verde (unidades sempre; integração em ambiente completo) + rollout real em uma org allowlistada em staging antes de ampliar (R11).
