# Tasks: Análise Profunda de Lead por IA no Pipeline

**Input**: Design documents from `/specs/005-deep-lead-analysis/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: INCLUÍDOS por exigência da constituição (princípio III: "os testes
vêm antes das tarefas de implementação"). Padrão do repo: `node --test`
(`pnpm test`), módulos puros com fixtures — sem banco/rede
(`test/contact-decision.test.js`) e consumidores com `test/helpers/fake-prisma.js`
(`test/qualification.test.js`). Para o web (`apps/web`), o quality gate é
build + typecheck (nenhum framework de teste novo — princípio VI).

**Organization**: Tasks grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Monorepo com plataforma na raiz (módulos planos `*.js`) e SPA em `apps/web/`
(padronizado no plan.md; nada de `backend/`/`frontend/`).

**Nota de design (R7 ajustado)**: as regras de transição saem de
`stageTransitionError` (função privada em `server-prod.js:1402`) para o módulo
puro `pipeline-transitions.js` — a extração prevista no research.md torna-se
obrigatória aqui porque o conjunto de regras cresce (novos estágios, bloqueio
durante análise, override) e a constituição III exige testá-las. `server-prod.js`
passa a delegar.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tipos compartilhados e configuração de ambiente para todas as stories

- [X] T001 [P] Atualizar tipos em apps/web/src/types/index.ts: `ProspectStatus` passa a `'prospect' | 'deep_analysis' | 'qualified' | 'discarded' | 'closed'` (remover `'lead'`, `'contacted'`, `'proposal'` usos de kanban), adicionar tipos `AnalysisStatus = 'not_started' | 'running' | 'completed' | 'failed'`, `AnalysisVerdict = 'contact' | 'no_contact'` e `DeepAnalysisState` (payload do contrato `GET /api/prospects/:id/deep-analysis` em specs/005-deep-lead-analysis/contracts/api.md)
- [X] T002 [P] Documentar variáveis de ambiente novas (`DEEP_ANALYSIS_LLM_MODEL`, flags de reconciliação `DEEP_ANALYSIS_RECONCILE_ON_BOOT`/`DEEP_ANALYSIS_RECONCILE_LIMIT`) no arquivo de exemplo de env do repo (`.env.example` ou seção de env do README) — nenhum segredo novo (constituição V)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema de dados e infra de teste que TODAS as stories exigem

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Criar modelo `DeepAnalysis` e alterar `Prospect` em prisma/schema.prisma conforme specs/005-deep-lead-analysis/data-model.md: `DeepAnalysis` com campos `id`, `prospectId` (FK, `onDelete: Cascade`), `orgId`, `status` (`running|completed|failed`), `modelVersion`, `finalScore` (Int?, 0–100), `verdict` (`contact|no_contact`?), `summary` (String?), `factorsPro` (Json, default `[]`), `factorsCon` (Json, default `[]`), `deterministicScore` (Int?), `contactDecisionSnapshot` (Json?), `orgContextConsidered` (Boolean), `override` (Boolean, default `false`), `errorMessage` (String?), `enrichmentVersion` (Int), `createdAt`, `completedAt`; índices em `prospectId` e `(orgId, createdAt)`; em `Prospect`: `analysisStatus String @default("not_started")`, `currentDeepAnalysisId String?` (FK, `onDelete: Set Null`), relação `deepAnalyses DeepAnalysis[]`
- [X] T004 Gerar e aplicar a migração via Prisma (`pnpm run db:migrate`, nome `deep_lead_analysis`) — nunca `db push` (constituição I); conferir que a migração contém apenas estrutura (backfill é script separado, T010)
- [X] T005 [P] Criar stub de LLM para testes em test/helpers/fake-llm.js: função `createFakeLlm(responses)` compatível com a interface de chamada do deep-analysis.js (retorna `{ content, usage, model }`, permite simular JSON inválido, timeout e falha) — base dos testes de US2

**Checkpoint**: Foundation ready — schema migrado; user stories podem começar

---

## Phase 3: User Story 1 — Pipeline com "Análise profunda" e "Descartados" (Priority: P1) 🎯 MVP

**Goal**: Kanban exibe Em Qualificação → Análise profunda → Prontas para contato → Clientes ganhos + Descartados; sem "Novas oportunidades"; leads novos entram direto em Em Qualificação; premium move card enriquecido para Análise profunda; legado migrado

**Independent Test**: abrir o kanban e ver as 5 colunas; criar lead → entra em Em Qualificação; concluir enriquecimento premium → card pousa em Análise profunda (sem análise ainda — parado é aceito neste checkpoint); rodar backfill → nenhum lead em `lead`

### Tests for User Story 1 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T006 [P] [US1] Criar test/pipeline-transitions.test.js (node:test + assert, fixtures puras) cobrindo a tabela normativa de specs/005-deep-lead-analysis/data-model.md: destinos válidos a partir de cada estágio; `deep_analysis` exige enriquecimento concluído (`enrichmentStatus !== 'pending'`); bloqueio de avanço com `analysisStatus='running'`; `discarded` aceito de qualquer não-terminal; restauração `discarded → deep_analysis`; `qualified/closed → prospect` sempre bloqueado; normalização de entrada `'lead' → 'prospect'`; `statusAfterEnrichment` retorna `'deep_analysis'` para premium e `'qualified'` para não-premium (mesma conclusão de enriquecimento)

### Implementation for User Story 1

- [X] T007 [US1] Criar pipeline-transitions.js (módulo puro, sem I/O) exportando `validateTransition(previousStatus, nextStatus, prospect)` → `{ ok, code?, message? }` (códigos `STAGE_TRANSITION_BLOCKED`, `ANALYSIS_RUNNING`), `statusAfterEnrichment(prospect, orgPlan)` e `normalizeStatus(status)` conforme T006; regras verbatim da tabela de transições do data-model.md
- [X] T008 [US1] Delegar em server-prod.js: `stageTransitionError` (linha ~1402) e o bloco de validação do `PUT /api/prospects/:id` (linha ~1556) e do `POST /api/prospects/bulk` (linha ~1643) passam a usar `validateTransition`/`normalizeStatus` de pipeline-transitions.js; aceitar `deep_analysis` e `discarded` como destinos; mensagem de erro preserva o padrão atual (422 com texto explicativo; 422 `ANALYSIS_RUNNING` quando o motivo é análise em execução)
- [X] T009 [US1] Nos consumidores de conclusão de enriquecimento — nats-enrichment.js (linha ~303) e cnpj-enrichment.js (linha ~165) — substituir o spread inline `...(prospect.status === 'prospect' ? { status: 'qualified' } : {})` por `statusAfterEnrichment(prospect, orgPlan)` (buscar plano via getOrgPlan de plan.js uma vez por resultado); ao entrar em `deep_analysis`, setar também `analysisStatus: 'not_started'` (a fila de análise é US2 — card pode aguardar parado neste checkpoint)
- [X] T010 [P] [US1] Criar test/backfill-lead-status.test.js: com fake-prisma, valida que `status:'lead'` vira `'prospect'` em lote, que rodar duas vezes é no-op na segunda (idempotente, FR-003) e que leads em outros estágios não são tocados
- [X] T011 [US1] Criar scripts/backfill-lead-status.js (padrão scripts de backfill existentes, ex.: backfill-opportunity-score.js): varre `Prospect` com `status='lead'` e reescreve para `'prospect'` em lotes, logando contagem; executável por `node scripts/backfill-lead-status.js`; sem dependência de rede
- [X] T012 [US1] Atualizar apps/web/src/components/views/PipelineKanbanView.tsx: `columns` passa a 5 entradas (`prospect` Em Qualificação, `deep_analysis` Análise profunda, `qualified` Prontas para contato, `closed` Clientes ganhos, `discarded` Descartados) com cores distintas, grid `lg:grid-cols-5`; controles de avançar/voltar usam a ordem nova (Descartados sem avançar; restaurar fica para US4); select de movimento em lote lista as colunas novas
- [X] T013 [US1] Atualizar apps/web/src/components/lead/LeadDetailScreen.tsx: `PIPELINE_STATUSES` e `STATUS_LABEL` sem `'lead'` e com `'deep_analysis'` ("Análise profunda") e `'discarded'` ("Descartado")

**Checkpoint**: US1 independente — kanban novo funcional; premium enfileira card em Análise profunda (parado), trial segue direto para Prontas para contato; `pnpm test` verde (T006/T010 passam)

---

## Phase 4: User Story 2 — Análise de IA com veredito final (Priority: P1)

**Goal**: Entrar em Análise profunda dispara análise automática (premium); resultado persiste com score final, veredito e resumo; aprovado avança sozinho, reprovado vai para Descartados; reexecução e reconciliação; endpoints do contrato

**Independent Test**: com LLM stubado, lead premium chega à coluna → análise roda sem ação do usuário; veredito positivo → Prontas para contato com score da IA; negativo → Descartados; falha de LLM → estado de erro, lead parado; trial recebe 403 `PREMIUM_FEATURE`

### Tests for User Story 2 ⚠️ (constituição III — escrever ANTES, ver falhar)

- [X] T014 [P] [US2] Criar test/deep-analysis.test.js (módulo puro, padrão test/contact-decision.test.js) cobrindo: `buildPrompt` inclui o contexto da org via org-context.js e degrade honesta quando não configurado (`orgContextConsidered=false` esperado no parse); prompt NÃO contém e-mails/telefones crus do lead (apenas existência/classificação, padrão da 003); `validateResult` aceita `{score_final: 0–100, veredito: 'contact'|'no_contact', resumo, impressoes[], fatores_pro[], fatores_con[]}` e rejeita score fora de faixa, veredito desconhecido, resumo vazio e JSON inválido (cercas de código inclusas — stripJsonFences); `verdictStatusAfter(verdict)` retorna `'qualified'`/`'discarded'`
- [X] T015 [P] [US2] Criar test/deep-analysis-pipeline.test.js (fake-prisma + test/helpers/fake-llm.js) cobrindo a orquestração: conclusão enfileira execução única por lead (reprocessar o mesmo `enrichmentVersion` não duplica — princípio II); sucesso grava linha `DeepAnalysis` completa + ponteiro vigente + `opportunityScore=finalScore` + `analysisStatus='completed'` + veredito positivo move para `qualified`; negativo move para `discarded`; falha do LLM/JSON inválido → linha `failed` + `analysisStatus='failed'` + lead permanece em `deep_analysis` (FR-015); reexecução concorrente é no-op (uma `running` por lead); org não-premium nunca enfileira (FR-018); reconciliação no boot re-despacha `running` preso (R6); métricas `deep_analysis_started/completed/failed` incrementam via callback `onMetric`

### Implementation for User Story 2

- [X] T016 [US2] Criar deep-analysis.js: `buildPrompt({ orgContext, prospect, enrichmentSummary, contactDecision, deterministicScore })` (JSON compacto; contexto via buildOrgContext de org-context.js; sem PII de contato), `validateResult(raw)` (usa stripJsonFences de llm-client.js), `verdictStatusAfter(verdict)`, `enqueueDeepAnalysis(prisma, prospect, { trigger })` (fila em memória, uma execução por lead, gating premium via getOrgPlan/isPremiumOrg de plan.js, idempotência por `enrichmentVersion`), `runDeepAnalysis` (chamada via callLlm de llm-client.js com `DEEP_ANALYSIS_LLM_MODEL`, temperatura ≤0.3, maxTokens ~900), `reconcilePendingDeepAnalyses(prisma)` no padrão de `resumePendingEnrichments` (server-prod.js ~1484) com flags de env de T002, e hooks `onMetric` para prom-client
- [X] T017 [US2] Registrar métricas em metrics.js: `deep_analysis_started_total`, `deep_analysis_completed_total` (label `verdict`), `deep_analysis_failed_total` (label `reason`), histograma `deep_analysis_duration_seconds` (R9; sem dados de cliente nos logs — constituição VII)
- [X] T018 [US2] Ligar os gatilhos: entrada em `deep_analysis` enfileira a análise — server-prod.js no `PUT /api/prospects/:id` quando a transição resulta em `deep_analysis` (manual ou restauração de `discarded`) e nats-enrichment.js/cnpj-enrichment.js logo após T009 (fire-and-forget com try/catch isolado, padrão campaignSuite.onLeadEnriched); chamar `reconcilePendingDeepAnalyses` no boot do server-prod.js
- [X] T019 [US2] Aplicar o veredito (deep-analysis.js + server-prod.js): ao concluir, transação grava `DeepAnalysis` vigente + `Prospect` (`opportunityScore=finalScore`, `analysisStatus='completed'`, `currentDeepAnalysisId`, `status=verdictStatusAfter`) copiando `deterministicScore`; no `PUT` manual `deep_analysis → qualified/closed` com veredito vigente `no_contact`, permitir override e marcar `override=true` na análise vigente (FR-010/transparência); bloquear transição manual com `analysisStatus='running'` (422 `ANALYSIS_RUNNING`)
- [X] T020 [US2] Implementar `GET /api/prospects/:id/deep-analysis` em server-prod.js exatamente conforme specs/005-deep-lead-analysis/contracts/api.md (payload `{ state, analysis, errorMessage }`; escopo por `requireRequestOrgId`; 403 `PREMIUM_FEATURE` para org sem recurso — nenhuma informação de análise no corpo; 404 cross-tenant)
- [X] T021 [US2] Implementar `POST /api/prospects/:id/deep-analysis/rerun` em server-prod.js (202 `{state:'running'}`; 403 `PREMIUM_FEATURE`; 404; 409 `ANALYSIS_RUNNING` para reexecução concorrente)
- [X] T022 [US2] Atualizar plan-masking.js (`redactProspectForPlan`): para org sem recurso, `analysisStatus`/`verdict` saem do payload da listagem (`GET /api/prospects`); para premium, incluir `analysisStatus`, `verdict` e o `opportunityScore` vigente (score da IA) — resumo completo NUNCA na listagem (contracts/api.md)

**Checkpoint**: US2 independente — fluxo premium ponta a ponta com LLM stub; vereditos aplicados; gating e masking verificados por testes; `pnpm test` verde

---

## Phase 5: User Story 3 — Resumo e impressões na página de detalhes (Priority: P2)

**Goal**: Seção "Análise profunda" na tela de detalhes com resumo completo, impressões, veredito, score final, fatores e data; estados de execução/falha; override visível

**Independent Test**: abrir detalhes de lead analisado → seção completa em PT-BR; lead em análise/falha → estado correspondente sem quebrar as demais seções; quality gate: build + typecheck do web

### Implementation for User Story 3

- [X] T023 [US3] Adicionar clientes de API em apps/web/src/services/api.ts: `fetchDeepAnalysis(prospectId)` (GET do contrato; trata 403 `PREMIUM_FEATURE` como estado "indisponível para o plano") e `rerunDeepAnalysis(prospectId)` (POST; 409 `ANALYSIS_RUNNING` mapeado para feedback)
- [X] T024 [US3] Estender apps/web/src/components/lead/useLeadDetail.ts com fonte independente `deepAnalysisState` (carregamento em paralelo às demais, falha isolada — padrão das seções da 002) e re-consulta periódica enquanto `state==='running'` (padrão de re-poll do enriquecimento em andamento já existente no hook)
- [X] T025 [US3] Criar apps/web/src/components/lead/LeadDeepAnalysis.tsx: seção com resumo completo, lista de impressões, veredito (badge Contatar/Não contatar), score final com referência ao score determinístico (FR-008), fatores pró/contra, data da análise, aviso quando `orgContextConsidered=false` (FR-017), marcação de override humano quando `override=true`, estados `not_started`/`running`/`failed` com botão "Reexecutar análise"; textos em PT-BR
- [X] T026 [US3] Integrar LeadDeepAnalysis em apps/web/src/components/lead/LeadDetailScreen.tsx (entre as seções de inteligência/decisão e firmografia), passando `deepAnalysisState` do hook

**Checkpoint**: US3 independente — seção completa e resiliente; build do web sem erros

---

## Phase 6: User Story 4 — Estados da análise no kanban (Priority: P2)

**Goal**: Cards em Análise profunda comunicam analisando/aprovado/erro; reexecução pelo card; restauração a partir de Descartados; indicação de recurso premium para trial

**Independent Test**: observar card em análise (spinner, sem avanço manual), aprovado (selo + score) e falha (erro + reexecutar); restaurar de Descartados volta para Análise profunda; org trial vê banner premium e fluxo inalterado

### Implementation for User Story 4

- [X] T027 [US4] Completar apps/web/src/components/views/PipelineKanbanView.tsx para `deep_analysis`: card com `analysisStatus` — `running`: spinner "Analisando…" e sem botão de avanço (FR-012); `completed` + `verdict='contact'`: selo aprovado + score final; `failed`: indicação de erro com ação "Reexecutar" chamando `rerunDeepAnalysis`; reuso do padrão visual "Enriquecendo dados…/Avançar" existente; polling/refresh da listagem enquanto houver card `running` (mecanismo de refresh já usado pelo enriquecimento)
- [X] T028 [US4] Completar a coluna `discarded` em apps/web/src/components/views/PipelineKanbanView.tsx: card com veredito/motivo resumido e ação "Restaurar" (`PUT status='deep_analysis'` — dispara reanálise, FR-011); sem avanço a partir de Descartados
- [X] T029 [US4] Indicação de plano em apps/web/src/components/views/PipelineKanbanView.tsx: quando a org não tem o recurso (403 do plano/sinal do payload mascarado), coluna Análise profunda exibe aviso "Recurso premium" (FR-018) e cards nunca aparecem nela; fluxo de avançar/voltar da coluna não oferece `deep_analysis` a essas orgs

**Checkpoint**: US4 independente — kanban comunica e controla todo o ciclo da análise

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validação integrada e documentação

- [X] T030 [P] Revisar logs estruturados das etapas da análise (lead id, org id, modelo, tokens de usage, duração) sem dados de cliente nos logs (constituição VII); conferir rótulos das métricas no endpoint de métricas
- [ ] T031 Executar a validação ponta a ponta de specs/005-deep-lead-analysis/quickstart.md (cenários C1–C7), incluindo reconciliação pós-restart (C7.2) e falha de LLM (C7.3)
  - ⚠️ Pendente de ambiente: exige app no ar + gateway LiteLLM. Executado nesta sessão: migração aplicada (`prisma migrate deploy`) e backfill idempotente rodados no banco local (C7.1); suíte automatizada (306 testes) e build do web verdes (T032).
- [X] T032 Rodar os quality gates completos: `pnpm test`, build + typecheck de apps/web, e conferência de que nenhum teste novo depende de rede/banco real (padrões fixtures/fake-prisma)
- [X] T033 [P] Atualizar documentação de usuário afetada (telas do pipeline em docs/README se descrevem as colunas antigas) e anotar em specs/005-deep-lead-analysis/plan.md qualquer desvio encontrado vs. design (insumo para `$speckit-converge`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — imediato
- **Foundational (Phase 2)**: depende do Setup — **BLOQUEIA todas as stories** (schema migrado + stub de LLM)
- **US1 (Phase 3)**: depende da Foundational — estrutura do pipeline
- **US2 (Phase 4)**: depende de US1 (os estágios `deep_analysis`/gatilhos de entrada já existem); núcleo de valor da feature
- **US3 (Phase 5)**: depende de US2 (o endpoint `GET /deep-analysis` define o payload consumido)
- **US4 (Phase 6)**: depende de US1 (colunas) e de US2 (`analysisStatus`/verdict no payload e `rerun`)
- **Polish (Phase 7)**: depende de todas as stories desejadas estarem completas

### User Story Dependencies

- **US1**: Foundational → US1 (sem dependências de outras stories) — MVP estrutural
- **US2**: Foundational → US1 → US2 (usa `statusAfterEnrichment`, estágio novo e transições de US1)
- **US3**: US2 → US3 (consome contrato de US2; pode ser desenvolvida em paralelo a US4)
- **US4**: US1 + US2 → US4 (pode ser desenvolvida em paralelo a US3)

### Within Each User Story

- Testes ANTES da implementação (constituição III) — ver falhar primeiro
- Módulo puro antes de integração (`pipeline-transitions.js` → server-prod; `deep-analysis.js` → gatilhos/endpoints)
- Backend antes de frontend dentro da mesma story
- Story completa antes da próxima prioridade (ou em paralelo com outra story, se houver capacidade)

### Parallel Opportunities

- T001–T002 (Setup) e T005 (Foundational) em paralelo entre si
- T010 (teste do backfill) paralelo a T007–T009
- T014–T015 (testes de US2) em paralelo entre si
- Após US2: **US3 e US4 em paralelo** (arquivos web distintos)
- T030 e T033 em paralelo na Polish

---

## Parallel Example: User Story 2

```bash
# Testes primeiro, em paralelo:
Task: "Criar test/deep-analysis.test.js (módulo puro)"
Task: "Criar test/deep-analysis-pipeline.test.js (orquestração com fakes)"

