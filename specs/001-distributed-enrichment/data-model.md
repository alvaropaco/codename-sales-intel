# Data Model — Plataforma Distribuída de Enriquecimento de Leads

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Implementação: Prisma/PostgreSQL (migrations exclusivamente via `pnpm run db:migrate` / `db:deploy`). Todos os modelos novos carregam `orgId` (isolamento por organização — constituição IV). Não colidem com os models existentes `EnrichmentRequest` (ledger legado) e `CnpjEnrichment`.

---

## Modelos Prisma novos

### EnrichmentJob

Operação completa de enriquecimento de um lead.

```prisma
model EnrichmentJob {
  id         String   @id @default(cuid())
  orgId      String
  prospectId String
  // PENDING | RUNNING | PARTIAL | COMPLETED | FAILED | CANCELLED
  status     String   @default("PENDING")
  // manual | api | csv_import | qualification_stage | discovery
  trigger    String
  plan       String   // snapshot do plano da org no momento do job (trial|premium)
  engine     String   @default("v2")
  startedAt  DateTime?
  completedAt DateTime?
  lastError  Json?    // { type, message } quando FAILED/CANCELLED
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tasks EnrichmentTask[]

  @@index([orgId, createdAt])
  @@index([prospectId, createdAt])
}
```

- Percentuais de conclusão (FR-006) são **computados** por `groupBy(taskId → status)` no job (índice abaixo) — sem contadores denormalizados para não criar drift.
- `plan` é snapshot: gating é avaliado no planejamento; mudança de plano no meio do job não altera tasks já criadas.

### EnrichmentTask

Unidade fundamental de execução distribuída. Alta escrita — índices pensados para os acessos do manager.

```prisma
model EnrichmentTask {
  id          String   @id @default(cuid())
  orgId       String
  jobId       String
  prospectId  String
  taskKey     String   @unique   // uuidv5 determinístico (R4) — absorve replanejamento/redelivery
  entityKey   String   // ex.: "prospect:<id>", "domain:exemplo.com.br", "person:<key>"
  entityType  String   // prospect | company | person | domain | email | phone | social_profile | product | article
  capability  String   // ex.: identity.cnpj.resolve
  provider    String?  // provider selecionado no planejamento/execução
  input       Json
  inputHash   String
  // PENDING | QUEUED | RUNNING | COMPLETED | FAILED | RETRY | TIMEOUT | BLOCKED | CANCELLED | SKIPPED
  status      String   @default("PENDING")
  priority    Int      @default(2)  // 0=highest … 3=background
  attempt     Int      @default(0)
  maxAttempts Int      @default(3)
  timeoutMs   Int      @default(30000)
  dependsOn   String[] @default([]) // taskIds — DAG mínimo (R7)
  depth       Int      @default(0)  // profundidade de expansão dinâmica
  spawnedByTaskId String?           // rastreabilidade da expansão (FR-013)
  startedAt   DateTime?
  completedAt DateTime?
  lastError   Json?    // { type, message, provider, attempt }
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  job    EnrichmentJob    @relation(fields: [jobId], references: [id])
  result EnrichmentResult?

  @@index([jobId, status])
  @@index([status, priority])
  @@index([orgId, prospectId])
}
```

**Transições de estado (máquina da task)**:

```text
PENDING ──(planejadas deps)──▶ QUEUED ──▶ RUNNING ──▶ COMPLETED
   │                            ▲          │  │└▶ TIMEOUT ─┐
   └──(tem dependsOn)──▶ BLOCKED          │  └▶ FAILED (permanente)
                            │             └▶ RETRY (transiente) ── backoff ──▶ QUEUED
                            └─ deps concluídas ──▶ QUEUED
CANCELLED: dependência falhou permanentemente, ou job cancelado
SKIPPED: capability desabilitada/cota/gating no momento do despacho
```

Regras:
- `RETRY` e `TIMEOUT` só voltam a `QUEUED` enquanto `attempt < maxAttempts`; ao esgotar → `FAILED` com `lastError`.
- `FAILED` permanente (taxonomia em [contracts](../contracts/nats-enrichment-engine-v1.md)) vai direto de `RUNNING` → `FAILED`.
- publicação no NATS só em `QUEUED`; `BLOCKED` nunca é publicado.

### EnrichmentResult

Resultado final persistido **pelo worker** (um por task — retentativas sobrescrevem via upsert; histórico fica em `attempt`/`lastError` da task).

