---
description: "Task list for 009-onboarding-profile-sync"
---

# Tasks: Onboarding Salvo na Conta + Região de Interesse

**Input**: Design documents from `/specs/009-onboarding-profile-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBRIGATÓRIOS (constituição III) — testes primeiro, falhando.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1 (persistência), US2 (região), US3 (sidebar derivada)

---

## Phase 1: Setup (Baseline)

- [x] T001 Rodar baseline (`pnpm --dir apps/web test` e `pnpm test`) — suítes verdes antes de qualquer mudança

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Nenhuma story começa antes deste fase.

- [x] T002 Adicionar `crmName String?` e `onboardingAnswers Json?` ao model `CommercialSettings` em prisma/schema.prisma e gerar a migração pelo caminho oficial (Prisma migrate, `pnpm run db:migrate` — nunca db push); se não houver DB local, criar a migração SQL manualmente no diretório de migrations seguindo a convenção existente
- [x] T003 [P] Tipos web: `QuestionId` ganha `'regioesInteresse'` e `AvaQuestion`/`ChatMessage` ganham `exclusiveValue?: string` em apps/web/src/types/onboarding.ts; `CommercialProfile` ganha `crmName: string | null` e `onboardingAnswers: unknown | null` em apps/web/src/types/index.ts
- [x] T004 [P] [US2] Escrever testes FALHANDO do roteiro em apps/web/src/lib/avaScript.test.ts: `AVA_QUESTIONS` tem 13 questões; `regioesInteresse` é a 9ª (após mercadoAlvo, antes de email), `multi-chips`, não obrigatória, `allowOther`, `exclusiveValue 'todo-brasil'`, opções Norte/Nordeste/Centro-Oeste/Sudeste/Sul + Todo o Brasil; `SUMMARY_LABELS` com 'Regiões de interesse'; ordem numérica 1–13 consistente
- [x] T005 Implementar a pergunta `regioesInteresse` e renumerar `order` (1–13) em apps/web/src/lib/avaScript.ts (faz T004 passar)

**Checkpoint**: Schema + tipos + roteiro novos prontos.

---

## Phase 3: User Story 1 — O que foi conversado nasce na conta (Priority: P1) 🎯 MVP

**Goal**: Confirmar o resumo salva as respostas na conta (perfil comercial + registro completo), sem perder campos que a conversa não cobre.

**Independent Test**: quickstart Cenários 1–2 — mapeamento, merge preservando `current`, bordas (CRM none, B2C, contexto ausente, todo-brasil, idempotência).

### Tests for User Story 1 ⚠️

- [x] T006 [P] [US1] Escrever testes FALHANDO de `buildCommercialProfilePayload` em apps/web/src/services/onboarding.profile.test.ts: tabela de mapeamento completa (research D2), merge preserva `targetCnaes`/`averageTicket` e demais campos não cobertos, `onboardingCompleted: true`, `onboardingAnswers` com 13 perguntas incluindo puladas, bordas (CRM `__none__`→null; mercado só B2C→herda targetSizes; `businessContext` null→herda contexto; `todo-brasil`→`['Todo o Brasil']`; idempotência I3)

### Implementation for User Story 1

- [x] T007 Implementar `buildCommercialProfilePayload(result, current)` (pura, exportada) em apps/web/src/services/onboarding.ts (faz T006 passar)
- [x] T008 [P] [US1] Servidor: aceitar/normalizar `crmName` e `onboardingAnswers` em `normalizeCommercialProfilePayload` e expô-los em `emptyCommercialProfile`/`formatCommercialProfile` em server-prod.js (idempotente ao payload atual); estender teste raiz se o módulo for exportável, senão cobrir via gates
- [x] T009 [US1] [US3] App: `onComplete` async em apps/web/src/App.tsx — `buildCommercialProfilePayload(result, commercialProfile)` → `saveCommercialProfile` → `setCommercialProfile(saved)` → `setOnboardingResult(result)` (dashboard só após sucesso); sidebar deriva CRM do perfil salvo (`crmName` → badge verde; `companyName` do perfil como fonte primária)
- [x] T010 [US1] Retry conversacional em apps/web/src/components/onboarding/ava/AvaOnboarding.tsx — `handleConfirm` async com estado "salvando" (botão do resumo "Salvando…" desabilitado) e, em erro, bolha da Ava com aviso + botão volta a "Tudo certo — concluir ✨" para tentar de novo, sem descartar respostas

**Checkpoint**: Concluir a conversa persiste tudo; recarregar mantém conta configurada.

---

## Phase 4: User Story 2 — Região de interesse na conversa (Priority: P1)

**Goal**: A 9ª pergunta captura a região com exclusividade do "Todo o Brasil" e flui pelo serviço/resumo.

### Tests for User Story 2 ⚠️

- [x] T011 [P] [US2] Estender apps/web/src/services/onboarding.test.ts: fluxo responde mercadoAlvo → pergunta corrente é `regioesInteresse`; responder com múltiplas regiões avança para `email`; pular funciona; mensagem de chips carrega `exclusiveValue`; resumo (kind summary) alcançado após 13 respostas

### Implementation for User Story 2

- [x] T012 [US2] Opção exclusiva na UI em apps/web/src/components/onboarding/ava/ChipsRow.tsx — em multi, selecionar a opção `exclusiveValue` limpa as demais (e vice-versa); mensagem carrega `exclusiveValue` via `questionMessage` em apps/web/src/services/onboarding.ts

**Checkpoint**: Região pergunta, entra no resumo e é salva nas localizações-alvo.

---

## Phase 5: User Story 3 — Conta configurada permanece entre sessões (Priority: P2)

- [x] T013 [US3] Cobertura de teste: em apps/web/src/services/onboarding.profile.test.ts (ou revisar cobrir em T006) afirmar que o payload seta `onboardingCompleted: true` e que `crmName` alimentará o badge; validação manual do gate (reload não re-exibe) registrada no quickstart Cenário 4

*(A implementação de US3 é feita por T008/T009 — esta task garante a cobertura explícita.)*

---

## Phase 6: Polish & Cross-Cutting

- [x] T014 [P] Revisar documentação viva se tocada (sem mudanças esperadas)
- [x] T015 Gates completos: `pnpm --dir apps/web test`, `pnpm --dir apps/web build`, `pnpm test`; atualizar testes que assumem 12 perguntas (ordem do roteiro é supersedida pela 009, documentada na spec)
- [x] T016 Validar quickstart.md Cenários 1–4 e marcar tasks concluídas

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T005) → US1 (T006–T010) → US2 (T011–T012) → US3 (T013) → Polish (T014–T016)
- T002 (migração) antes de T008 (servidor lê campos novos); T003 antes de T005/T006
- T006 ∥ T011 (arquivos de teste diferentes)
- T009 depende de T007; T010 independente de T009 (contrato async)

## Parallel Opportunities

- T002 ∥ T003 ∥ T004 (arquivos diferentes)
- T006 ∥ T011; T008 ∥ T009 (servidor vs App)

## Implementation Strategy

MVP = US1 (nada mais se perde). US2 fecha a captura de região. US3 consolida a sessão. Deploy após Polish com todos os gates verdes.