# Implementação após testes falhando:
Task: "Criar deep-analysis.js (prompt, validação, fila, reconciliação)"
# → depois, em ordem: métricas (T017) → gatilhos (T018) → veredito (T019) → endpoints (T020–T021) → masking (T022)
```

## Implementation Strategy

### MVP First (US1 apenas)

1. Concluir Setup + Foundational (schema migrado)
2. Concluir US1 → **STOP and VALIDATE**: kanban de 5 colunas, entrada direta em Em Qualificação, premium pousa em Análise profunda (parado), backfill idempotente
3. Deploy/demo se pronto — o pipeline novo já está no ar sem IA (cards de análise aguardam US2)

### Incremental Delivery

1. Setup + Foundational → fundação pronta
2. US1 → validar → (MVP estrutural)
3. US2 → validar → **MVP de valor** (veredito automático ponta a ponta com stub/metrics)
4. US3 e US4 em paralelo → validar cada uma independentemente
5. Polish → quickstart C1–C7 → gates

### Parallel Team Strategy

1. Time conclui Setup + Foundational juntos
2. Dev A: US1 → US2 (caminho crítico backend)
3. Dev B (após US2 do contrato definido): US3 (detalhes) · Dev C: US4 (kanban)
4. Polish em conjunto

---

## Notes

- [P] tasks = arquivos diferentes, sem dependências
- [Story] label mapeia a task para a user story (rastreabilidade com spec.md)
- Testes falham antes da implementação correspondente (constituição III)
- Commit após cada task ou grupo lógico — conventional commits em PT-BR (ex.: `feat(pipeline): ...`, `feat(deep-analysis): ...`)
- Parar em qualquer checkpoint para validar a story independentemente
- Evitar: tasks vagas, conflito de mesmo arquivo entre tasks paralelas, dependência entre stories que quebre independência

---

## Phase 8: Convergence

**Purpose**: Lacunas encontradas pelo $speckit-converge (2026-09-18) — código implementado vs. spec/plan

- [X] T034 Impedir que `recalcLeadScore` (opportunity-score.js:392) sobrescreva o `opportunityScore` quando o lead tem análise profunda vigente (`verdict` preenchido): preservar o score da IA (FR-008) e continuar gravando `score_breakdown` em `enrichmentSummary`; cobrir com teste em test/deep-analysis-pipeline.test.js per FR-008 (contradicts)
- [X] T035 Gravar `status: 'prospect'` na importação CSV mesmo para linhas SEM CNPJ (server-prod.js ~1997), mantendo `enrichmentStatus: 'unavailable'`; atualizar teste de import existente se houver per FR-002 (missing)
- [X] T036 Gravar `status: 'prospect'` em `importDiscoveredCompanyForOrg` (server-prod.js ~3072) independentemente do status da empresa descoberta, mantendo o restante do fluxo per FR-002 (missing)
- [X] T037 Adicionar polling leve em apps/web/src/components/views/PipelineKanbanView.tsx enquanto existir card em `deep_analysis` com `analysisStatus` `running`/`not_started` (a cada ~8s chamar `onRefresh`; parar quando não houver), espelhando o padrão do useLeadDetail per US4/AC2 (partial)
- [X] T038 Estender `POST /api/system/reconcile-pending` (server-prod.js ~2578) para também disparar `deepAnalysis.getSharedRunner(prisma).reconcile({ limit })` e reportar o total no mesmo formato de resposta per FR-015/R6 (partial)
- [X] T039 Renomear a banda legada `'lead'` de `QualificationResult.level` (server-prod.js ~2465 e apps/web/src/types/index.ts:268) para `'initial'`, mantendo `'lead'` aceito na leitura por compatibilidade per FR-001 (partial)
- [X] T040 Usar o mapa `STATUS_LABEL` no badge de status do header de apps/web/src/components/lead/LeadDetailScreen.tsx (hoje `prospect.status.toUpperCase()` exibe "DEEP_ANALYSIS") per FR-001 (partial)
