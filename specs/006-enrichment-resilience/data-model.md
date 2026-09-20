# Data Model: Resiliência e Observabilidade do Enriquecimento

**Feature**: 006-enrichment-resilience | **Date**: 2026-09-20

Migração exclusivamente via Prisma (`pnpm run db:migrate`), constituição I.

## Entidades

### EnrichmentTask (ALTERADA)

| Mudança | Detalhe |
|---|---|
| `status` | novo valor **`PARKED`** — esperando re-publicação pelo sweeper (erro transiente com tentativas imediatas esgotadas). Estados existentes inalterados |
| `nextAttemptAt` | `DateTime?` — quando o sweeper pode re-publicar (agendamento: `retryAfterMs` do provedor ou patamar do backoff) |
| `parkedAt` | `DateTime?` — momento em que entrou em parked (base da idade no dashboard) |
| `parkCycles` | `Int @default(0)` — quantas vezes o sweeper já a re-publicou |

Índice novo: `(status, nextAttemptAt)` — consulta do sweeper.

**Regra (FR-001/FR-006)**: transiente esgotado → `PARKED`, **nunca `FAILED`**.
Sai de parked apenas por: conclusão com sucesso (`COMPLETED`), expiração da
janela (`FAILED` com `lastError.type = 'PARK_WINDOW_EXPIRED'`, FR-006) ou lead
excluído (descarte silencioso no sweeper).

### EnrichmentTaskRetryEvent (NOVA) — auditoria de retries (FR-007)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | String (cuid) | PK |
| `taskId` | String | FK → EnrichmentTask, `onDelete: Cascade`, indexado |
| `orgId` | String | = task.orgId (isolamento); indexado com `createdAt` |
| `cycle` | Int | nº do ciclo parked (1, 2, 3…) |
| `errorType` | String | tipo do erro que motivou o park (TRANSIENTE) |
| `provider` | String? | provedor que falhou |
| `message` | String? | mensagem curta do último erro |
| `scheduledFor` | DateTime | quando o sweeper pode re-publicar |
| `publishedAt` | DateTime? | quando o sweeper efetivamente re-publicou |
| `createdAt` | DateTime | default now() |

Uma linha por ciclo parked. Deduplicação do re-publicar: `publishedAt IS NULL`
para o ciclo vigente — o sweeper nunca publica duas vezes o mesmo ciclo.

### EnrichmentJob (ALTERADA)

| Mudança | Detalhe |
|---|---|
| `status` | novo valor **`DEGRADED`** — job cujas tasks restantes estão todas `PARKED` (não-terminal): indica "aguardando provedor" (R5). Ao concluir a última parked, refinaliza para `COMPLETED`/`FAILED`/`PARTIAL` e publica `enrichment.job.completed.v1` como hoje |

Regra do `maybeFinalizeJob`: se nenhuma task ativa (PENDING/QUEUED/RUNNING/RETRY/
TIMEOUT/BLOCKED) restar **mas existirem tasks PARKED** → job vira `DEGRADED`
(sem publicar completion); se restar qualquer outra ativa → aguarda como hoje.
Consumidores do `completed.v1` podem receber um segundo evento (aditivo) quando
o job refinalizar — idempotência exigida já é padrão do runtime (R5).

### OpsNotification (NOVA) — registro/dedup de alertas (FR-014/015/016)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | String (cuid) | PK |
| `dedupKey` | String | **`@unique`** — dedup durable (ex.: `task_failed:<taskId>`, `circuit:<provider>` para a janela corrente, `digest:<data>`) |
| `kind` | String | `task_failed` \| `circuit_open` \| `park_expired` \| `digest` |
| `severity` | String | `critical` \| `warning` \| `info` |
| `orgId` | String? | organização afetada (digest/global → null) |
| `title` | String | título curto |
| `payload` | Json | detalhes (lead, capability, erro, contadores) |
| `channels` | Json | `["slack","email"]` — efetivamente usados |
| `deliveredAt` | DateTime? | primeiro envio com sucesso |
| `createdAt` | DateTime | default now() |

### Capabilities OSINT (worker Python — sem mudança de schema)

Resultado da task passa a carregar `partial: true` + `events_collected` quando a
task conclui no prazo com coleta incompleta (FR-010); o merge v2 idempotente
existente aceita o resultado parcial normalmente.

## Transições de estado da task

```text
            ┌─────────┐  resultado ok   ┌───────────┐
 criação →  │ PENDING │────────────────►│ COMPLETED │
            │ (QUEUED)│                 └───────────┘
            └────┬────┘
                 ▼ execução
             ┌─────────┐  resultado ok ──► COMPLETED
             │ RUNNING │────┐
             └────┬────┘    │ falha TRANSIENTE (tentativas restantes)
                  │         ▼
                  │   ┌──────────┐  backoff/retryAfterMs  ┌─────────┐
                  │   │  RETRY / │───────────────────────►│ RUNNING │ (cíclico)
                  │   │ TIMEOUT  │                        └─────────┘
                  │   └────┬─────┘
                  │        ▼ tentativas imediatas esgotadas + TRANSIENTE
                  │   ┌──────────┐  sweeper (nextAttemptAt, taxa por provedor)
                  │   │  PARKED  │────────────────────────► RUNNING ──► COMPLETED
                  │   └────┬─────┘                                   (job refinaliza)
                  │        ▼ janela (72h) expirada
                  │   ┌──────────┐
                  │   │  FAILED  │  ← APENAS: não-transiente, ou park expirado
                  │   └──────────┘    + notificação à operação (US5)
```

Job: `PROCESSING → COMPLETED | FAILED | PARTIAL` (hoje) + **`DEGRADED`**
(job só com tasks PARKED — aguardando provedor; refinaliza depois).

## Consultas e índices

- Sweeper: `findMany({ where: { status: 'PARKED', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: batch })` — indexado por `(status, nextAttemptAt)`.
- Dashboard/ops: agregados por `status`, `parkCycles`, `parkedAt`, agrupados por `orgId` (índice existente `orgId` + novo composto).
- Dedup de notificações: `dedupKey @unique` em `OpsNotification` (conflict → ignora/loga).

## Invariantes

- **I1**: nenhuma task transiente termina `FAILED` (só não-transiente ou park expirado).
- **I2**: um ciclo parked gera exatamente 1 `EnrichmentTaskRetryEvent` e no máximo 1 re-publicação.
- **I3**: job `DEGRADED` nunca publica `enrichment.job.completed.v1` (só refinaliza publicando).
- **I4**: resultado tardio (retry) nunca sobrescreve dados mais novos (`enrichmentVersion` + merge idempotente existentes).
- **I5**: notificação falha ≠ enriquecimento falha (entrega é best-effort com log).
