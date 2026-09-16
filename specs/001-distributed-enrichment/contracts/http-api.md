# Contract — HTTP API (alterações e adições)

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Autenticação/tenant inalterados: `firebase-auth.js` + `requireRequestOrgId` — toda rota nova resolve `orgId` do JWT/sessão e filtra por ele (constituição IV). Respostas respeitam `plan-masking.js` (trial não vê dados restritos — FR-033).

---

## 1. Rotas existentes — mudança de comportamento (transparente)

### `POST /api/prospects` · `POST /api/prospects/:id/enrich` · pós-CSV · transição de estágio · discovery

Com `ENRICHMENT_ENGINE_V2` ativo (e org na allowlist), `dispatchEnrichmentForPlan` passa a delegar ao `enrichment-manager.js` (cria `EnrichmentJob` + tasks). Resposta continua igual à atual; **adição**: `enrichmentJobId` no payload de resposta quando o motor v2 atende.

```json
{ "ok": true, "prospect": { "…": "…" }, "enrichmentJobId": "cuid" }
```

Erros existentes preservados: `403 PLAN_LIMIT_REACHED` (cota de captura), `403 PREMIUM_REQUIRED`. Novo com motor v2: `429 ENRICHMENT_QUOTA_EXCEEDED` quando a cota mensal de enriquecimento da org for atingida (FR-034).

```json
{ "error": "ENRICHMENT_QUOTA_EXCEEDED", "message": "Cota de enriquecimento do plano atingida", "resetAt": "2026-10-01T00:00:00.000Z" }
```

## 2. Rotas novas

### `GET /api/enrichment/jobs/:jobId`

Status do job + breakdown por task. Escopo por org (`404` se de outro tenant — nunca `403` para não revelar existência).

```json
{
  "jobId": "cuid",
  "status": "PARTIAL",
  "trigger": "api",
  "plan": "premium",
  "counts": { "total": 24, "completed": 19, "running": 1, "pending": 0, "retry": 0, "failed": 3, "cancelled": 1, "blocked": 0 },
  "completionPct": 79.2,
  "tasks": [
    { "taskId": "cuid", "capability": "identity.cnpj.resolve", "entityType": "prospect",
      "status": "COMPLETED", "attempt": 1, "provider": "searxng.rfb",
      "startedAt": "…", "completedAt": "…", "error": null }
  ],
  "createdAt": "…", "startedAt": "…", "completedAt": null
}
```

### `GET /api/prospects/:prospectId/enrichment`

Fatos agregados do lead a partir de `EnrichmentResult`/`EnrichmentEvidence`, agrupados por entidade e capability, com evidência auditável (US6). **Mascaramento de trial aplicado** (`maskProspectForTrial`/`stripMaskedIncomingFields` continuam sendo a última camada).

```json
{
  "prospectId": "cuid",
  "jobId": "cuid (último job)",
  "entities": [
    { "entityKey": "prospect:cls…", "entityType": "prospect",
      "facts": [
        { "attribute": "company.employeeCount", "value": 350, "confidence": 0.91,
          "evidence": { "sourceType": "searxng", "provider": "searxng.rfb", "url": "https://…",
                        "retrievedAt": "…", "rawRecordId": "cuid|null" } }
      ]
    }
  ]
}
```

`?include=evidence` (default) · `?include=raw` nunca expõe payload bruto por esta rota — bruto é interno (reprocessamento).

### `GET /api/admin/enrichment/providers`

Role admin. Saúde operacional dos providers (US8/FR-021):

```json
{
  "providers": [
    { "provider": "searxng", "state": "HEALTHY | DEGRADED | OPEN | HALF-OPEN | DISABLED",
      "rpm": { "limit": 120, "used": 43 },
      "concurrency": { "limit": 20, "used": 6 },
      "errorRate1m": 0.02, "avgLatencyMs": 850 }
  ]
}
```

## 3. Contratos de erro padrão

| Status | Código | Quando |
|---|---|---|
| 404 | — | recurso de outro tenant ou inexistente |
| 403 | `PLAN_LIMIT_REACHED` / `PREMIUM_REQUIRED` | cotas/gating existentes (inalterados) |
| 429 | `ENRICHMENT_QUOTA_EXCEEDED` | cota mensal de enriquecimento (FR-034) |
| 409 | `ENRICHMENT_JOB_IN_PROGRESS` | opção `?dedupe=true` no enrich manual: já existe job ativo para o prospect |
