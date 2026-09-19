# Implementation Plan: Análise Profunda de Lead por IA no Pipeline

**Branch**: `005-deep-lead-analysis` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-deep-lead-analysis/spec.md`

## Summary

Reestruturar o pipeline de vendas: remover o estágio `lead` ("Novas
oportunidades"), adicionar o estágio `deep_analysis` ("Análise profunda") entre
`prospect` e `qualified` e o destino final `discarded` ("Descartados"). Em
organizações premium, a conclusão do enriquecimento move o lead para "Análise
profunda" e dispara, sem ação do usuário, uma análise de IA (gateway LiteLLM
via `llm-client.js`) que cruza o contexto comercial da organização
(`org-context.js` a partir de `CommercialSettings`) com os dados capturados do
lead (Prospect + `enrichmentSummary` + score determinístico + painel de decisão
da feature 003). O resultado — score final 0–100, veredito e resumo com
impressões — é persistido no novo modelo `DeepAnalysis`; veredito positivo
avança o lead para `qualified`, negativo o move para `discarded`. O score final
da IA passa a ser o score exibido; a página de detalhes ganha uma seção
dedicada (nova fonte independente em `useLeadDetail`).

## Technical Context

**Language/Version**: Node.js (Express 5) na plataforma raiz; SPA React 18 +
Vite + TypeScript em `apps/web/`; Prisma 5 / PostgreSQL. Sem alterações nos
serviços Python (a IA roda via gateway LiteLLM já consumido pela plataforma).

**Primary Dependencies**: `llm-client.js` (cliente compartilhado LiteLLM,
JSON mode), `org-context.js` (contexto de negócio da org para prompts),
`plan.js` (`getOrgPlan`/`isPremiumOrg`), `plan-masking.js`
(`redactProspectForPlan`), `contact-decision.js` + `opportunity-score.js`
(insumos determinísticos da análise), `metrics.js` (prom-client), NATS
JetStream (consumidor de resultados de enriquecimento — sem contrato novo).

**Storage**: PostgreSQL via Prisma — nova tabela `DeepAnalysis` + novos valores
de `Prospect.status` (`deep_analysis`, `discarded`) + `Prospect.analysisStatus`.
Migração exclusivamente via `pnpm run db:migrate` (constituição VI).

**Testing**: `pnpm test` (`node --test test/*.test.js`) na plataforma; build do
web (`apps/web`) nos quality gates. Testes do módulo puro (prompt, validação de
resultado, transições de estágio, endpoints de contrato) antes da implementação
(constituição III).

**Target Platform**: Servidor Node (deploy GitOps/ArgoCD) + navegador (SPA).
A análise roda in-process na plataforma (fire-and-forget, com reconciliação no
boot no padrão `resumePendingEnrichments`).

**Performance Goals**: veredito concluído em ≤ 5 min p95 após a conclusão do
enriquecimento (SC-001); a chamada LLM em si tem timeout de 30 s
(`DEFAULT_TIMEOUT_MS` do `llm-client`); a esteira não bloqueia requisições HTTP
(fila em memória + reconciliação).

**Constraints**: gating premium obrigatório (nenhuma saída da análise vaza para
trial — `plan-masking`); isolamento por organização em todos os endpoints;
falha de LLM nunca avança nem descarta lead (fica em `analysisStatus='failed'`);
nenhum contrato NATS existente é alterado (a análise é in-process).

**Scale/Scope**: 1 módulo novo (`deep-analysis.js`), 1 modelo Prisma novo,
2 endpoints novos + evolução das regras de transição no `PUT /prospects/:id` e
no bulk, 1 seção nova na tela de detalhes, colunas do kanban atualizadas,
1 migração + backfill idempotente de `status='lead' → 'prospect'`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Evidência |
|---|---|---|
| I. Especificação antes de código | ✅ | `specs/005-deep-lead-analysis/spec.md` (Draft, clarificada) |
| II. Persistência idempotente orientada a eventos | ✅ | Nenhum contrato `*.v1` é alterado; a análise é in-process. Gatilho idempotente por `enrichmentVersion` (reprocessar o mesmo evento não duplica análise); reexecução substitui a análise vigente de forma determinística |
| III. Testes como porta de entrada | ✅ | `test/deep-analysis.test.js` (módulo puro: prompt, validação do resultado JSON, decisão de próximo estágio) + testes de transição/contratos de API antes da implementação |
| IV. Multi-tenancy e gating por plano | ✅ | Endpoints escopados por `orgId` (`requireRequestOrgId`); análise premium-only; `redactProspectForPlan`/`plan-masking` impede vazamento de score final/veredito/resumo para trial (SC-007/FR-018) |
| V. Segredos fora do repositório | ✅ | Reusa `LITELLM_URL`/`LITELLM_MODEL` já em env; nenhum segredo novo |
| VI. Simplicidade incremental (YAGNI) | ✅ | 1 módulo plano novo + 1 tabela; sem framework/dependência nova; sem novo serviço Python (o caminho de IA é o gateway LiteLLM já usado por `ai-campaign`/`ava-extract`) |
| VII. Deploy GitOps observável | ✅ | Métricas prom-client (iniciadas/concluídas/falhas/latência/vereditos) + logs estruturados por etapa da análise |

**Re-check pós-Phase 1**: sem violações — a decisão de manter a análise
in-process (novo serviço Python) está registrada em `research.md` (R1).

## Project Structure

### Documentation (this feature)

```text
specs/005-deep-lead-analysis/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões técnicas
├── data-model.md        # Fase 1 — entidades e transições de estado
├── quickstart.md        # Fase 1 — validação ponta a ponta
├── contracts/
│   └── api.md           # Fase 1 — contratos HTTP (endpoints e payloads)
└── tasks.md             # Fase 2 ($speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
# Plataforma (raiz) — módulos planos, padrão do repo
deep-analysis.js            # NOVO: motor da análise (prompt, validação, orquestração)
pipeline-transitions.js     # NOVO: regras de transição do pipeline (extraído de server-prod, R7)
server-prod.js              # Transições de estágio (stageTransitionError) + 2 endpoints novos
nats-enrichment.js          # Hook pós-enriquecimento → deep_analysis (premium)
cnpj-enrichment.js          # Mesmo hook no fluxo básico (trial segue p/ qualified)
plan-masking.js             # Mascaramento da análise para planos sem o recurso
metrics.js                  # Contadores/gauges da análise
prisma/schema.prisma        # DeepAnalysis + status/analysisStatus
prisma/migrations/<ts>_deep_lead_analysis/  # Migração (db:migrate)
scripts/backfill-lead-status.js  # NOVO: backfill idempotente lead → prospect
test/
├── deep-analysis.test.js   # NOVO: módulo puro (antes da implementação)
├── deep-analysis-pipeline.test.js  # NOVO: gatilho, vereditos, gating
└── (testes existentes de transição/kanban atualizados)

apps/web/src/
├── types/index.ts                    # ProspectStatus + DeepAnalysis types
├── services/api.ts                   # fetchDeepAnalysis, rerunDeepAnalysis
├── components/views/PipelineKanbanView.tsx   # Novas colunas + estados no card
├── components/lead/
│   ├── LeadDetailScreen.tsx          # PIPELINE_STATUSES + seção nova
│   ├── LeadDeepAnalysis.tsx          # NOVO: seção da análise profunda
│   └── useLeadDetail.ts              # fonte independente da seção
```

**Structure Decision**: mantém-se a estrutura existente do monorepo — módulos
planos na raiz da plataforma (padrão `contact-decision.js`, constituição VI) e
componentes de seção em `apps/web/src/components/lead/` (padrão da feature
002). Nenhum diretório novo de projeto.

## Complexity Tracking

> Sem violações de constituição — nada a justificar. A única decisão de
> arquitetura relevante (análise in-process na plataforma em vez de um worker
> Python novo) é uma aplicação direta do princípio VI e está documentada em
> `research.md` (R1).
