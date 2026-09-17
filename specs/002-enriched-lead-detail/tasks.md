---

description: "Task list for feature 002-enriched-lead-detail"
---

# Tasks: Perfil Completo do Lead Enriquecido

**Input**: Design documents from `/specs/002-enriched-lead-detail/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api.md ✅, quickstart.md ✅

**Tests**: inclusos conforme constituição (III — testes como porta de entrada) e plan.md (D7): testes de plataforma (`node --test`) precedem a implementação correspondente na US5; no web o gate é `pnpm run build` + cenários do quickstart.md (o repo não tem framework de teste de componentes — decisão registrada em research.md D7).

**Organization**: tasks agrupadas por história de usuário (US1–US5 da spec.md) para implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de task incompleta)
- **[Story]**: história à qual a task pertence (US1–US5)
- Caminhos exatos em todas as descrições

## Path Conventions

Monorepo (plan.md): plataforma Node/Express na **raiz** (`server-prod.js`, módulos planos, `test/`) + SPA em **`apps/web/src/`**. Migrações exclusivamente via `pnpm run db:migrate` / `db:deploy` (constituição).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependências novas e contratos de tipos/API do frontend

- [x] T001 Adicionar dependências `maplibre-gl` e `@xyflow/react` em `apps/web/package.json` e rodar `pnpm install` (justificativa: research.md D1/D2 — únicas deps novas da feature)
- [x] T002 [P] Adicionar tipos `LeadAddress`, `LeadAddressLocation`, `LeadAddressKind`, `LeadAddressSource` e union de estado de seção (`SectionState`) em `apps/web/src/types/index.ts` conforme contracts/api.md
- [x] T003 [P] Adicionar `fetchLeadAddresses(prospectId)` em `apps/web/src/services/api.ts` (GET `/api/prospects/:id/addresses`) — endpoints de enrichment/graph já existem lá

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: navegação da tela e carregamento de dados — pré-requisito de todas as histórias

**⚠️ CRITICAL**: nenhuma história começa antes deste phase

- [x] T004 Implementar rota de tela `/leads/:id` em `apps/web/src/App.tsx`: estado `leadDetailId`, `history.pushState` no clique, listener `popstate`, resolução de deep link direto (nova aba), mantendo `TAB_FROM_PATH` intacto para as tabs existentes (contracts/api.md — navegação SPA)
- [x] T005 [P] Criar hook `useLeadDetail` em `apps/web/src/components/lead/useLeadDetail.ts`: fetch paralelo de prospect (contexto atual) + `GET /api/prospects/:id/enrichment` + `GET /api/enrichment/graph/:cnpj` + `fetchLeadAddresses`, com estado independente por seção (`idle|loading|ready|error(+retry)|empty`), 404 → estado "não encontrado" (FR-014) e `available: false` do grafo → degradação da seção (FR-015)

**Checkpoint**: navegação e carregamento funcionam — histórias podem começar (US2–US5 em paralelo entre si após US1)

---

## Phase 3: User Story 1 — Tela dedicada de detalhes completos ao clicar no lead (Priority: P1) 🎯 MVP

**Goal**: clicar em um lead enriquecido abre a tela dedicada com URL própria, seções renderizadas e retorno ao contexto — sem drawer nem modal

**Independent Test**: clicar no lead em cada lista → tela inteira em `/leads/<id>` (≤2s); deep link abre direto; voltar preserva filtros; fonte de grafo off → degradação por seção (spec.md US1)

### Implementation for User Story 1

- [x] T006 [US1] Criar `apps/web/src/components/lead/LeadDetailScreen.tsx`: shell da tela com header (nome/fantasia, CNPJ, status+fonte+versão do enriquecimento, `dataRestricted` badge), botão Voltar (`history.back()`) e grid de seções alimentado pelo hook `useLeadDetail`; ações do lead no header: reenriquecer (reuso de `POST /api/prospects/:id/enrich`), ir para outreach/pipeline (FR-016)
- [x] T007 [P] [US1] Criar `apps/web/src/components/lead/LeadOverview.tsx`: identidade, status do pipeline, resumo de scores e selo de restrição de plano (usa primitivo `LockedText` existente)
- [x] T008 [P] [US1] Criar `apps/web/src/components/lead/LeadFirmographics.tsx`: firmografia do cadastro (segmento, porte, faturamento, natureza jurídica, abertura — respeitando masking trial via `LockedText`)
- [x] T009 [P] [US1] Criar `apps/web/src/components/lead/LeadIntelligence.tsx`: cards Potencial/Prontidão/Lançamento (`enrichmentSummary`), risco de crédito e score de oportunidade com breakdown
- [x] T010 [US1] Conectar os cliques de lead em Dashboard, Prospecção e Pipeline para navegar para `/leads/:id` (handlers em `apps/web/src/App.tsx` — substituir `setSelectedProspect` das listas; :304,314,325,351)
- [x] T011 [US1] Aposentar o fluxo antigo (FR-009): remover botão "Ver grafo de enriquecimento completo" e bloco de grafo de `apps/web/src/components/modals/ProspectDetailDrawer.tsx` e remover `apps/web/src/components/modals/EnrichmentGraphModal.tsx` (redistribuir lógica de renderização de dados do modal nas seções desta feature)
- [x] T012 [US1] Estados por seção (`loading` skeleton, erro com nova tentativa, vazio informativo, degradação "fonte de grafo indisponível") nos componentes de seção em `apps/web/src/components/lead/` — falha de uma seção não bloqueia as demais (FR-015)

**Checkpoint**: US1 independente e demonstrável — o operador clica no lead e vê a tela completa (MVP utilizável mesmo sem US2–US5: seções novas entram vazias ou com dado básico)

---

## Phase 4: User Story 2 — Perfil de inteligência completo, não apenas contadores (Priority: P2)

**Goal**: todo fato capturado aparece como conteúdo nomeado com fonte e confiança — não como contador/booleano

**Independent Test**: lead com enriquecimento profundo mostra tecnologias e redes sociais nomeadas, financeiro, pessoas e evidências com confiança; enriquecimento parcial mostra progresso ao vivo (spec.md US2)

### Implementation for User Story 2

- [x] T013 [P] [US2] Criar `apps/web/src/components/lead/LeadDigitalPresence.tsx`: domínio + sinais de protocolo (HTTP/HTTPS/DNS/TLS/RDAP do `profile.domain`), **lista nomeada de tecnologias** (`profile.technologies` com confiança — nunca só `tech_count`) e perfis sociais (`profile.social`)
- [x] T014 [P] [US2] Criar `apps/web/src/components/lead/LeadPeople.tsx`: quadro societário/pessoas (`profile.people` + `cnpjPartners`) com `LockedText` no trial
- [x] T015 [P] [US2] Criar `apps/web/src/components/lead/LeadFinancials.tsx`: indicadores financeiros (`profile.financial_indicators`) com estado vazio informativo quando não capturado
- [x] T016 [US2] Criar `apps/web/src/components/lead/LeadEvidence.tsx`: proveniência por fato (`facts[]` do grafo + `entities[]`/capabilities do endpoint v2): fonte, confiança e data de captura (FR-006)
- [x] T017 [US2] Criar selo reutilizável de confiança (alta/baixa/neutro — fatos sem confiança = neutro, nunca "alto") em `apps/web/src/components/lead/` e aplicar em todas as seções (FR-018)
- [x] T018 [US2] Indicador de enriquecimento parcial em `apps/web/src/components/lead/LeadDetailScreen.tsx` (a partir de `enrichmentStatus` + entities/capabilities) com polling leve enquanto em andamento, em `apps/web/src/components/lead/useLeadDetail.ts` (FR-017)
- [x] T019 [US2] Estados vazios informativos por categoria sem captura ("nenhum dado capturado ainda" + CTA de enriquecimento) nas seções de `apps/web/src/components/lead/` (spec.md US2.4)

**Checkpoint**: US2 independente — auditoria de um lead de referência mostra 100% das categorias como conteúdo (SC-002)

---

## Phase 5: User Story 3 — Redes de contato acionáveis (Priority: P2)

**Goal**: e-mails, telefones, redes sociais e endereços com ação direta, respeitando mascaramento de trial

**Independent Test**: premium executa copiar/WhatsApp/abrir social sem sair da tela; trial vê tudo mascarado sem revelar valor (spec.md US3)

### Implementation for User Story 3

- [x] T020 [US3] Criar `apps/web/src/components/lead/LeadContacts.tsx`: seção de redes de contato combinando `profile.contact_points` (grafo) e `cnpjEmail`/`cnpjPhones` (cadastro, deduplicado) — ações: copiar e-mail/telefone (clipboard), abrir WhatsApp do número (reuso do padrão de link existente no drawer), abrir perfil social em nova aba; cada canal com confiança/fonte (FR-007)
- [x] T021 [US3] Masking nas ações em `apps/web/src/components/lead/LeadContacts.tsx` (FR-013): valores `dataRestricted` renderizam `LockedText` e ações de cópia/abertura desabilitadas — nenhum valor mascarado é revelado (trial)
- [x] T022 [US3] Estado vazio sem nenhum contato capturado com CTA "disparar enriquecimento" em `apps/web/src/components/lead/LeadContacts.tsx` (spec.md US3.4)

**Checkpoint**: US3 independente — contato → ação comercial sem sair da tela

---

## Phase 6: User Story 4 — Grafo de relacionamento interativo (Priority: P3)

**Goal**: rede de relacionamentos com pan/zoom, seleção de nó e destaque de conexões, dentro da tela

**Independent Test**: interagir (zoom, pan, clicar nós) num lead com grafo; lead sem CNPJ mostra estado explicativo (spec.md US4)

### Implementation for User Story 4

- [x] T023 [US4] Criar `apps/web/src/components/lead/LeadRelationshipGraph.tsx` com `@xyflow/react`: montar nodes/edges a partir de `graph.nodes`/`graph.edges`, layout radial calculado em código (evoluir o posicionamento radial do antigo `RelationshipGraph` em `EnrichmentGraphModal.tsx` — ver research.md D2), nós com rótulo/tipo/confiança e limite de exibição com indicação quando grafo muito grande
- [x] T024 [US4] Interações do grafo em `apps/web/src/components/lead/LeadRelationshipGraph.tsx`: seleção de nó → painel de detalhe (tipo, rótulo, confiança, fatos associados) + destaque da vizinhança; pan/zoom/controls (FR-008)
- [x] T025 [US4] Estados do grafo em `apps/web/src/components/lead/LeadRelationshipGraph.tsx`: lead sem CNPJ, `available: false` e grafo vazio → estado explicativo com ação sugerida (disparar enriquecimento), restante da tela intacto

**Checkpoint**: US4 independente — o modal estático foi substituído por grafo interativo na tela

---

## Phase 7: User Story 5 — Mapa 3D de localização dos endereços (Priority: P3)

**Goal**: cada endereço encontrado plotado num mapa 3D interativo (rotação/inclinação), com cartão por marcador; geocodificação com cache

**Independent Test**: lead com endereço geocodificável mostra pino + cena 3D rotacionável + cartão no clique; não geocodificado fica listado como "sem localização no mapa"; trial vê apenas pino coarse de cidade (spec.md US5)

### Tests for User Story 5 ⚠️ (constituição III — escrever PRIMEIRO, ver falhar)

- [x] T026 [P] [US5] Criar `test/geocoding.test.js` (node --test, fetch externo mockado): normalização/dedup de endereços (`normalizedKey`), extração de `cnpjRawData` (logradouro/numero/bairro/municipio/uf/cep) e resumo `city`/`state`, cache hit/miss/TTL 90d, fallback Nominatim quando BrasilAPI não resolve rua, falha externa → `location: null` sem throw, limite de 1 geocode novo por request
- [x] T027 [P] [US5] Criar `test/lead-addresses.test.js` (node --test): 401 sem org; 404 cross-tenant e inexistente; trial → apenas `kind: "city"` + `dataRestricted: true` (nenhum fullText de rua); premium → endereços completos com `location`; ordenação headquarters → captured → city; degradação com fonte externa fora (HTTP 200 + `location: null`)

### Implementation for User Story 5

- [x] T028 [US5] Adicionar modelo `GeocodeCache` em `prisma/schema.prisma` (campos/regras em data-model.md: `normalizedKey @unique`, `lat`, `lng`, `precision` street|zip|city, `source`, `fetchedAt`) e gerar migração com `pnpm run db:migrate` (nunca `db push` — AGENTS.md)
- [x] T029 [US5] Implementar `geocoding.js` na raiz: extração/normalização/dedup (D4), geocode BrasilAPI `GET /cep/v2/{cep}` → fallback Nominatim estruturado, leitura/escrita do cache `GeocodeCache` com TTL, limite por request; fazer T026/T027 passar
- [x] T030 [US5] Implementar endpoint `GET /api/prospects/:id/addresses` em `server-prod.js` conforme contracts/api.md: `requireRequestOrgId`, filtro `{id, orgId}` → 404, masking trial (só `kind: "city"`), ordenação, logs estruturados sem dado de cliente; fazer T027 passar
- [x] T031 [P] [US5] Criar `apps/web/src/components/lead/LeadAddresses.tsx`: lista de endereços (fullText, kind, confiança), badge "sem localização no mapa" para `location: null` (FR-012), copiar endereço (premium)
- [x] T032 [US5] Criar `apps/web/src/components/lead/LeadLocationMap.tsx`: `maplibre-gl` via **import dinâmico** (code-splitting), tiles OSM sem key, cena 3D (pitch/bearing), um marcador por `location`, cartão de detalhe no clique do marcador, rotação/inclinação habilitadas, estado vazio sem endereços geocodificados (SC-003); conectar ao hook `useLeadDetail` (fetch `/addresses`)

**Checkpoint**: todas as histórias funcionam independentemente

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: refino, performance e validação ponta a ponta

- [x] T033 Limpeza em `apps/web/src/` (imports/código morto do modal aposentado em `apps/web/src/components/modals/`, tipos novos em `apps/web/src/types/index.ts`), `pnpm --filter web exec tsc --noEmit` limpo
- [x] T034 [P] Performance (SC-001/SC-003) em `apps/web/src/`: conferir code-splitting (`apps/web/src/components/lead/LeadLocationMap.tsx`, `LeadRelationshipGraph.tsx` fora do bundle principal), memoização de seções pesadas e fetch paralelo em `apps/web/src/components/lead/useLeadDetail.ts`
- [ ] T035 **(parcial: gates automatizados ✅ — cenários manuais do quickstart pendentes de sessão real)** Rodar gates e validação completa: `pnpm test`, `pnpm run build` e todos os cenários de `specs/002-enriched-lead-detail/quickstart.md` (US1–US5 + cross-cutting: isolamento cross-org, auditoria de masking trial, retry por seção)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T003)**: sem dependências — imediato
- **Foundational (T004–T005)**: depende do Setup (T005 usa T002/T003); bloqueia todas as histórias
- **US1 (T006–T012)**: depende da Foundational; **MVP**
- **US2 (T013–T019)**: depende da US1 (seções vivem na tela); paralelizável com US3/US4/US5
- **US3 (T020–T022)**: depende da US1; paralelizável com US2/US4/US5
- **US4 (T023–T025)**: depende da US1 + T001 (`@xyflow/react`); paralelizável com US2/US3/US5
- **US5 (T026–T032)**: depende da US1 (tela) + T001/T002/T003; backend (T026–T030) independe do frontend e pode rodar em paralelo com US2–US4 desde o início da Foundational
- **Polish (T033–T035)**: depende de todas as histórias

### Story Completion Order

```text
Setup → Foundational → US1 (MVP) ─┬─→ US2 ─┐
                                  ├─→ US3 ─┤
                                  ├─→ US4 ─┼─→ Polish
                                  └─→ US5 ─┘
        (backend da US5 pode começar em paralelo com a US1)
