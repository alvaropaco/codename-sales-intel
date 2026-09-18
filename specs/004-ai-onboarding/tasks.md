# Tasks: Onboarding Conversacional com IA (Ava)

**Input**: Design documents from `/specs/004-ai-onboarding/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: **Obrigatórios** — Constituição III (não-negociável): em cada user story, os testes vêm ANTES da implementação e devem falhar primeiro. Raiz: `node --test` com DI/fakes; web: `vitest` (módulos puros, ambiente node).

**Organization**: Tasks agrupadas por user story (US1 → US2 → US3 → US5 → US4, ordem de prioridade da spec: P1, P2, P2, P2, P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US5)
- Include exact file paths in descriptions

## Path Conventions

Monorepo existente (ver plan.md): backend em módulos planos na **raiz** (`ava-extract.js`, rota em `server-prod.js`, testes em `test/`); frontend em **apps/web/src/** (feature folder `components/onboarding/ava/`, `lib/`, `services/`, `state/`, `types/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências novas (justificadas em research.md D3/D5) e configuração de teste do web.

- [x] T001 Adicionar dependências — raiz `package.json`: `multer`, `pdf-parse`, `jszip`; `apps/web/package.json`: `vitest` (dev) + script `"test": "vitest run"` + `apps/web/vitest.config.ts` (environment node, include `src/**/*.test.ts`, aliases `@/*` iguais ao tsconfig). Rodar `pnpm install` e conferir que `pnpm test` (raiz) e `cd apps/web && pnpm test` executam sem erros (com 0 testes no web por enquanto).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos compartilhados e o roteiro das 12 perguntas — todo user story depende disso.

**⚠️ CRITICAL**: Nenhum user story começa antes desta fase.

- [x] T002 [P] Criar tipos do onboarding em `apps/web/src/types/onboarding.ts` conforme `specs/004-ai-onboarding/data-model.md`: `QuestionId` (union com os 12 passos na ordem: `nome, empresa, cargo, setor, tamanhoTime, objetivo, crm, mercadoAlvo, email, siteInstitucional, materiais, catalogo`), `Answer` (`value: string | string[]`, `via: 'chip' | 'text' | 'prefilled' | 'skipped'`, `answeredAt`), `ChatMessage` (`from`, `kind: 'text'|'chips'|'input'|'attachments'|'summary'`, `options`, `typingForMs`), `BusinessAsset` (`type: 'site'|'document'|'catalog'`, `status: 'pending'|'extracting'|'extracted'|'failed'|'unsupported'`), `BusinessContext` (`products: {name, description}[]`, `valueProposition`, `businessModel`, `differentiators: string[]`, `targetMarket`, `sources`, `warnings`), `OnboardingState`, `OnboardingResult` (`companyName`, `userEmail`, `crm: {name: string|null, connected: boolean}`, `businessContext`, `answers`).
- [x] T003 [P] Escrever testes do roteiro (FALHAM primeiro) em `apps/web/src/lib/avaScript.test.ts`: o roteiro tem **exatamente 12 perguntas na ordem do FR-003** (1–9 configuração; 10 site institucional, 11 materiais, 12 catálogo); apenas `mercadoAlvo` é multi-select (FR-005); obrigatórias são só `nome`, `empresa`, `email` (FR-010/FR-011); validadores rejeitam nome/empresa vazios, e-mail sem `@`/domínio, URL sem `http(s)`; toda pergunta de chips tem opção "Outro" (FR-006); mensagem de apresentação da Ava existe e cita "Ava" (FR-002).
- [x] T004 Implementar o roteiro em `apps/web/src/lib/avaScript.ts` (dado puro, sem React): array das 12 perguntas — texto do prompt em PT-BR, tipo (`text` | `chips` | `multi-chips` | `url` | `attachments` | `yesno`), opções de chips (D10 do research.md: cargo, setor, tamanho do time, objetivo, CRM com "Ainda não uso", mercado-alvo multi, catálogo "Tenho catálogo online"/"Ainda não tenho"), `required`, `validate(value)` por pergunta, mensagens de apresentação/despedida e templates de correção conversacional (FR-010). **Teste T003 verde.**

**Checkpoint**: Fundação pronta — tipos e roteiro estáveis; user stories podem começar.

