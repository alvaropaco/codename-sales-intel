# Contract — Eventos NATS do motor de enriquecimento (`*.v1`)

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Stream JetStream: **`ENRICHMENT`** (existente; subjects `enrichment.>`; retention 7d). Nenhum stream novo.
Regras constitucionais: contratos versionados, consumidores idempotentes, evolução por `.v2` com convivência (constituição II). Contratos legados `enrichment.company.*.v1` **não mudam**.

---

## 1. Subjects

| Subject | Publicador | Consumidor durável | Papel |
|---|---|---|---|
| `enrichment.task.<capability>.v1` | manager | `enrichment-engine-<família>` (por worker) | despacho de task (comando de trabalho) |
| `enrichment.result.v1` | workers | `enrichment-manager`, `enrichment-qualification` | resultado/falha da task |
| `enrichment.job.completed.v1` | manager | consumidores externos (futuros) | agregado de conclusão de job |
| `enrichment.task.dlq.v1` | runtime dos workers | operação (log/métrica) | poison message (`term()` após esgotar tentativas) |

`<capability>` usa os pontos da capability como tokens NATS: `identity.cnpj.resolve` → `enrichment.task.identity.cnpj.resolve.v1`. O filtro do consumer de uma família usa wildcard: `enrichment.task.identity.>`.

## 2. Headers (obrigatórios em todas as mensagens)

| Header | Valor |
|---|---|
| `Nats-Msg-Id` | task: `taskId:{attempt}` (permite re-publicação de retry sem ser engolida pelo dedup) · result: `result:{taskId}:{attempt}` — dedup server-side |
| `X-Org-Id` | tenant (isolamento e filtro de auditoria) |
| `X-Job-Id`, `X-Task-Id`, `X-Attempt` | correlação |
| `traceparent` | W3C, gerado no manager, propagado verbatim |

**Proibido**: credenciais/segredos em payload ou headers (constituição V).

## 3. `enrichment.task.<capability>.v1` — despacho

```json
{
  "version": "1",
  "taskId": "cuid",
  "taskKey": "uuidv5 determinístico",
  "jobId": "cuid",
  "orgId": "cuid",
  "prospectId": "cuid",
  "entityKey": "prospect:cls… | domain:exemplo.com.br | person:<key>",
  "entityType": "prospect | company | person | domain | email | phone | social_profile | product | article",
  "capability": "identity.cnpj.resolve",
  "provider": "searxng.rfb | null",
  "input": { "…": "schema validado pelo catálogo da capability" },
  "priority": 2,
  "attempt": 1,
  "maxAttempts": 3,
  "timeoutMs": 30000,
  "depth": 0,
  "spawnedByTaskId": null,
  "createdAt": "2026-09-16T12:00:00.000Z"
}
```

## 4. `enrichment.result.v1` — resultado

```json
{
  "version": "1",
  "taskId": "cuid",
  "taskKey": "uuidv5 determinístico",
  "jobId": "cuid",
  "orgId": "cuid",
  "prospectId": "cuid",
  "entityKey": "…",
  "entityType": "…",
  "capability": "identity.cnpj.resolve",
  "provider": "searxng.rfb",
  "status": "COMPLETED | FAILED",
  "data": { "…": "fatos normalizados (COMPLETED)" },
  "facts": [
    {
      "attribute": "company.employeeCount",
      "value": 350,
      "confidence": 0.91,
      "evidence": {
        "sourceType": "searxng",
        "provider": "searxng.rfb",
        "url": "https://…",
        "retrievedAt": "2026-09-16T12:00:05.000Z",
        "rawRecordId": "cuid | null",
        "confidence": 0.91
      }
    }
  ],
  "error": { "type": "RATE_LIMIT", "message": "…", "retryable": true },
  "durationMs": 4231,
  "workerVersion": "git-sha ou semver do worker",
  "suggestedTasks": [
    { "capability": "search.news", "entityType": "company", "entityKey": "…", "input": {}, "provider": null }
  ],
  "completedAt": "2026-09-16T12:00:05.100Z"
}
```

- `FAILED` + `retryable: true` → runtime já fez `nak(delay)`; o evento serve para auditoria e para o manager marcar `RETRY`.
- `FAILED` + `retryable: false` → última entrega; manager marca `FAILED` definitivo.
- `suggestedTasks` é **declarativo** (R7): o manager valida (capability registrada, tier do plano, limites do job) antes de criar qualquer task. Worker nunca publica task.

## 5. `enrichment.job.completed.v1`

```json
{
  "version": "1",
  "jobId": "cuid",
  "orgId": "cuid",
  "prospectId": "cuid",
  "status": "COMPLETED | PARTIAL | FAILED | CANCELLED",
  "counts": { "total": 24, "completed": 19, "failed": 3, "cancelled": 1, "skipped": 1 },
  "completionPct": 79.2,
  "completedAt": "2026-09-16T12:03:00.000Z"
}
```

## 6. `enrichment.task.dlq.v1`

```json
{
  "version": "1",
  "taskId": "cuid",
  "jobId": "cuid",
  "orgId": "cuid",
  "capability": "…",
  "reason": "MAX_DELIVER_EXHAUSTED | POISON_MESSAGE",
  "lastError": { "type": "…", "message": "…" },
  "attempts": 4
}
```

## 7. Semântica de entrega (consumers)

- **Pull consumers duráveis** (padrão de `nats-enrichment.js`): `ack_policy=explicit`, `max_deliver = maxAttempts + 1`, batch configurável.
- `ack_wait` por família = maior `timeoutMs` das capabilities da família + margem de 30%.
- **Ack somente após persistir resultado + evidência + bruto e publicar o result event** (FR-018).
- Retry com backoff crescente via `nak(delayMs)`: `5s, 15s, 60s, 300s` (+ jitter) — últimos valores usados nas tentativas finais.
- `term()` → publica DLQ → task marcada `FAILED` (poison).
- Redelivery idempotente: `taskKey`/`Nats-Msg-Id`/`@@unique` absorvem duplicidade (R4).

## 8. Taxonomia de erro (decide retry × permanência)

| Classe | Tipos | Comportamento |
|---|---|---|
| Transiente | `NETWORK_ERROR`, `TIMEOUT`, `RATE_LIMIT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_CIRCUIT_OPEN`, `INTERNAL` | `nak(delay)` até `maxAttempts` |
| Permanente | `INVALID_INPUT`, `NOT_FOUND`, `UNAUTHORIZED`, `INVALID_DATA`, `CAPABILITY_DISABLED` | `term()`/falha definitiva, sem retry |

## 9. Compatibilidade

- JSON Schemas destes payloads serão versionados neste diretório (extração para `.json` + job de CI de backward-compat, espelhando o pipeline do `cnpj-data-publisher` — tarefa de M1).
- Qualquer quebra futura: novo subject/payload `.v2` com convivência; nunca mutação in-place.
