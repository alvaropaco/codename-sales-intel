# Data Model: Análise Profunda de Lead por IA no Pipeline

**Feature**: 005-deep-lead-analysis | **Date**: 2026-09-18

Mudanças de dados da feature. Migração exclusivamente via Prisma
(`pnpm run db:migrate`), com backfill idempotente separado (R10).

## Entidades

### DeepAnalysis (NOVA)

Resultado de uma execução da análise de IA sobre um lead. Uma linha por
execução; a **vigente** é apontada por `Prospect.currentDeepAnalysisId`.

| Campo | Tipo | Regras / Validação |
|---|---|---|
| `id` | String (cuid) | PK |
| `prospectId` | String | FK → Prospect, `onDelete: Cascade`, indexado |
| `orgId` | String | FK lógica → Organization; **sempre** = `prospect.orgId` (isolamento FR-016); indexado com `createdAt` |
| `status` | String | `running` \| `completed` \| `failed` — estado da execução (o estado "não iniciada" é a ausência de linha) |
| `modelVersion` | String? | modelo/alias efetivamente usado (preenchido ao concluir) |
| `finalScore` | Int? | 0–100, obrigatório quando `status='completed'` (validação de aplicação) |
| `verdict` | String? | `contact` \| `no_contact` — obrigatório quando `completed` |
| `summary` | String? | resumo em texto corrido (impressões da IA), obrigatório quando `completed` |
| `impressions` | Json | `string[]` — impressões estruturadas da IA para a seção de detalhes (default `[]`) |
| `factorsPro` | Json | `string[]` — fatores a favor (default `[]`) |
| `factorsCon` | Json | `string[]` — fatores contra (default `[]`) |
| `deterministicScore` | Int? | cópia do `opportunityScore` no momento da análise (referência, FR-008/R5) |
| `contactDecisionSnapshot` | Json? | breakdown do painel de decisão 003 usado como evidência (atingibilidade/momento/veredito determinístico) |
| `orgContextConsidered` | Boolean | `false` quando contexto comercial da org ausente (FR-017) |
| `override` | Boolean | default `false` — `true` quando o humano avançou o lead com veredito `no_contact` (transparência US3/edge case) |
| `errorMessage` | String? | motivo da falha (`status='failed'`) |
| `enrichmentVersion` | Int | versão do enriquecimento analisada (idempotência do gatilho, R6) |
| `createdAt` | DateTime | default now() |
| `completedAt` | DateTime? | conclusão (base da latência observada, SC-001) |

Índices: `prospectId` (unique parcial lógica em `status='running'` — no máximo
uma execução ativa por lead, edge case "reexecução concorrente");
`(orgId, createdAt)`; FK `currentDeepAnalysisId` (abaixo).

### Prospect (ALTERADA)

| Mudança | Detalhe |
|---|---|
| `status` | novos valores documentados: `prospect`, `deep_analysis`, `qualified`, `discarded`, `closed`. **`lead` removido** — backfill move para `prospect`; API normaliza entrada `lead` → `prospect` |
| `analysisStatus` | String, default `not_started`: `not_started` \| `running` \| `completed` \| `failed` — estado exibido no card (FR-012) sem join |
| `currentDeepAnalysisId` | String?, FK → DeepAnalysis (`onDelete: Set Null`) — análise vigente (R3) |
| `opportunityScore` | sem mudança de schema; a partir da conclusão de análise vigente premium, contém o `finalScore` da IA (R5). Leads trial e leads pré-análise mantêm o score determinístico |
| `relation` | `deepAnalyses DeepAnalysis[]` (histórico retido) |

### CommercialSettings / Organization (existentes, sem mudança)

Fonte do contexto comercial via `org-context.js`. `orgContextConsidered`
registra se havia contexto substancial (`configured`) na execução.

## Transições de estado do pipeline

Fonte da verdade: `stageTransitionError` em `server-prod.js` (R7). Estágios:
`prospect` (Em Qualificação) → `deep_analysis` (Análise profunda) →
`qualified` (Prontas para contato) → `closed` (Clientes ganhos);
`discarded` (Descartados) como destino final; `lead` **não existe mais**.