---

## Phase 3: User Story 1 — Primeiro acesso cai direto na conversa com a Ava (Priority: P1) 🎯 MVP

**Goal**: Sem formulário: chat fullscreen conduz as 12 perguntas na ordem, uma por vez, com campo de texto simples; gate no App substitui o OnboardingModal.

**Independent Test**: conta sem onboarding concluído → login → conversa até a 12ª pergunta sem ver formulário (`specs/004-ai-onboarding/quickstart.md` cenário 1, passos 1–3 com input básico).

### Tests for User Story 1 (constituição III — escrever primeiro, ver falhar)

- [x] T005 [P] [US1] Escrever testes do serviço em `apps/web/src/services/onboarding.test.ts` (storage fake injetado): sessão nova começa na pergunta `nome` com a apresentação da Ava como primeira mensagem; `answer` registra `{value, via}` e avança **na ordem do roteiro**; `skip` em obrigatória é rejeitado e nas demais marca `via: 'skipped'` e avança; resposta inválida (e-mail malformado) retorna `{ok:false, reason}` e **não** avança (FR-010); `reset()` volta ao estado inicial; serviço não faz I/O além do storage de conclusão (contrato `specs/004-ai-onboarding/contracts/frontend-service.md` invariantes 1–2).

### Implementation for User Story 1

- [x] T006 [US1] Implementar `apps/web/src/services/onboarding.ts` — `createOnboardingService({ storage, initialState })`: `getState`, `answer`, `skip`, `reset` (complete/revise/ativos ficam para US2/US3/US5); validação via `avaScript.ts`; mensagens da conversa montadas a partir do roteiro; preenchimento inicial via `initialState` (dados conhecidos da conta). **Teste T005 verde.**
- [x] T007 [US1] Criar `apps/web/src/state/useAvaOnboarding.ts`: mantém `OnboardingState` em `useState`, expõe `{state, answer, skip, reset}` e controla a revelação sequencial de mensagens (uma pergunta por vez — FR-003).
- [x] T008 [US1] Criar `apps/web/src/components/onboarding/ava/ChatBubble.tsx` (bolha Ava/usuária, estilo Tailwind dark/light do repo) e `apps/web/src/components/onboarding/ava/AvaOnboarding.tsx` (tela fullscreen, auto-scroll, header com avatar/nome "Ava", render de `kind`, input de texto que envia com Enter — versão básica, refinada em US2).
- [x] T009 [US1] Gate em `apps/web/src/App.tsx`: quando autenticado e (`!commercialProfile?.onboardingCompleted` || gate atual de `profileIncomplete`) e sem conclusão nesta sessão → renderizar `<AvaOnboarding>` no lugar de qualquer outra view; carregar `initialState` com `session.email` e `commercialProfile.companyName` quando existirem (base para pre-fill da US2); guardar `OnboardingResult` via prop `onComplete` (no-op por enquanto, usado em US3/US4).
- [x] T010 [US1] Remover o OnboardingModal do fluxo: apagar render e handlers órfãos em `apps/web/src/App.tsx` (`handleOnboardingStepChange`, `isSavingProfile` se sem uso) e deletar `apps/web/src/components/onboarding/OnboardingModal.tsx` (FR-020; `CommercialProfileForm` em Settings **permanece**).

**Checkpoint**: MVP — um usuário novo faz login e percorre a conversa completa (input de texto), sem formulário. Validar com cenário 1 do quickstart (input básico).

---

## Phase 4: User Story 2 — Responder sem digitar: chips, texto natural e "···" (Priority: P2)

**Goal**: Chips nas 6 perguntas de escolha (+ catálogo), multi no mercado-alvo, "Outro" com texto livre, Enter para enviar, pré-preenchimento de e-mail/empresa, indicador "···" e reações variadas da Ava, pular não-obrigatórias, corrigir resposta anterior.

**Independent Test**: percorrer o onboarding clicando chips e confirmando pre-fills, observando "···" entre mensagens (quickstart cenário 1, passos 4–8).

### Tests for User Story 2 (constituição III — escrever primeiro, ver falhar)