```prisma
model EnrichmentResult {
  id         String   @id @default(cuid())
  orgId      String
  taskId     String   @unique
  jobId      String
  prospectId String
  entityKey  String
  entityType String
  capability String
  provider   String?
  // COMPLETED | FAILED
  status     String
  data       Json?    // fatos normalizados canônicos (ex.: company.employeeCount)
  confidence Float?
  durationMs Int
  workerVersion String
  rawRecordId String?
  createdAt  DateTime @default(now())

  task     EnrichmentTask      @relation(fields: [taskId], references: [id])
  evidence EnrichmentEvidence[]

  @@index([orgId, prospectId])
  @@index([jobId])
}
```

### EnrichmentEvidence

Prova de origem **por fato** (FR-026). N anotações por resultado.

```prisma
model EnrichmentEvidence {
  id           String   @id @default(cuid())
  orgId        String
  resultId     String
  attribute    String   // ex.: company.employeeCount
  value        Json
  sourceType   String   // ex.: searxng | brasilapi | rfb | pdl | clearbit
  provider     String?
  url          String?
  retrievedAt  DateTime
  confidence   Float?
  rawRecordId  String?
  createdAt    DateTime @default(now())

  result EnrichmentResult @relation(fields: [resultId], references: [id])

  @@index([orgId, attribute])
}
```

Valores conflitantes de fontes distintas (edge case da spec) **coexistem**: são linhas distintas de evidence/results; a escolha do valor exibido é da agregação/qualificação, nunca do worker.

### RawRecord

Dado bruto retido (camada separada do normalizado — FR-027/028). Através de `raw-store.js`; backend inicial Postgres, S3 ativável (R5).

```prisma
model RawRecord {
  id            String   @id @default(cuid())
  orgId         String
  capability    String
  provider      String
  contentType   String   // application/json | text/html | text/plain
  sizeBytes     Int
  payload       String?  // preenchido quando storageBackend=postgres (limitado por RAW_MAX_BYTES)
  storageBackend String   @default("postgres")  // postgres | s3
  storageRef    String?  // chave do objeto quando backend=s3
  truncated     Boolean  @default(false)
  createdAt     DateTime @default(now())

  @@index([orgId, capability, createdAt])
}
```

Retenção: política default de 90 dias, limpeza por tarefa agendada (config); reprocessamento (SC-011) lê via `raw-store.get(ref)` sem chamada externa.

---

## Estruturas em Redis (runtime-only, não-Prisma)

| Chave | Tipo | Uso |
|---|---|---|
| `rl:{provider}:{yyyyMMddHHmm}` | counter + TTL 2min | janela fixa de requests/minuto por provider (FR-022) |
| `conc:{provider}` / `conc:{provider}:{token}` | contador + lease com TTL | semáforo distribuído de concorrência; lease evita vazamento em crash |
| `cb:{provider}:state` | string (`HEALTHY\|DEGRADED\|OPEN\|HALF-OPEN`) + TTL | circuit breaker (R6); `OPEN` com TTL = tempo de probe |
| `cb:{provider}:errors` | counter com janela | taxa de erro para abrir circuito |

Estado de provider é runtime-only: após restart/deploy o circuito reabre sozinho se o provider continuar ruim. Configuração de limites vive no catálogo/env, não no Redis.

## Headers de correlação (todas as mensagens e logs)

`X-Org-Id`, `X-Job-Id`, `X-Task-Id`, `X-Attempt`, `traceparent` (W3C, gerado no manager) — FR-036/R10.

## Relações com o modelo existente

- `Prospect` continua sendo o lead e o agregador de leitura: o manager aplica fatos em `enrichmentSummary` (merge por capability + versão da task — padrão `enrichmentVersion` já existente) e `qualification.js` atualiza `opportunityScore`/`score_breakdown`. Nenhuma coluna nova obrigatória no `Prospect` nesta fase.
- `EnrichmentRequest` (legado) passa a ser escrito também pela ponte `company.deepgraph` (R12) — continua sendo a tabela de correlação com o worker Python.
- `Organization.plan` é a fonte do gating; snapshot vai para `EnrichmentJob.plan`.
- Entidades derivadas (domain/person/etc.) são representadas por `entityKey` sintético — não ganham tabela própria nesta fase (o grafo rico já vive no schema `company_enrichment` do worker Python, acessível via `enrichment-graph.js`).
