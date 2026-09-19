# API Contracts: Análise Profunda de Lead

**Feature**: 005-deep-lead-analysis | **Date**: 2026-09-18

Contratos HTTP da plataforma (Express, `/api`). Convenções existentes mantidas:
autenticação Firebase + `orgId` via `requireRequestOrgId`; respostas
`{ success, data | error, code? }`; erros de negócio com `status` + `code`.
Todos os endpoints são escopados por organização (FR-016) e respeitam masking
por plano (FR-018).

## Novos endpoints

### GET /api/prospects/:id/deep-analysis

Análise vigente do lead + estado da execução.

- **200** (org premium):

```json
{
  "success": true,
  "data": {
    "state": "completed",              // not_started | running | completed | failed
    "analysis": {                      // null quando state ≠ completed
      "id": "clx…",
      "finalScore": 78,                // 0–100
      "verdict": "contact",            // contact | no_contact
      "summary": "…resumo completo e impressões da IA…",
      "factorsPro": ["…"],             // string[]
      "factorsCon": ["…"],             // string[]
      "deterministicScore": 64,        // referência (FR-008)
      "orgContextConsidered": true,    // false ⇒ aviso na UI (FR-017)
      "override": false,               // true ⇒ veredito negativo superado por humano
      "modelVersion": "qwen/qwen2.5-7b-instruct",
      "completedAt": "2026-09-18T12:34:56.000Z"
    },
    "errorMessage": null               // string quando state = failed
  }
}
```

- **200** com `state: "not_started" | "running"`: `analysis: null` (UI mostra
  estado; FR-013 aceita 2).
- **403** `{ "code": "PREMIUM_FEATURE" }` — org sem o recurso: nenhuma
  informação sobre análise é revelada (nem existência de dados; SC-007).
- **404** — lead inexistente ou de outra org (nunca vaza existência).

### POST /api/prospects/:id/deep-analysis/rerun

Reexecuta a análise (FR-014). Dispara execução assíncrona; o estado passa a
ser `running` (sondado pelo endpoint acima).

- **202** `{ "success": true, "data": { "state": "running" } }`
- **403** `PREMIUM_FEATURE` | **404** lead inexistente/cross-tenant
- **409** `{ "code": "ANALYSIS_RUNNING" }` — já existe execução em andamento
  (edge case "reexecução concorrente")

### Mutação de estágio via PUT /api/prospects/:id (EVOLUI)

Contrato existente preservado; mudanças:

- `status` passa a aceitar `deep_analysis` e `discarded`; entrada `lead` é
  normalizada para `prospect` (o valor deixa de existir — FR-001).
- `deep_analysis` só é aceito com enriquecimento concluído (mesmo gate atual
  de `qualified`) — senão **422** `STAGE_TRANSITION_BLOCKED`.
- `deep_analysis` → `qualified`/`closed` **bloqueado** enquanto a análise está
  `running` (422 `ANALYSIS_RUNNING` no lugar de `STAGE_TRANSITION_BLOCKED`
  quando o motivo é a análise).
- Avanço manual com veredito vigente `no_contact` é **permitido** (override) e
  registra `override=true` na análise vigente (resposta normal; a UI reflete
  na seção de detalhes).
- `discarded` → `deep_analysis` (restaurar) dispara reanálise (202-like; a
  resposta segue o padrão do PUT, estado passa a `running`).
- `qualified`/`closed` → `prospect` permanece **sempre bloqueado**.

### POST /api/prospects/bulk (EVOLUI)

`action: "move"` aceita os novos destinos (`deep_analysis`, `discarded`) com
as mesmas regras de transição por lead; `skipped` na resposta cobre leads
bloqueados (análise em execução, retorno proibido etc.) — contrato atual
`{ count, skipped }` inalterado.

### GET /api/prospects (EVOLUI — payload do kanban)

Cada prospect inclui campos mínimos do estado de análise para o card:

```json
{
  "id": "clx…", "status": "deep_analysis",
  "analysisStatus": "completed",       // not_started | running | completed | failed
  "verdict": "contact",                // contact | no_contact | null
  "opportunityScore": 78               // score final da IA quando vigente
}
```

Para orgs **sem** o recurso (trial): `analysisStatus`, `verdict` = `null`
(masking — FR-018); `status` nunca será `deep_analysis` para essas orgs.
O resumo completo NÃO entra na listagem — apenas em `GET …/deep-analysis`.

## Erros e códigos novos

| HTTP | code | Quando |
|---|---|---|
| 403 | `PREMIUM_FEATURE` | endpoint/payload de análise para org sem recurso |
| 409 | `ANALYSIS_RUNNING` | reexecução concorrente; avanço manual com análise em execução |
| 422 | `STAGE_TRANSITION_BLOCKED` | regra de transição violada (mensagem explicativa, padrão atual) |

## Semântica assíncrona

A análise NUNCA executa no ciclo request/response: gatilhos (conclusão de
enriquecimento, entrada manual em `deep_analysis`, reexecução, restauração)
enfileiram a execução e o estado vira `running`. Clientes sondam
`GET …/deep-analysis` (página de detalhes) e o polling já existente da
listagem (kanban). Falha da LLM/validação ⇒ `state: "failed"` +
`errorMessage` — o lead permanece em `deep_analysis` (FR-015).

## Eventos NATS

Nenhum contrato `*.v1` novo ou alterado (R1/R2): a análise é in-process na
plataforma, disparada pelos consumidores existentes de resultados de
enriquecimento. Métricas e logs estruturados documentam a execução (R9);
se um dia a análise migrar para serviço próprio, o contrato nascerá como
`deep_analysis.lead.requested.v1` — fora de escopo aqui.