- [x] T011 [P] [US2] Escrever testes em `apps/web/src/lib/avaReactions.test.ts`: reação nunca repete o mesmo template duas vezes seguidas; templates interpolam dado da resposta (ex.: primeiro nome); toda pergunta tem ≥ 2 reações possíveis.
- [x] T012 [US2] Escrever testes de `revise` em `apps/web/src/services/onboarding.test.ts`: `revise(questionId)` volta à pergunta indicada, descarta respostas/mensagens posteriores e mantém as anteriores (FR-012/FR-014); `answer(via: 'prefilled')` marca via correta e avança (FR-008).

### Implementation for User Story 2

- [x] T013 [P] [US2] Implementar `apps/web/src/lib/avaReactions.ts` (templates variados PT-BR com interpolação). **Teste T011 verde.**
- [x] T014 [US2] Implementar `revise()` e `via: 'prefilled'` em `apps/web/src/services/onboarding.ts`. **Teste T012 verde.**
- [x] T015 [P] [US2] Criar `apps/web/src/components/onboarding/ava/TypingIndicator.tsx`: três pontos animados (framer-motion), exibido por intervalo aleatório 800–1600 ms entre mensagens (D8; FR-009/SC-005).
- [x] T016 [P] [US2] Criar `apps/web/src/components/onboarding/ava/ChipsRow.tsx`: chips clicáveis com seleção destacada; modo multi (mercado-alvo, FR-005) com confirmação; opção "Outro" abre texto livre (FR-006); botão "Prefiro não responder" nas perguntas puláveis (FR-011).
- [x] T017 [US2] Criar `apps/web/src/components/onboarding/ava/AvaComposer.tsx`: campo de texto natural com **Enter envia** (FR-007), placeholder contextual por pergunta, estado de disabled durante "···".
- [x] T018 [US2] Integrar no `apps/web/src/components/onboarding/ava/AvaOnboarding.tsx`: perguntas de chips renderizam `ChipsRow`, abertas usam `AvaComposer`, pre-fill de e-mail/empresa aparece como sugestão confirmável com um toque (`via: 'prefilled'`, FR-008), reação da Ava entre respostas com "···" (T013), ação "corrigir resposta anterior" chama `revise()` (FR-012).

**Checkpoint**: US1 + US2 — conversa completa com zero digitação nas perguntas de chips, pré-preenchimento e pacing de IA real.

---

## Phase 5: User Story 3 — Resumo completo e transição automática (Priority: P2)

**Goal**: Resumo das 12 informações (puladas marcadas), ajustar item refazendo só aquela pergunta, confirmação → despedida → dashboard automático.

**Independent Test**: concluir a conversa, conferir o resumo, ajustar um item, confirmar e chegar ao dashboard sem clique (quickstart cenário 1, passos 12 + critério SC-004).

### Tests for User Story 3 (constituição III — escrever primeiro, ver falhar)

- [x] T019 [US3] Escrever testes de `complete` em `apps/web/src/services/onboarding.test.ts`: `complete()` sem as 3 obrigatórias falha; com elas retorna `OnboardingResult` correto (`crm.connected: false` quando "Ainda não uso" ou pulado; `userEmail` do pre-fill quando resposta pulada... obrigatória, então sempre preenchida), gravando `sessionStorage.b2base.avaOnboardingDone = '1'` no storage fake (FR-019); perguntas não respondidas ficam `via: 'skipped'` no resultado.

### Implementation for User Story 3

- [x] T020 [US3] Implementar `complete()` em `apps/web/src/services/onboarding.ts` (monta `OnboardingResult`, persiste flag no storage injetável). **Teste T019 verde.**
- [x] T021 [P] [US3] Criar `apps/web/src/components/onboarding/ava/AvaSummary.tsx`: mensagem `kind: 'summary'` com as 12 informações (puladas como "não informado"), botão ajustar por item que chama `revise(questionId)` (FR-013/FR-014) e botão confirmar.
- [x] T022 [US3] Conectar o fim no `apps/web/src/components/onboarding/ava/AvaOnboarding.tsx` + `apps/web/src/App.tsx`: após confirmar o resumo, mensagem de despedida da Ava e `onComplete(result)` → App sai da conversa e renderiza o dashboard automaticamente (FR-015/SC-004), guardando `OnboardingResult` no estado.