```

### Parallel Execution Examples

- **Foundational**: T004 ∥ T005 (arquivos diferentes)
- **US1**: T007 ∥ T008 ∥ T009 após T006
- **US2**: T013 ∥ T014 ∥ T015 → T016 → T017 → T018 → T019
- **US5 backend**: T026 ∥ T027 (testes) → T028 → T029 ∥ T030
- **US5 frontend**: T031 após T002; T032 após T029/T030 (consome o endpoint)
- **Cross-story**: após US1, um dev faz US2+US3 (seções) enquanto outro faz US4 (grafo) e o backend da US5

### Critical Path

T001 → T002/T003 → T004/T005 → T006 → T010/T011 (MVP navegável) → US2/US3/US4/US5 → T035

## Implementation Strategy

- **MVP first**: entregar US1 sozinha (Setup + Foundational + US1) — a tela dedicada com deep link e retorno já elimina o fluxo drawer+modal e entrega o salto de UX principal (SC-001); seções novas entram como estados vazios elegantes até suas histórias chegarem
- **Incremental**: US2 e US3 completam o conteúdo (P2); US4 e US5 somam grafo interativo e mapa 3D (P3) — cada fase é um incremento demonstrável e testável
- **Backend em paralelo**: o par testes+endpoint da US5 (T026–T030) não toca frontend e pode ser executado por pessoa separada desde cedo
- **Gates por fase**: `pnpm run build` após cada fase de frontend; `pnpm test` obrigatório antes do merge (constituição III); validação final pelo quickstart.md

---

## Phase 9: Convergence

**Purpose**: lacunas restantes identificadas pelo `$speckit-converge` (2026-09-17) — 3 parciais, nada CRITICAL

- [x] T036 [US1] Preservar o contexto das listas ao abrir a tela de detalhe: manter as views montadas quando `leadDetailId` ativo em `apps/web/src/App.tsx` (ocultar via CSS/`hidden` em vez de desmontar), de forma que voltar (FR-003/US1-AC3) restaure também os filtros internos de cada lista — sem colocar o chunk lazy da tela de detalhe no bundle principal (per `FR-003`, partial)
- [x] T037 [US4] Renderizar a indicação de truncamento do grafo em `apps/web/src/components/lead/LeadRelationshipGraph.tsx`: usar o contador `hidden` já retornado por `buildLayout` para exibir "+N entidades ocultas" junto ao header da seção quando `graph.nodes.length > MAX_NODES` (per Edge Case "Muitos endereços/nós" da US4, partial)
- [x] T038 [P] Aplicar `useSeo` na `apps/web/src/components/lead/LeadDetailScreen.tsx` com título próprio do lead (ex.: `${prospect.companyName} — Perfil do lead`) enquanto `/leads/:id` estiver ativa, evitando exibir o SEO da tab ativa (per UX/SC-001, partial)
