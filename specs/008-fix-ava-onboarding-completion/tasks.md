---
description: "Task list for 008-fix-ava-onboarding-completion"
---

# Tasks: Conclusão do Onboarding com a Ava — Fim do Travamento

**Input**: Design documents from `/specs/008-fix-ava-onboarding-completion/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/frontend-service.md, quickstart.md

**Tests**: Incluídos e OBRIGATÓRIOS — constituição III (testes como porta de entrada, não-negociável): cada story começa por testes que FALHAM no código atual.

**Organization**: Tasks agrupadas por user story (US1/US2 = P1, US3 = P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: Story dona da task (US1, US2, US3)
- Paths exatos em todas as descrições

## Path Conventions

Web app existente: `apps/web/src/` (vitest, ambiente node) + módulo de rota na raiz (`ava-extract.js`). Sem backend novo, sem schema.

---

## Phase 1: Setup (Baseline)

**Purpose**: Confirmar que a suíte existente está verde antes de qualquer mudança.

- [x] T001 Rodar baseline dos testes web existentes (`pnpm --dir apps/web test`) e registrar resultado — todos os testes da 004 (`onboarding.test.ts`, `onboarding.assets.test.ts`, `onboarding.complete.test.ts`, `onboarding.revise.test.ts`, `avaScript.test.ts`) devem passar sem alterações

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos e helpers puros usados por todas as stories.

**⚠️ CRITICAL**: Nenhuma story começa antes deste fase completar.

- [x] T002 [P] Estender tipo `ExtractionOutcome` com motivo `'TIMEOUT'` em apps/web/src/types/onboarding.ts (delta do data-model.md §1)
- [x] T003 [P] Escrever testes FALHANDO para o helper puro `insertBeforePendingInteraction` em apps/web/src/lib/avaScript.test.ts (invariante I1 do data-model.md: insere antes da última mensagem com `questionId` ou `kind 'summary'`; anexa no fim sem interação pendente; imutável — não muta array/entradas de origem)
- [x] T004 Implementar `insertBeforePendingInteraction(messages, message): ChatMessage[]` em apps/web/src/lib/avaScript.ts (export puro, imutável; faz T003 passar)

**Checkpoint**: Tipos e invariante de ordem prontos — stories podem começar.

---

## Phase 3: User Story 1 — A conversa sempre chega ao fim (Priority: P1) 🎯 MVP

**Goal**: Resultado tardio da extração nunca esconde a pergunta pendente; as 12 perguntas respondidas/puladas sempre alcançam resumo → confirmação → dashboard (FR-001/FR-002/FR-007/FR-008 da spec).

**Independent Test**: cenário 1 do quickstart.md — site na pergunta 10, extração resolve tarde (após perguntas 11/12), pergunta pendente permanece acionável e o resumo aparece.

### Tests for User Story 1 ⚠️ (constituição III — escrever PRIMEIRO, falhar antes)

- [x] T005 [P] [US1] Escrever teste de regressão FALHANDO do relato (quickstart Cenário 1) em apps/web/src/services/onboarding.completion.test.ts: extração fake controlável que resolve APÓS as respostas das perguntas 11 e 12; afirmar (a) mensagem "Pronto, absorvi tudo…" inserida ANTES da última interação pendente, (b) `stepIndex === 12`, (c) `complete()` devolve `OnboardingResult` com `businessContext`; incluir variante materiais: anexos na pergunta 11 mantêm o prompt de materiais como última interação ("Pronto, seguir 📎" alcançável)

### Implementation for User Story 1

- [x] T006 [US1] Aplicar `insertBeforePendingInteraction` na inserção das 4 mensagens de resultado em `extractBusinessContext` (sucesso com produtos, sucesso sem conteúdo aproveitável, falha de conexão — e o futuro aviso de timeout) em apps/web/src/services/onboarding.ts (faz T005 passar)
- [x] T007 [P] [US1] Escrever testes FALHANDO para o helper puro de gate da UI em apps/web/src/lib/avaScript.test.ts: `pendingInteractionMessage(messages, currentQuestionId)` retorna a última mensagem com `questionId === currentQuestionId` (mesmo com mensagens de status depois dela) ou `null`
- [x] T008 Implementar `pendingInteractionMessage` em apps/web/src/lib/avaScript.ts (faz T007 passar)
- [x] T009 [US1] Trocar o gate de interação em apps/web/src/state/useAvaOnboarding.ts: expor `pendingPrompt` (mensagem de interação pendente via helper T008) + `inputReady` (pendente revelada — `visibleCount` > índice dela — e sem `typing`/`extracting`); remover a derivação `activeMessage`/`activeIsCurrent` baseada em "última mensagem"; preservar pacing (jitter 800–1600 ms), reações injetadas e `otherMode`
- [x] T010 [US1] Consumir o novo gate em apps/web/src/components/onboarding/ava/AvaOnboarding.tsx: `chipsActive`/`inputActive` derivam de `pendingPrompt`+`inputReady` (chips usam options/multi da mensagem pendente); condições do rodapé (`!typing && !extracting`) e botão "Corrigir resposta anterior" (`!isSummaryPhase`) inalterados

**Checkpoint**: Cenário do relato conclui até o resumo; suíte web verde; US1 funciona de forma independente.

---

## Phase 4: User Story 2 — A leitura de ativos nunca trava a conversa (Priority: P1)

**Goal**: Teto de espera de 60 s, descarte de resultado tardio (época), confirmação do resumo só após o settle, eventos observáveis (FR-003/FR-004/FR-005/FR-006/FR-010 da spec).

**Independent Test**: cenários 2 e 3 do quickstart.md — extração lenta estoura o teto e a conversa segue; `complete()` é `null` durante o voo e libera após o settle.

### Tests for User Story 2 ⚠️ (constituição III)

- [x] T011 [P] [US2] Escrever testes FALHANDO em apps/web/src/services/onboarding.completion.test.ts (fake timers): (a) teto — `extract` fake que resolve após `extractionTimeoutMs` injetado baixo (ex.: 50 ms) retorna `{ ok: false, reason: 'TIMEOUT' }`, ativos ficam `status 'failed'` com `warning 'EXTRACTION_TIMEOUT'`, aviso conversacional inserido antes da interação pendente e a conversa segue até resumo; (b) descarte — resolução do fetch APÓS o timeout não muta estado nem anexa mensagem; (c) época — extração mais recente supera a anterior (resultado da antiga descartado); (d) settle — `complete()` retorna `null` durante extração em voo e o resultado após settle (inclusive após `TIMEOUT`)

### Implementation for User Story 2

- [x] T012 [US2] Implementar teto + época + guarda em apps/web/src/services/onboarding.ts: `deps.extractionTimeoutMs` (default 60000), `Promise.race` com timer no `extractBusinessContext`, contador `extractionEpoch` com descarte silencioso de corridas vencidas, `complete()` retorna `null` enquanto corrida vigente em voo (contrato v1.1)
- [x] T013 [US2] Emitir eventos estruturados (FR-010) em apps/web/src/services/onboarding.ts: `console.info('[ava-onboarding]', { event })` para `extraction_timeout`, `late_result_discarded` e `extraction_settled` (com `{ reason }`) — sem nenhum dado de cliente (constituição V/VII)
- [x] T014 [US2] Habilitar confirmação pós-settle na UI: prop `confirmDisabled?: boolean` em apps/web/src/components/onboarding/ava/AvaSummary.tsx (desabilita "Tudo certo — concluir ✨", mantém ajuste por item ativo) e wiring `confirmDisabled={ctrl.extracting}` em apps/web/src/components/onboarding/ava/AvaOnboarding.tsx

**Checkpoint**: Teto, descarte e settle verdes; US1+US2 funcionam juntas.

---

## Phase 5: User Story 3 — "Corrigir resposta anterior" nunca é beco sem saída (Priority: P2)

**Goal**: Após `revise` em qualquer ponto (inclusive o fim), a conversa é concluível; sem replay visual do transcript (FR-007/FR-008; assumption da spec mantém semântica de descarte da 004).

**Independent Test**: cenário 5 do quickstart.md — `revise('empresa')` numa conversa avançada, responder até o resumo e `complete()` com sucesso; histórico não re-revela do zero.

### Tests for User Story 3 ⚠️ (constituição III)

- [x] T015 [P] [US3] Estender apps/web/src/services/onboarding.revise.test.ts: conversa até a pergunta 12 → `revise` de pergunta anterior (ex.: 'empresa') → responder a partir dela até o resumo → `complete()` devolve resultado; respostas/ativos das perguntas posteriores descartados (semântica 004 mantida)

### Implementation for User Story 3

- [x] T016 [US3] Remover o replay em apps/web/src/state/useAvaOnboarding.ts: `revise` deixa de fazer `setVisibleCount(0)` e posiciona `visibleCount` no índice do prompt re-anexado (histórico permanece; apenas o novo prompt entra com "···"); limpeza de reações injetadas com âncora removida permanece

**Checkpoint**: Correção retroativa concluível e sem replay — todas as stories funcionam.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observabilidade do servidor e gates de qualidade finais.

- [x] T017 [P] Adicionar log estruturado de duração/resultado em ava-extract.js (1 linha via `logger` já injetável — `{ event: 'ava_extract', outcome, durationMs, warnings: n }`, sem conteúdo de cliente; FR-010/constituição VII)
- [x] T018 Rodar gates completos: `pnpm --dir apps/web test` (suíte toda verde, incluindo testes da 004 sem edição — se algum teste de onboarding.assets.test.ts assumir a ordem bugada das mensagens, atualizá-lo citando a invariante I1), `pnpm --dir apps/web build` (tsc strict), `pnpm test` (raiz, node --test)
- [x] T019 Validar quickstart.md cenários 1–5 ponta a ponta contra a implementação final e marcar tasks concluídas

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: imediato — baseline verde obrigatório
- **Foundational (T002–T004)**: bloqueia todas as stories (tipos + invariante I1)
- **US1 (T005–T010)**: depende da Foundational; 🎯 MVP — sozinha já corrige o relato
- **US2 (T011–T014)**: depende da Foundational; toca os mesmos arquivos de serviço da US1 — executar após US1
- **US3 (T015–T016)**: depende da US1 (gate novo no hook); executar após US2
- **Polish (T017–T019)**: após todas as stories

### Within Each Story

- Testes FALHAM antes da implementação (constituição III)
- Helper puro → serviço → hook → componente
- Story completa antes da próxima prioridade

### Parallel Opportunities

- T002 ∥ T003 (arquivos diferentes)
- T005 ∥ T007 (arquivos de teste diferentes)
- T011 ∥ T015 (arquivos de teste diferentes)
- T017 independente das stories (arquivo de rota)

---

## Implementation Strategy

### MVP First (US1)

1. T001–T004 (fundação) → T005–T010 (US1)
2. **Parar e validar**: regressão do relato verde → o bug reportado já está corrigido
3. Deploy possível aqui, se necessário

### Incremental Delivery (recomendado para produção)

1. Fundação → US1 (corrige o travamento) → US2 (blindagem de timing/teto) → US3 (correção retroativa sem replay) → Polish
2. Cada story adiciona garantia sem quebrar a anterior; suíte da 004 intocada deve permanecer verde

### Notes

- [P] = arquivos diferentes, sem dependência pendente
- Nenhuma dependência nova; nenhum contrato HTTP alterado; roteiro/textos da Ava intocados (exceto 1 aviso de timeout na voz da Ava)
- Commit por grupo lógico (conventional, PT-BR)