```text
                        ┌──────────────────────────────────────────────┐
                        │            (criação/API/import)              │
                        ▼                                              │
                  ┌──────────────┐   enriquecimento concluído           │
 criação manual   │              │   ── premium ──►  deep_analysis      │
 ou API ────────► │  prospect    │ ◄──────────────┐   (dispara análise) │
                  │              │   ── não-premium ─► qualified       │
                  └──────┬───────┘                    │                 │
                         │ manual (enriquec. concluído)│                 │
                         ▼                            ▼                 │
                  ┌──────────────┐  veredito   ┌──────────────┐        │
   manual (de     │ deep_analysis│─ positivo ─►│  qualified   │        │
   qualquer não   │              │             │              │        │
   terminal) ───► │  running /   │─ negativo ─►└──────┬───────┘        │
                  │  failed      │              manual│                │
                  └──┬───────────┘              (override registrado)   │
                     │ restaurar ──► volta p/ deep_analysis             │
                     │ (reanálise)                                      ▼
                     │                                       ┌────────────────┐
                     └──────────────────────────────────────►│  discarded     │
                             veredito negativo (auto)        │  (destino      │
                             ou descarte manual              │   final)       │
                                                             └────────────────┘
```

### Regras de transição (resumo normativo)

| De → Para | Automático | Manual | Condição |
|---|---|---|---|
| `prospect` → `deep_analysis` | ✅ conclusão do enriquecimento (premium) | ✅ | enriquecimento concluído (`enrichmentStatus ≠ pending`) |
| `prospect` → `qualified` | ✅ conclusão do enriquecimento (**não-premium**; comportamento atual) | ✅ escape (dados legados/falha) | enriquecimento concluído |
| `deep_analysis` → `qualified` | ✅ veredito `contact` | ✅ override (se `analysisStatus ≠ running`; registra override quando veredito era `no_contact`) | análise vigente concluída |
| `deep_analysis` → `discarded` | ✅ veredito `no_contact` | ✅ | idem |
| `*` (não terminal) → `discarded` | — | ✅ descarte manual | — |
| `discarded` → `deep_analysis` | — | ✅ restaurar | dispara reanálise |
| `qualified`/`closed` → `prospect` | ❌ | ❌ | regra atual mantida |
| qualquer → com `analysisStatus='running'` | ❌ | ❌ avanço manual bloqueado | FR-012 |

## Idempotência e concorrência

- **Gatilho por enriquecimento**: enfileirar análise só se não existir
  `DeepAnalysis` vigente com `enrichmentVersion` igual à versão aplicada
  (reprocessar o mesmo evento de conclusão não duplica — princípio II).
- **Reexecução manual**: cria nova linha `running` e move o ponteiro ao
  concluir; tentativa concorrente → 409 (contrato) e no-op interno.
- **Reconciliação no boot**: `analysisStatus='running'` + `status` preso em
  `deep_analysis` são re-despachados (R6), evitando "preso para sempre".
- **Cascade**: excluir `Prospect` remove o histórico de análises
  (`onDelete: Cascade`); excluir análise órfã nunca deve ocorrer (FK).

## Dados que NÃO entram no prompt

Valores crus de e-mail/telefone do lead (padrão da feature 003: apenas
existência/classificação/confiança). Nenhum dado de outra organização
(FR-016). A validação do payload de saída rejeita análise que não contenha os
campos obrigatórios (R4).

## Desvios registrados na implementação (2026-09-18)

- **`Prospect.verdict` denormalizado** (`contact|no_contact?`): payload do kanban sem join por card (lista usa `select` explícito; evitar N+1). Atualizado junto do `analysisStatus` na conclusão da análise.
- **`DeepAnalysis.impressions`** (Json, `string[]`): impressões estruturadas além do `summary` corrido — consumidas pela seção de detalhes (FR-013).
- **`currentDeepAnalysisId` com `@unique`**: exigência do Prisma para relação 1:1 (uma análise é vigente de no máximo um lead).
- **Índice parcial `DeepAnalysis_one_running_per_prospect`** (`WHERE status='running'`): aplicado no SQL da migração, fora do modelo Prisma (fecha F2/F5 do analyze).
- **`pipeline-transitions.js`**: extração das regras de transição prevista em research.md R7 executada (plan.md estrutura atualizada).
- **`closed` é terminal**: sem retorno a "Prontas para contato" (tabela normativa do data-model; o botão "Voltar" do kanban antigo nesse estágio foi removido).
