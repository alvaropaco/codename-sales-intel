---
description: "Task list for 003-contact-decision-metrics"
---

# Tasks: Métricas de Decisão de Contato no Lead

**Input**: Design documents from `/specs/003-contact-decision-metrics/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: OBRIGATÓRIOS nesta feature — constituição (III): "Feature nova ou comportamento alterado exige teste antes do merge". Tarefas de teste precedem as de implementação em cada user story (escrever primeiro, ver FALHAR).

**Organization**: Tasks grouped by user story (spec.md): US1 = métricas Atingibilidade/Momento com evidência (P1) · US2 = recomendação de contato (P1) · US3 = honestidade de dados ausentes/desatualizados (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Plataforma Node na raiz do repo + SPA em `apps/web/` (ver plan.md §Project Structure). Testes na raiz de `test/` (glob do script: `node --test test/*.test.js`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esqueleto do módulo com constantes de scoring — contrato único de números usado por todas as stories.

- [X] T001 Create module skeleton at repo root `contact-decision.js` exporting ONLY the scoring constants from data-model.md §Constantes (`REACH_WEIGHTS = { corporate_email: 40, generic_email: 10, phone: 25, whatsapp: 10, enriched_email: 15 }`, `TIMING_WEIGHTS = { active_status: 25, website_active: 20, corporate_email: 10, social: 10, growth_stack: 15, tech_any: 5, recent: 10, momentum_positive: 5 }`, `TIMING_DIGITAL_SUBTOTAL = 65`, `FACTOR_WEIGHTS = { reachability: 40, timing: 35, fit: 15, risk: 10 }`, `VERDICT_THRESHOLDS = { contact_now: 65, contact_lower_priority: 40 }`, `LEVEL_THRESHOLDS = { high: 70, medium: 45 }`, `STALE_AFTER_DAYS = 90`) via `module.exports` — sem lógica ainda (nenhuma função implementada nesta fase)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos compartilhados e scaffold de testes — bloqueiam todas as user stories.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

- [X] T002 [P] Add shared types to `apps/web/src/types/index.ts` per contracts/api.md: `ContactDecision`, `ReachabilityMetric`, `TimingMetric`, `Recommendation` (verdict `'contact_now' | 'contact_lower_priority' | 'do_not_prioritize'`, reasons `Array<{code, detail}>`, factors, suggestedAction, contactedContext), `DecisionEvidence`, `DecisionFreshness` — níveis `'high' | 'medium' | 'low' | 'unknown'`, `score: number | null`
- [X] T003 [P] Create test scaffold `test/contact-decision.test.js` following `test/opportunity-score.test.js` style (node:test + node:assert): fixture builders `prospectFixture(overrides)` e `graphProfileFixture(overrides)` representando os inputs de data-model.md §Entidades de entrada; primeiro caso de fumaça importa as constantes de `contact-decision.js` (T001) e valida que somam conforme data-model.md — este teste passa já no setup; os das stories começam FALHANDO contra as funções ainda inexistentes

**Checkpoint**: Constantes, tipos e fixtures prontos — stories podem começar (US1 primeiro).

---

## Phase 3: User Story 1 — Métricas com evidência: Atingibilidade e Momento (Priority: P1) 🎯 MVP

**Goal**: Na tela de detalhes, as três notas antigas (Potencial, Prontidão, Lançamento) saem e entram dois cards que respondem "consigo chegar?" e "agora é hora?" com selo qualitativo primário, score secundário e evidências visíveis (FR-001, FR-002, FR-003, FR-006, FR-017; remoção do chip Oportunidade FR-009; risco permanece FR-010).

**Independent Test**: abrir a tela de um lead enriquecido e ver os dois cards com evidência; `pnpm test test/contact-decision.test.js` cobre o cálculo; nenhuma métrica antiga aparece (quickstart.md §4).

### Tests for User Story 1 (escrever primeiro, ver FALHAR)

- [X] T004 [P] [US1] Tests for `computeReachability` in `test/contact-decision.test.js`: e-mail corporativo próprio (via `cnpjEmail` classificado por `classifyEmailDomain` de `opportunity-score.js`) → +40 e nível ≥ medium; único e-mail de provedor gratuito (`FREE_EMAIL_DOMAINS`) → `classification: 'generic'`, +12; e-mail de contabilidade (`ACCOUNTING_EMAIL_DOMAINS`) → `classification: 'third_party'`; telefone em `cnpjPhones` → +25; whatsapp em `contact_points` → +10; e-mail adicional de enriquecimento (PDL em `contact_points`, dedup por valor normalizado contra `cnpjEmail`) → +15; clamp 0–100; limiares de nível (≥70 high, ≥45 medium, >0 low); `usableChannel: false` quando só evidências sem canal; `recommendedChannel` prioriza e-mail corporativo > whatsapp > telefone genérico (contracts/api.md)
- [X] T005 [P] [US1] Tests for `computeTiming` in `test/contact-decision.test.js`: situação cadastral ativa (`isActive` sobre `cnpjRawData`) → +25 e `inactive: false`; suspensa → +0 e `inactive: true`; `website_active` → +20; `corporate_email` → +10; social do grafo → +10; categorias de tecnologia `analytics|marketing|crm|communications` → +15 (growth stack); `tech_count > 0` → +5; `cnpjOpenedAt` < 2 anos → +10 (recent); `score_breakdown.momentum > 0` → +5; lead sem CNPJ → renormalização sobre `TIMING_DIGITAL_SUBTOTAL` e `missingOfficialSignals = ['situacao_cadastral','cnpj_age']` (FR-018)

### Implementation for User Story 1

- [X] T006 [US1] Implement `computeReachability(input)` in `contact-decision.js`: extrai e deduplica canais de `prospect.cnpjEmail`, `prospect.cnpjPhones` e `graphProfile.contact_points` (classificação de e-mail reusando `classifyEmailDomain`; inputs por data-model.md §Entidades de entrada); retorna `{ level, score, usableChannel, recommendedChannel, channels, evidence, basis, stale: false }` — evidências com `key/label/detail/confidence/date`, NUNCA valor de e-mail/telefone (garantia 1 de contracts/api.md); require de `./opportunity-score` para helpers
- [X] T007 [US1] Implement `computeTiming(input)` in `contact-decision.js` per T005 weights, incluindo renormalização sem CNPJ (FR-018), `inactive: null` quando situação cadastral desconhecida, e retorno no shape de data-model.md §Timing
- [X] T008 [US1] Implement pure aggregator `computeContactDecision({ prospect, graphProfile })` in `contact-decision.js`: monta `{ reachability, timing, freshness: { stale, lastEvidenceAt, thresholdDays } }` + invariante de data-model.md (2): `score` null ⇔ `level 'unknown'` quando nenhuma fonte consultável (enriquecimento pending/error E sem canais de cadastro E sem grafo) — a US3 traz os testes que travam esse estado; freshness por data-model.md (datas: `prospect.enrichedAt`, `enrichedAt` do grafo, `prospect.updatedAt` para cadastro)
- [X] T009 [US1] Add endpoint `GET /api/prospects/:id/contact-decision` in `server-prod.js` (junto às rotas de prospect): `requireRequestOrgId` + `findFirst({ id, orgId })` → 404 cross-tenant; grafo via `enrichmentGraph.fetchCompanyGraph(cnpj)` em try/catch → degrada com `basis.graph_available: false` (FR-013); `dataRestricted` ecoado do plano (`getOrgPlan`); resposta `{ success, data }` conforme contracts/api.md; erro loga estruturado sem dados do lead
- [X] T010 [P] [US1] Add `fetchContactDecision(id)` to `apps/web/src/services/api.ts`: GET no novo endpoint, 404 ⇒ null, demais erros lançam (padrão de `fetchProspect`)
- [X] T011 [US1] Add `decision` section to `apps/web/src/components/lead/useLeadDetail.ts`: quarto estado independente (loading/ready/empty/error + retry via `retryTicks.decision`), fetch após prospect resolver, polling no interval existente enquanto `enrichmentActive` (FR-013/FR-017)
- [X] T012 [US1] Rewrite `apps/web/src/components/lead/LeadIntelligence.tsx`: remover cards Potencial/Prontidão/Lançamento e o chip "Oportunidade" (FR-001/FR-009); renderizar dois cards com SELO QUALITATIVO PRIMÁRIO (Alta/Média/Baixa) e score 0–100 secundário (FR-017), evidências listadas sob cada card (FR-006), chip de risco de crédito mantido (FR-010); estado pendente herdado quando decisão `unknown`/ausente; wire em `LeadDetailScreen.tsx` passando `decision` + `graph` para a seção
- [X] T013 [P] [US1] Add PT-BR label maps (níveis high/medium/low/unknown → Alta/Média/Baixa/Sem dados; keys de evidência → rótulos) como constantes locais de `apps/web/src/components/lead/LeadIntelligence.tsx`

**Checkpoint**: US1 funcional e testável isoladamente — `pnpm test test/contact-decision.test.js` verde; tela mostra os dois cards com evidência e zero métricas antigas (quickstart.md §4, itens 1–2).

---

## Phase 4: User Story 2 — Recomendação de contato única, explicável e acionável (Priority: P1)

**Goal**: Veredito único em 3 níveis sintetizando atingibilidade, momento, risco e aderência, com motivos decisivos, decomposição de fatores, ação sugerida e contexto "já contatado" (FR-004, FR-005, FR-007, FR-014, FR-015).

**Independent Test**: abrir leads com perfis distintos (canais bons × sem canais; CNPJ ativo × suspenso; risco alto × baixo) e conferir veredito coerente com motivos — coberto pelos testes T014–T016 e inspeção na tela (quickstart.md §4).

### Tests for User Story 2 (escrever primeiro, ver FALHAR)

- [X] T014 [P] [US2] Tests for verdict tiers and factors in `test/contact-decision.test.js`: média ponderada com `FACTOR_WEIGHTS` (reachability 40, timing 35, fit 15, risk 10); fit de `score_breakdown.setor + porte` renormalizado (neutro 50 quando ausente); risk = `100 − creditRiskScore` (neutro 50 quando ausente); renormalização por fatores `used` — fator `unknown` não penaliza; limiares ≥65 `contact_now`, ≥40 `contact_lower_priority`, senão `do_not_prioritize`
- [X] T015 [P] [US2] Tests for gates (FR-014) in `test/contact-decision.test.js`: `inactive: true` OU risco alto → teto `contact_lower_priority` com motivo `inactive_company`/`high_credit_risk`; inativa E risco alto → `do_not_prioritize`; `usableChannel: false` → `do_not_prioritize` com motivo `no_channel` e ação `enrich_lead`; invariante de contracts/api.md (3): `contact_now` ⇒ `usableChannel && !inactive && risco ≠ alto`; `suggestedAction` coerente (start_email quando e-mail corporativo recomendado, start_whatsapp quando só whatsapp)
- [X] T016 [P] [US2] Tests for contactedContext (FR-015) in `test/contact-decision.test.js`: `contactedChannels` não-vazio OU `lastContact` OU status avançado → `contactedContext` preenchido com canais + data e veredito INALTERADO; lead nunca contatado → `contactedContext: null`

### Implementation for User Story 2

- [X] T017 [US2] Implement `computeRecommendation({ reachability, timing, prospect })` in `contact-decision.js` per T014–T016: fatores, veredito, gates (aplicados APÓS a média), reasons como `{ code, detail }` com os códigos estáveis da tabela de contracts/api.md, `suggestedAction`, `contactedContext`; agregador T008 passa a incluir `recommendation` no payload
- [X] T018 [US2] Frontend recommendation block in `apps/web/src/components/lead/LeadIntelligence.tsx`: veredito em selo de 3 níveis com rótulos PT-BR (Abordar agora / Prioridade menor / Não priorizar), motivos com mapa code→PT-BR da tabela de contracts/api.md, ação sugerida, aviso "lead já contatado (canal · data)" quando `contactedContext.contacted` (FR-015), e decomposição de fatores com contribuição de cada um (FR-007) — substitui definitivamente qualquer leitura de múltiplos scores
- [X] T019 [US2] Extend endpoint contract guarantees: nos testes de T014–T016 já cobertos — adicionar caso de regressão em `test/contact-decision.test.js` que roda `computeContactDecision` sobre fixtures com dados sensíveis (e-mails/telefones reais nas entradas) e assegura via `JSON.stringify` + regex que o payload NÃO contém nenhum valor de entrada de contato (garantia 1, SC-006)

**Checkpoint**: US1 + US2 funcionais — veredito único e explicável na tela; gates impedem "abordar agora" nos cenários proibidos.

---

## Phase 5: User Story 3 — Ausência de dados não vira número enganoso (Priority: P2)

**Goal**: Métrica sem evidência exibe "sem dados suficientes" orientativo (nunca número baixo pretensioso — FR-008); evidência >90 dias recebe selo de desatualização por métrica com sugestão de reenriquecer, sem ocultar valor (FR-016); evidência fraca distingue-se visualmente (FR-018 edge da spec 002 — padrão de confiança da tela).

**Independent Test**: abrir lead recém-importado sem enriquecimento (ou parcial) e verificar estados honestos por métrica; testes T020 travam as regras.

### Tests for User Story 3 (escrever primeiro, ver FALHAR)

- [X] T020 [P] [US3] Tests for unknown and staleness in `test/contact-decision.test.js`: lead `enrichmentStatus: 'pending'` sem canais/grafo → ambas métricas `level 'unknown'`, `score null`, payload SEM número (FR-008); enriquecimento parcial (contatos sem presença digital) → reachability normal + timing unknown; evidências com data >90 dias → `stale: true` na métrica afetada e `freshness.stale` true, valores PRESERVADOS (FR-016); idades mistas (grafo recente, cadastro antigo) → stale por métrica, não no painel inteiro (edge case da spec); `thresholdDays: 90` presente no payload

### Implementation for User Story 3

- [X] T021 [US3] Implement per-metric staleness in `contact-decision.js`: `lastEvidenceAt` por métrica a partir das datas das evidências que a sustentam (T008), flag `stale` por métrica e na raiz — sem ocultar valor, sem bloqueio por idade
- [X] T022 [US3] Frontend honest states in `apps/web/src/components/lead/LeadIntelligence.tsx`: estado "Sem dados suficientes" com orientação de ação ("dispare o enriquecimento…") quando `level 'unknown'` — sem número; selo "dados podem estar desatualizados" + sugestão de reenriquecer quando `stale` (por card, não no painel inteiro); evidências de baixa confiança (`confidence < 0.5`) com distinção visual coerente com `ConfidenceBadge` de `apps/web/src/components/lead/shared.tsx`

**Checkpoint**: Todas as stories funcionais — painel honesto com dado ausente, parcial e velho.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validação de ponta a ponta e auditorias dos critérios de sucesso.

- [X] T023 Run full gates: `pnpm test` (suíte inteira verde, sem quebrar módulos existentes) e `pnpm run build --prefix apps/web` (typecheck/build) — constituição III e IV
- [X] T024 [P] Audit SC-004: confirmar zero ocorrências de "Potencial", "Prontidão", "Lançamento" (e `commercial_potential`/`operational_readiness`/`launch_velocity` renderizados) em `apps/web/src/components/lead/` — dados antigos podem permanecer nos serviços (assunção da spec), apenas a tela os abscra
- [X] T025 [P] Audit SC-006/FR-012: revisar rota nova em `server-prod.js` — escopo por organização (404 cross-tenant) e zero valores de contato no payload (contrato guarantees 1 e 5); registrar resultado no quickstart.md §3
- [ ] T026 Run quickstart.md §4 (validação manual na tela, desktop): checklist completo dos FRs — máscara trial, polling sem reload, retry por seção, contexto de contato *(requer app rodando com dados; deixar para validação em staging)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: imediato, sem dependência.
- **Foundational (Phase 2)**: depende de T001; bloqueia todas as stories (T002 tipos são usados por T010–T013; T003 scaffolds os testes de todas).
- **US1 (Phase 3)**: depende de Phase 2. É o MVP — sem US1 não há seção na tela.
- **US2 (Phase 4)**: depende de US1 (consumirá `reachability`/`timing` computados e o bloco de front já reescrito).
- **US3 (Phase 5)**: depende de US1 (estados por métrica); pode avançar em paralelo com US2 (arquivos de cálculo distintos — `computeRecommendation` vs. staleness — mas ambos tocam `contact-decision.js` e `LeadIntelligence.tsx`: sequenciar merges, não o trabalho).
- **Polish (Phase 6)**: depende de todas as stories desejadas.

### User Story Dependencies

- **US1**: independente — núcleo do painel.
- **US2**: integra com US1 (agregador e bloco de front), mas é testável isoladamente via funções puras.
- **US3**: integra com US1/US2 apenas nos mesmos arquivos; regras testáveis isoladamente.

### Within Each User Story

- Testes primeiro (constituição III): ver FALHAR antes de implementar.
- Cálculo (módulo puro) → endpoint/wiring → frontend.
- Checkpoint de story antes de avançar.

### Parallel Opportunities

- T002 ∥ T003 (arquivos distintos).
- T004 ∥ T005 (casos de teste distintos no mesmo arquivo — escrever juntos, arquivos não conflitam).
- T010 (api.ts) ∥ T006–T009 (módulo/endpoint) — contratos já fixados em contracts/api.md.
- T013 ∥ T012 (mapa de rótulos pode ser escrito junto com o componente, arquivo único porém — [P] refere-se à independência do resto).
- US2 e US3: computações distintas em `contact-decision.js` podem ser desenvolvidas em paralelo, com merges sequenciados.

---

## Parallel Example: User Story 1

```bash
# Testes primeiro (T004+T005 no mesmo arquivo, uma escrita só):
Task: "Tests for computeReachability in test/contact-decision.test.js"
Task: "Tests for computeTiming in test/contact-decision.test.js"

# Depois, em paralelo (arquivos distintos, contrato fixado):
Task: "Add fetchContactDecision to apps/web/src/services/api.ts (T010)"
# enquanto o módulo e o endpoint avançam (T006→T008→T009, sequenciais por dependência)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → fundação (constantes, tipos, fixtures).
2. Phase 3 (US1) → parar e validar: testes verdes + tela com os dois cards e zero métricas antigas.
3. Deploy/demo se pronto — já elimina a dor original (três números sem sentido).

### Incremental Delivery

1. MVP (US1) → validar → integrar US2 (recomendação única explicável) → validar → US3 (honestidade de dados) → validar.
2. Cada story adiciona valor sem quebrar a anterior; veredito completo só existe após US2.

### Notes

- Commits conventional em PT-BR por task ou grupo lógico (ex.: `feat(lead): computa atingibilidade e momento — 003`).
- Nenhuma migração de schema; nenhum contrato NATS alterado (constituição II).
- O worker Python (`scoring.py`) NÃO é tocado — substituição é de superfície (assunção da spec).