**Checkpoint**: US1–US3 — onboarding ponta a ponta até o dashboard (sidebar ainda estática — é a US4).

---

## Phase 6: User Story 5 — Ava enriquece o contexto de negócio com os ativos (Priority: P2)

**Goal**: Perguntas 10–12 (site institucional, materiais anexados, catálogo online) e extração IA **na conversa**: backend stateless extrai produtos/proposta/diferenciais, Ava confirma o que absorveu, contexto fica no estado (pronto para outreach).

**Independent Test**: informar site + anexar PDF textual durante a conversa → Ava confirma dados extraídos; sem gateway LLM → aviso e conversa segue (quickstart cenários 1 passos 9–11 e 4).

### Tests for User Story 5 (constituição III — escrever primeiro, ver falhar)

- [x] T023 [P] [US5] Escrever testes em `test/ava-extract.test.js` (estilo `test/qualification.test.js`, DI de `{fetchImpl, callLlm, logger, now}`): TXT e DOCX (fixture zipado com `jszip`) e PDF textual (fixture mínima) viram texto; HTML com `script`/`style` é limpo e entidades decodificadas; site inacessível/timeout → warning `SITE_UNREACHABLE` sem quebrar; PDF sem texto → `DOCUMENT_UNREADABLE`; PPT binário → `DOCUMENT_UNSUPPORTED_FORMAT`; LLM ok → `businessContext` com `{products, valueProposition, businessModel, differentiators, targetMarket, sources}`; LLM falha → `businessContext: null` + warning `LLM_UNAVAILABLE`; texto por fonte capado em ~12 mil chars; > 5 arquivos rejeitados; **idempotente** (mesma entrada → mesmo resultado); logs não contêm texto extraído (D9).
- [x] T024 [P] [US5] Escrever testes de ativos em `apps/web/src/services/onboarding.test.ts` (fetch injetável): `addUrlAsset('site'|'catalog', url)` valida `http(s)` (FR-021); `addFiles` aceita ≤ 5 arquivos × 20 MB com mimes PDF/DOCX/PPTX/TXT e devolve recusas com motivo (FR-022/FR-026); `extractBusinessContext()` chama o endpoint e incorpora `businessContext` + warnings no estado (contrato `specs/004-ai-onboarding/contracts/http-api.md`).

### Implementation for User Story 5

- [x] T025 [US5] Implementar `ava-extract.js` na raiz (módulo plano com DI): `fetchText` (timeout 10 s, User-Agent próprio, strip de `script/style/noscript`, entidades, colapso de whitespace), `pdf-parse` para PDF, `jszip` extraindo `<w:t>` (DOCX) e `<a:t>` (PPTX), TXT direto, cap de ~12 mil chars/fonte, prompt único com fontes rotuladas → `callLlm({jsonMode: true, model: premiumModel(), timeoutMs: 60000})` → `parseJsonLoose` → `businessContext` + `extractedFrom` + `warnings` (códigos estáveis do contrato). **Teste T023 verde.**
- [x] T026 [US5] Rota `POST /api/onboarding/ava/extract` em `server-prod.js`: `multer({storage: memoryStorage, limits: {files: 5, fileSize: 20MB, mime filter}})`; guard global `/api` já cobre auth; `requireRequestOrgId` para log; mapear erros → 400/413/500 do contrato; métricas prom-client (`b2base_ava_extract_duration_seconds`, `b2base_ava_extract_files_total{status}`, `b2base_ava_extract_llm_failures_total`); logs só metadados. **Integração verificada com request real no cenário 4 do quickstart.**
- [x] T027 [US5] Implementar ativos no `apps/web/src/services/onboarding.ts`: `addUrlAsset`, `addFiles`, `extractBusinessContext` (chamada ao endpoint via fetch injetável; múltiplos ativos num único POST). **Teste T024 verde.**
- [x] T028 [US5] Estender `apps/web/src/components/onboarding/ava/AvaComposer.tsx` com botão de anexo (aceite/recusa conversacional por arquivo, FR-022) e renderizar bolha `kind: 'attachments'` com confirmação da Ava por arquivo.
- [x] T029 [US5] Conectar perguntas 10–12 no `apps/web/src/components/onboarding/ava/AvaOnboarding.tsx`: site (URL validada), materiais (anexos + reenvio do POST), catálogo (chips sim/não → URL); durante a extração o "···" permanece com teto de 30 s e mensagem honesta de espera; ao concluir, Ava confirma o que absorveu a partir de `businessContext`/`warnings` (FR-024), e o resumo final passa a listar os ativos e o contexto extraído.

