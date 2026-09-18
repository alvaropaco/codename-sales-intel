# Implementation Plan: Métricas de Decisão de Contato no Lead

**Branch**: `003-contact-decision-metrics` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-contact-decision-metrics/spec.md`

## Summary

Substituir as três notas genéricas (Potencial, Prontidão, Lançamento) da seção
"Inteligência de enriquecimento" da tela de detalhes do lead por um **painel de
decisão de contato**: métricas **Atingibilidade** ("consigo chegar?") e
**Momento** ("agora é hora?") com evidência visível, mais uma **recomendação de
contato** única em três níveis, explicável por fatores (atingibilidade, momento,
risco de crédito, aderência). Abordagem técnica: **módulo determinístico
server-side** (`contact-decision.js`, mesmo padrão de `opportunity-score.js`)
que computa as métricas **on-read** a partir das evidências já persistidas
(prospect, enrichmentSummary, perfil do grafo) — **sem migração de schema, sem
novo serviço e sem nova capability de enriquecimento** — exposto em
`GET /api/prospects/:id/contact-decision` e renderizado no frontend em seção
com estado próprio (mesmo padrão de estados carregando/erro/vazio da tela).

## Technical Context

**Language/Version**: Node.js (Express 5) na plataforma; TypeScript/React (Vite) em `apps/web/`. Nenhuma mudança nos serviços Python.

**Primary Dependencies**: Nenhuma nova. Reutiliza `opportunity-score.js` (`classifyEmailDomain`, `isActive`, `ageYears`-equivalente), `enrichment-graph.js` (`fetchCompanyGraph`), `org-context.js`, `plan.js`/`plan-masking.js`.

**Storage**: Nenhum esquema novo — leitura de `prospect` (Prisma/Postgres) e da view do grafo (`v_company_graph` via pool existente). Zero migração.

**Testing**: `node --test test/*.test.js` (constituição III — testes antes da implementação, no módulo puro). Frontend validado por `build` + `typecheck` (padrão atual do repo; não há runner de teste no web).

**Target Platform**: Web desktop (SPA), API Node na plataforma existente.

**Performance Goals**: endpoint de decisão responde com os mesmosdados de 1 leitura Prisma + 1 leitura da view do grafo; alvo < 200 ms p95 típico; sem LLM, sem chamadas externas.

**Constraints**: determinístico e puro (sem rede dentro do cálculo); nunca emite valores de contato (e-mails/telefones) na resposta — seguro a trial por construção (FR-011 da spec); isolamento por organização via `requireRequestOrgId`; degradação do grafo não derruba a seção (FR-013).

**Scale/Scope**: 1 módulo novo na raiz, 1 endpoint, 1 componente reescrito (`LeadIntelligence.tsx`), 1 hook estendido (`useLeadDetail.ts`), tipos novos em `apps/web/src/types/index.ts`. Sem mudança em listas, ordenações ou esteiras NATS.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Evidência |
|-----------|-----------|-----------|
| I. Especificação antes de código | ✅ PASS | `specs/003-contact-decision-metrics/spec.md` + clarify (4 decisões) |
| II. Persistência idempotente orientada a eventos | ✅ PASS | Nenhuma mudança em contratos NATS nem em consumidores; cálculo é leitura-only sobre fatos já persistidos |
| III. Testes como porta de entrada | ✅ PASS | Toda a lógica vive em módulo puro testado com `node --test` (`test/contact-decision.test.js`), padrão `opportunity-score.test.js`; tarefas de teste precedem implementação |
| IV. Multi-tenancy e gating por plano | ✅ PASS | Endpoint escopado por `orgId` (404 cross-tenant, mesmo padrão do `GET /api/prospects/:id`); resposta não contém valores restritos (só existência/qualidade/confiança), mantendo métricas visíveis a trial conforme spec (FR-011) |
| V. Segredos fora do repositório | ✅ PASS | N/A — nenhuma credencial nova |
| VI. Simplicidade incremental (YAGNI) | ✅ PASS | Módulo plano na raiz (padrão do repo), zero dependência nova, zero serviço novo, zero migração; alternativa de persistir scores no worker foi rejeitada (exigiria reenriquecimento de leads existentes — ver research.md) |
| VII. Deploy GitOps observável | ✅ PASS | Entra pelo CI/deploy normal da plataforma; erros de rota logam estruturado como os endpoints vizinhos; fluxo não é crítico novo (leitura derivada) — sem métrica prometheus nova nesta fase |

**Re-check pós-Phase 1**: ✅ PASS — o design não introduz violações; nenhum item na Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-contact-decision-metrics/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.md           # Phase 1 output — contrato do endpoint de decisão
└── tasks.md             # Phase 2 output ($speckit-tasks)
```

### Source Code (repository root)

```text
contact-decision.js            # NOVO — módulo puro: computa atingibilidade, momento,
                               #   recomendação e freshness a partir das evidências
server-prod.js                 # rota GET /api/prospects/:id/contact-decision
                               #   (org-scope, plano, degradação do grafo, logs)
opportunity-score.js           # (reutilizado, sem mudança) classifyEmailDomain,
                               #   isActive, helpers de CNPJ
enrichment-graph.js            # (reutilizado, sem mudança) fetchCompanyGraph → perfil
test/
└── contact-decision.test.js   # NOVO — testes do módulo puro (node --test)

apps/web/src/
├── types/index.ts             # tipos ContactDecision*
├── services/api.ts            # fetchContactDecision()
├── components/lead/
│   ├── useLeadDetail.ts       # seção 'decision' com estado próprio + polling
│   ├── LeadDetailScreen.tsx   # passa decision + graph para a seção
│   └── LeadIntelligence.tsx   # REESCRITO — painel de decisão (FR-001..FR-018)
└── (demais componentes de lead — intocados)
```

**Structure Decision**: plataforma monolítica Node (raiz) + SPA em `apps/web` —
estrutura existente, sem opção nova. A lógica de decisão fica na plataforma
(server-side) e não no frontend porque: (a) a constituição exige testes como
porta de entrada e o runner de teste está na plataforma; (b) o cálculo usa dados
que só o servidor vê sem mascarar (qualidade do domínio do e-mail, situação
cadastral, perfil comercial); (c) precedent direto: `opportunity-score.js`.

## Complexity Tracking

> Vazio — nenhum violation de constituição a justificar.