**Checkpoint**: US1–US3 + US5 — onboarding completo com enriquecimento de contexto; backend stateless testado e instrumentado.

---

## Phase 7: User Story 4 — A plataforma reflete a conta configurada (Priority: P3)

**Goal**: Sidebar mostra workspace com nome da empresa + e-mail e o CRM com badge verde no rodapé (ou estado neutro), a partir do `OnboardingResult`/dados da sessão.

**Independent Test**: concluir o onboarding e ver empresa + e-mail na sidebar e badge verde do CRM sem recarregar; CRM não informado → estado neutro (quickstart cenário 2).

### Tests for User Story 4 (constituição III — escrever primeiro, ver falhar)

- [x] T030 [P] [US4] Escrever teste em `apps/web/src/lib/crmBadge.test.ts` (helper puro): CRM informado → `{connected: true}`; "Ainda não uso"/pulado/ausente → `{connected: false, neutral: true}` (FR-017, US5 cenário 3 do quickstart).

### Implementation for User Story 4

- [x] T031 [US4] Implementar `apps/web/src/lib/crmBadge.ts` (helper puro `crmBadgeState(crm)`). **Teste T030 verde.**
- [x] T032 [US4] Atualizar `apps/web/src/components/layout/Sidebar.tsx`: novas props `companyName`, `userEmail`, `crmBadge`; substituir o bloco hardcoded ("Álvaro Paco"/"Organização") pelo workspace (nome da empresa + e-mail) e adicionar no rodapé o badge verde do CRM (com nome) ou estado neutro com hint "configurar CRM depois" (FR-016/FR-017).
- [x] T033 [US4] Repassar props em `apps/web/src/components/layout/Layout.tsx` e `apps/web/src/App.tsx`: `companyName` de `onboardingResult ?? commercialProfile.companyName ?? organization`, `userEmail` de `session.email`, `crmBadge` de `onboardingResult.crm` — atualização **sem recarregar** (SC-006).

**Checkpoint**: Todos os user stories independentemente funcionais; fluxo completo do quickstart verde.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Higiene, gates de qualidade e validação final.

- [x] T034 [P] Revisar copy PT-BR de todos os prompts/reações/resumo da Ava em `apps/web/src/lib/avaScript.ts` e `apps/web/src/lib/avaReactions.ts` (tom conversacional, sem jargão técnico; mensagens de erro nunca técnicas — FR-010).
- [x] T035 [P] Auditoria de privacidade/observabilidade: nenhum log com conteúdo de documentos/texto extraído em `ava-extract.js` e na rota (D9/constituição V); métricas presentes; materiais só em memória.
- [x] T036 Rodar os gates: `pnpm test` (raiz), `cd apps/web && pnpm test && pnpm build` (`tsc && vite build`) — tudo verde (constituição III).
- [ ] T037 Executar `specs/004-ai-onboarding/quickstart.md` cenários 1–4 na íntegra e conferir a tabela de critérios (SC-001 a SC-009); ajustar detalhes de timing do "···" se a cadência ficar mecânica (D8).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: imediato; bloqueia tudo (deps + vitest).
- **Foundational (Phase 2)**: depende do Setup; bloqueia todas as stories (tipos + roteiro).
- **US1 (Phase 3)**: depende da Foundational. Nenhuma dependência de outras stories.
- **US2 (Phase 4)**: depende de US1 (serviço/orquestrador existentes).
- **US3 (Phase 5)**: depende de US1+US2 (fluxo e `revise`).
- **US5 (Phase 6)**: testes/backend (T023–T026) podem rodar **em paralelo com US2/US3** (arquivos distintos); a integração no chat (T028–T029) depende de US2 (composer) e US3 (resumo lista ativos).
- **US4 (Phase 7)**: depende de US3 (`OnboardingResult`/`complete`) e US5 (`crm` no resultado pode vir de conversa sem CRM — na verdade só de US3; badge neutral cobre ausência).
- **Polish (Phase 8)**: depende de todas as stories desejadas.

### Within Each User Story

- Testes primeiro (constituição III) — ver falhar, depois implementar até verde.
- Serviço antes da UI; UI antes da integração no App.
- Checkpoint ao fim de cada story: validar independente (quickstart parcial).

### Parallel Opportunities

- **T002, T003** (Foundational) em paralelo entre si.
- **Fase 6**: T023 (testes backend) e T024 (testes frontend) em paralelo; todo o backend de US5 (T025–T026) roda em paralelo com o frontend das stories 2/3 por tocar arquivos distintos (`ava-extract.js`, `server-prod.js` vs `apps/web/src/**`).
- **T011/T015/T016** (US2) e **T021** (US3) são [P] por arquivos distintos.
- **T030** (US4) e os testes de T023/T024 podem disparar juntos em ambientes distintos (node raiz vs vitest web).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) + Phase 2 (Foundational)
2. Phase 3 (US1) → **STOP and VALIDATE**: login de conta nova percorre 12 perguntas sem formulário (cenário 1 do quickstart com input básico)
3. MVP demonstrável: onboarding conversacional substituindo o formulário

### Incremental Delivery

1. MVP (US1) → 2. +US2 (zero digitação, "···", pre-fill) → 3. +US3 (resumo + transição automática ao dashboard) → 4. +US5 (ativos + extração IA — o momento "mágico") → 5. +US4 (sidebar refletindo a conta) → 6. Polish/gates.

### Notes

- [P] = arquivos distintos, sem dependência pendente.
- Commits conventional em PT-BR por task ou grupo lógico (ex.: `feat(onboarding): serviço da conversa da ava`).
- Proibido logar conteúdo de materiais/textos extraídos (constituição V/D9).
- A persistência real em `Organization`/`CommercialSettings` é o passo seguinte, fora do escopo (mapeamento em `specs/004-ai-onboarding/data-model.md`).

## Phase 9: Convergence

**Purpose**: Gaps remanescentes encontrados pelo `$speckit-converge` (2026-09-18) — assess contra spec/plan/tasks pós-implementação.

- [x] T038 [US2] Adicionar ação "Corrigir resposta anterior" durante a conversa (FR-012, HIGH): helper puro `previousAnsweredQuestion(stepIndex, answers)` em `apps/web/src/lib/avaScript.ts` (retorna o `QuestionId` da última pergunta respondida antes da corrente, ou null) + teste em `apps/web/src/lib/avaScript.test.ts`; expor no `apps/web/src/state/useAvaOnboarding.ts`; renderizar botão discreto no footer de `apps/web/src/components/onboarding/ava/AvaOnboarding.tsx` (visível quando existir pergunta anterior respondida e a conversa não estiver digitando/extraindo) chamando `ctrl.revise(questionId)` (partial)
- [x] T039 [US1] Gate do primeiro acesso fail-closed (FR-001/US1-AC1, MEDIUM): em `apps/web/src/App.tsx`, trocar `!!commercialProfile && !commercialProfile.onboardingCompleted` por `commercialProfile?.onboardingCompleted !== true` — falha de carregamento do perfil (fetch error, `commercialProfile === null` após `isLoadingProfile`) NÃO deve pular o onboarding (partial)
- [x] T040 Confirmar nome de empresa genérico (Edge Cases, MEDIUM): em `apps/web/src/services/onboarding.ts`, ao responder `empresa` com nome normalizado na lista de genéricos (ex.: "minha empresa", "empresa", "empresa teste", "teste"), a Ava faz a pergunta de confirmação ("a empresa é 'X' mesmo?") antes de armazenar/avançar; segunda submissão (ou confirmação) armazena; cobrir com teste em `apps/web/src/services/onboarding.test.ts` (missing)
- [x] T041 Extrair `TypingIndicator` para `apps/web/src/components/onboarding/ava/TypingIndicator.tsx` conforme a estrutura do plan.md (hoje exportado de `AvaComposer.tsx`); atualizar imports em `AvaOnboarding.tsx` (partial)
