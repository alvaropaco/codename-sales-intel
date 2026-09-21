---

description: "Task list for 007-outreach-tenant-templates"
---

# Tasks: Outreach Multi-tenant — Mensagens pelo Template do Tenant

**Input**: Design documents from `/specs/007-outreach-tenant-templates/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/api.md, quickstart.md

**Tests**: Incluídos e OBRIGATÓRIOS — Constituição III (testes como porta de entrada) e plano: testes vêm **antes** da implementação em cada story, usando os fakes existentes (`test/helpers/fake-prisma.js`, `fake-llm.js`, `fake-redis.js`), sem rede/banco real.

**Organization**: Agrupadas por user story (US1–US6 do spec.md) para implementação e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: Story de origem (US1…US6) — fases de setup/foundational/polish não têm label
- Caminhos exatos em todas as descrições

## Path Conventions

Módulos Node.js planos na raiz; SPA em `apps/web/src/`; testes em `test/` (runner `node --test`, script `pnpm test`); migrações em `prisma/` via `pnpm run db:migrate`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline verificado e evolução de schema pronta para todas as stories.

- [X] T001 Rodar baseline verde antes de qualquer mudança: `pnpm test` e `pnpm --filter web build` no branch `007-outreach-tenant-templates`; registrar resultado no PR
- [X] T002 [P] Adicionar campos aditivos em `prisma/schema.prisma` e criar migração com `pnpm run db:migrate`: `compositionOrigin String?` em `WhatsAppMessage` e `OutreachMessage`; `needsReview Boolean @default(false)`, `reviewReason String?`, `approvedAt DateTime?` em `WhatsAppCampaign` e `OutreachCampaign` (data-model.md §4–§5, D9 — nada renomeado, sem `db push`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Guard de template e compositor de base — usados por US1, US3, US4 e US5.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

- [X] T003 [P] Escrever testes do guard de ingestão em `test/whatsapp-utils.test.js`: BLOCKLIST rejeita com razão `blocked_claim` (ex.: "desconto", "grátis"); texto > 600 chars rejeita com `too_long`; placeholder desconhecido (ex. `{{preco}}`) rejeita com `unknown_placeholder`; template válido "Olá {{firstName}}, tudo bem?" passa
- [X] T004 Implementar `validateTemplateMessage(template)` exportado em `whatsapp-utils.js` (reusa `BLOCKLIST` da linha 137; limite 600; whitelist de placeholders `firstName|companyName|jobTitle|city|industry`; retorna `{ ok, reason }`) — depende T003
- [X] T005 [P] Escrever testes da composição de base em `test/ai-campaign.test.js` (fake `orgCtx` configurado): base contém nome comercial + proposta de valor + CTA do perfil; **NÃO contém** `strategy.objective`, `ctaGoal` cru, "pré-qualificados", "leads prontos para contato" nem contagem de leads; ≤ 400 chars; perfil não configurado (`configured === false`) → sinaliza impossibilidade de compor (escrever antes de T006 — testes primeiro)
- [X] T006 Implementar `composeBaseFromProfile(orgCtx)` exportado em `ai-campaign.js` (D1: whitelist `nome`, `propostaValor`/`oQueE`, `effectiveCtaText()`; esqueleto "Olá {{firstName}}, tudo bem? Aqui é o(a) …"; `slice(0, 400)`; valida a própria saída com `validateTemplateMessage`) — depende T004, T005

**Checkpoint**: Foundation pronto — US1/US2 podem avançar em paralelo; US3/US4 após suas dependências.

---

## Phase 3: User Story 1 — Mensagens de outreach usam o template do tenant (Priority: P1) 🎯 MVP

**Goal**: Todo fluxo (manual, automatizado, IA) usa base do tenant/perfil; ciclo IA passa a criar → prévia → aprovar → disparar, sem texto interno possível.

**Independent Test**: Criar campanha IA → resposta `pending_approval` com prévia sem texto interno e nenhuma fila ativa; aprovar → ambos os canais disparam exatamente a base aprovada.

### Tests for User Story 1

- [X] T007 [US1] Escrever testes do ciclo IA em `test/ai-campaign.test.js`: criação grava `OutreachCampaign(status:'draft', approvedAt:null, emailTemplateSubject/Body compostos)` e `WhatsAppCampaign(status:'DRAFT', approvedAt:null, step 0 com base composta + aiPersonalized:true)`; **não** chama `startOutreachCampaign`/`whatsappWorkers.startCampaign`; retorno `pending_approval` + prévia com lead real; `approve` grava `approvedAt` e dispara; `approve` em já aprovada → 409; `edits` aplicadas com guard; org trial → 403; acima do limite diário → 429 — depende T006

### Implementation for User Story 1

- [X] T008 [US1] Refatorar `createAndLaunchAiCampaign` em `ai-campaign.js`: substituir `buildWhatsAppFallbackTemplate` (linhas 345–358) por `composeBaseFromProfile` — `objective`/`ctaGoal` crus **nunca** entram no corpo; remover lançamento imediato; semear template de email composto (D4/D6) — depende T007
- [X] T009 [US1] Ajustar `POST /api/ai/campaigns` em `server-prod.js` (:3968) para responder `201 { status:'pending_approval', outreachCampaignId, whatsappCampaignId, preview }` com prévia renderizada no primeiro prospect `qualified` da org (sem lead → placeholders vazios e saudação sem nome) — depende T008
- [X] T010 [US1] Criar `POST /api/ai/campaigns/approve` em `server-prod.js` (contracts/api.md §2): org-scoped (404 fora da org), premium revalidado (403), `edits` opcionais validadas por `validateTemplateMessage` (400 `TEMPLATE_REJECTED`), 409 `ALREADY_APPROVED`, grava `approvedAt` e dispara `startOutreachCampaign` + `whatsappWorkers.startCampaign` — depende T009
- [X] T011 [US1] Aplicar `validateTemplateMessage` na ingestão dos endpoints existentes `POST/PATCH /api/outreach/campaigns` (:3686/:3744) e `POST /api/whatsapp/campaigns` (:5106) em `server-prod.js`: violação → `400 TEMPLATE_REJECTED { reason }` (contracts §7) — depende T004
- [X] T012 [US1] Teste de regressão multicanal em `test/whatsapp-workers.test.js`: campanha manual/suíte (`campaign-suite.js`) com template do tenant renderiza `{{firstName}}`/`{{companyName}}` corretamente em `processSequence` — nenhum texto de plataforma — depende T004

---

## Phase 4: User Story 2 — Saudação com a pessoa de contato correta (Priority: P1)

**Goal**: `{{firstName}}` resolve para a pessoa de contato; sem contato, saudação sem nome — nunca nome de empresa como pessoa.

**Independent Test**: Lead com `contactName` "Mariana Souza" → "Olá Mariana…"; lead sem contato/sócios → "Olá, tudo bem?" — nunca "Olá NOVAURORA".

### Tests for User Story 2

- [X] T013 [P] [US2] Escrever testes em `test/whatsapp-utils.test.js`: `firstName` = primeira palavra de `lead.contactName`; fallback = `cnpjPartners[0].name`; `tradeName`/`companyName` **nunca** alimentam `firstName` (seguem só em `{{companyName}}`); "Olá {{firstName}}, tudo bem?" com `firstName` vazio renderiza "Olá, tudo bem?" (vírgula do placeholder removida)

### Implementation for User Story 2

- [X] T014 [US2] Implementar em `whatsapp-utils.js`: `buildTemplateVars` (linhas 68–77) prioriza `lead.contactName` → sócio → string vazia (D2); `renderTemplate` remove `{{firstName}}` **e a vírgula imediatamente seguinte** quando vazio — depende T013
- [X] T015 [P] [US2] Escrever teste em `test/whatsapp-workers.test.js`: `buildStepMessagePrompt` inclui `contactName` do prospect quando presente — depende T014
- [X] T016 [US2] Incluir `contactName` no bloco de prospect de `buildStepMessagePrompt` em `whatsapp-workers.js` (linhas 87–109) — depende T015

---

## Phase 5: User Story 3 — Fallback da IA nunca inventa texto de plataforma (Priority: P2)

**Goal**: Qualquer falha (LLM, guard, trial) entrega o template/base do tenant — ou pula o envio; nada genérico da plataforma.

**Independent Test**: Simular LLM indisponível e disparar campanha: todas as mensagens = template/base aprovada renderizada; email sem perfil configurado não envia nada genérico.

**Depends on**: Phase 2 + US2 (limpeza de saudação usada nos fallbacks).

### Tests for User Story 3

- [X] T017 [US3] Escrever testes de fallback WhatsApp em `test/whatsapp-workers.test.js`: LLM falha / org trial / guard bloqueia → mensagem final = `step.messageTemplate` renderizado; personalizada > 600 chars → truncada em limite de frase mantendo a base; `compositionOrigin` gravada no create de `WhatsAppMessage` (`ai` | `ai_fallback_template` | `tenant_template`) — depende T016
- [X] T019 [P] [US3] Escrever testes de fallback email em `test/outreach-workers.test.js`: template do tenant → renderiza com `compositionOrigin:'tenant_template'`; sem template + perfil configurado → base por perfil com `compositionOrigin:'profile_base'`; sem perfil (`configured:false`) → contato skipped com razão `no_base_message` e **nenhum** `OutreachMessage` genérico criado — depende T006

### Implementation for User Story 3

- [X] T018 [US3] Implementar em `whatsapp-workers.js`: gravar `compositionOrigin` no `prisma.whatsAppMessage.create` de `processSequence` (linhas 262–274); truncagem em frase para > 600 chars (D3) — depende T017
- [X] T020 [US3] Implementar em `outreach-workers.js`: remover `_templateFallback` (linhas 179–197); lógica de 3 ramos em `processPrepare` (template do tenant → base por perfil → skip `no_base_message`, D4); `compositionOrigin` no create de `OutreachMessage` — depende T019

---

## Phase 6: User Story 4 — Saneamento de campanhas existentes (Priority: P2)

**Goal**: Campanhas legadas com template sintético poluído ficam retidas e sinalizadas; zero falso positivo em manuais; revalidação pelo tenant.

**Independent Test**: Fixture com campanha IA poluída + manual legítima → rotina retém só a IA; start/resume → 409; rederivar/editar limpa a flag mantendo pausa.

**Depends on**: Phase 2 (compositor).

### Tests for User Story 4

- [X] T021 [P] [US4] Escrever testes em `test/sanitize-legacy.test.js`: campanha `source:'ai'` com objective ecoado no step → `needsReview:true`, `reviewReason:'synthetic_template_leak'`, status `PAUSED`; campanha manual e suíte `[auto]` **intocadas**; segunda execução não duplica (idempotente); isolamento por org — depende T006

### Implementation for User Story 4

- [X] T022 [US4] Implementar `detectSyntheticTemplate(step, campaign)` exportado em `ai-campaign.js` (substring normalizada do `objective` ≥ 30 chars OU marcadores "pré-qualificados|leads prontos para contato|enriquecimento de CNPJ|decisores dos") e `scripts/sanitize-legacy-campaigns.js` idempotente (D7: retém `PAUSED` + `needsReview`, chamada no boot pós-migrate e executável via npm script) — depende T021
- [X] T023 [US4] Implementar em `server-prod.js` (contracts §3–§5): `PATCH /api/whatsapp/campaigns/:id` (edição de steps com guard; sucesso limpa `needsReview` sem reativar); `POST /api/whatsapp/campaigns/:id/rederive` e `POST /api/outreach/campaigns/:id/rederive` (regera base via `composeBaseFromProfile`; 409 `NO_PROFILE_CONTEXT`; mantém pausa); `start`/`resume` dos dois canais → 409 `CAMPAIGN_REVIEW_REQUIRED` se `needsReview` e 409 `TEMPLATE_REQUIRED` sem template (FR-012) — depende T022
- [X] T024 [P] [US4] UI de revalidação: badge "Revisão necessária" + ações editar template/rederivar em `apps/web/src/components/views/WhatsAppView.tsx` e `apps/web/src/components/views/OutreachView.tsx`; bloqueio de start com motivo exibido; chamadas em `apps/web/src/services/api.ts` — depende T023

---

## Phase 7: User Story 6 — Aviso de risco antes de conectar a conta de WhatsApp (Priority: P2)

**Goal**: Modal de risco (bloqueio da conta pelo WhatsApp) antes de qualquer conexão/reconexão; cancelar = nada acontece.

**Independent Test**: Clicar conectar → modal aparece antes de qualquer request; cancelar → nenhuma sessão/estado; confirmar → fluxo atual segue; reconexão também exibe.

**Depends on**: Nada (independente — pode rodar em paralelo com qualquer fase).

- [X] T025 [P] [US6] Criar `apps/web/src/components/modals/WhatsAppRiskModal.tsx` copiando o padrão de overlay Tailwind de `ProspectModal.tsx:64-80` (sem lib nova): título de alerta, texto "o uso automatizado pode resultar no **bloqueio da conta pelo WhatsApp**" + recomendação de número dedicado, botões Cancelar/Confirmar (props `onConfirm`/`onCancel`)
- [X] T026 [US6] Gatear em `apps/web/src/components/views/WhatsAppView.tsx`: `handleConnect` (linha 157) e os caminhos de reconexão (`GET …/qr` / `POST …/reconnect`) abrem o modal antes de qualquer chamada; cancelar → zero requests e estado inalterado; confirmar → segue fluxo atual — depende T025
- [X] T027 [US6] Validar `pnpm --filter web build` + cenários manuais do quickstart §3.4 (conectar/cancelar/reconectar, network limpo ao cancelar) — depende T026

---

## Phase 8: User Story 5 — Previsibilidade e auditoria do que é enviado (Priority: P3)

**Goal**: Prévia + aprovação na UI; histórico com conteúdo exato e origem da composição (incl. campanhas retidas).

**Independent Test**: Prévia aprovada = conteúdo base disparado; cada envio do histórico mostra `compositionOrigin`; filtro por campanha retida lista seus envios.

**Depends on**: US1 (approve), US3 (origins gravadas).

### Tests for User Story 5

- [X] T028 [P] [US5] Escrever testes em `test/dispatches.test.js`: itens de `GET /api/outreach/dispatches` expõem `compositionOrigin`; registros anteriores à migração → `null`; filtro `campaignId` lista envios de campanha retida — depende T018, T020

### Implementation for User Story 5

- [X] T029 [US5] Estender `GET /api/outreach/dispatches` em `server-prod.js` (:4001) para incluir `compositionOrigin` em cada item (contracts §6) — depende T028
- [X] T030 [US5] UI de aprovação: em `apps/web/src/services/api.ts` adicionar chamadas `createAiCampaign` (preview) e `approveAiCampaign`; em `apps/web/src/components/views/OutreachView.tsx` o fluxo "Campanha com IA" passa a exibir prévia renderizada + base editável + botão "Aprovar e disparar" (`pending_approval` visível até aprovar) — depende T010
- [X] T031 [US5] UI: origem da composição visível na lista de envios (`apps/web/src/components/views/OutreachView.tsx` / `WhatsAppView.tsx`, consumindo dispatches) — depende T029

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Observabilidade (Constituição VII), higiene de logs e validação ponta a ponta.

- [X] T032 [P] Métricas prom-client nos pontos de escrita/guard: `outreach_composition_origin_total{channel,origin}` (workers), `whatsapp_campaign_review_total{action=detected|rederived|edited}` (saneamento/endpoints), `ai_campaign_approvals_total{result}` (approve) — D5/D7/D10
- [X] T033 [P] Revisar logs dos guards e endpoints novos em `whatsapp-workers.js`, `outreach-workers.js`, `ai-campaign.js`, `server-prod.js`: registram razão (`blocked_claim`/`too_long`/`no_base_message`) + ids (`orgId`, `campaignId`, `messageId`) — **nunca** o conteúdo da mensagem do cliente
- [X] T034 Validar `specs/007-outreach-tenant-templates/quickstart.md`: `pnpm test` 482/482 verde, migração aplicada em dev, `pnpm --filter web build` OK, SC-001…SC-007 cobertos pelos testes. **Pendente (requer ambiente rodando com WAHA/LiteLLM): cenários manuais §3.1–§3.4**

---

## Dependencies & Execution Order

```text
Phase 1 (Setup) ──► Phase 2 (Foundational)
                        ├──► Phase 3 (US1 🎯) ──► Phase 8 (US5, com US3)
                        ├──► Phase 4 (US2) ──► Phase 5 (US3) ──┘
                        └──► Phase 6 (US4)
Phase 7 (US6) ── totalmente independente, qualquer momento
Final Phase (Polish) ── após todas as stories
```

- T003→T004 e T005→T006: testes antes da implementação (Constituição III)
- US1 precisa de T006 (compositor); US3 precisa de US2 (saudação degradada nos fallbacks) e T006; US4 precisa de T006; US5 precisa de US1 (T010) e US3 (T018/T020)
- US6 não depende de nada — paralelizável desde o início

## Parallel Opportunities

- **Entre fases**: US6 (T025–T027) em paralelo com todo o resto (arquivos exclusivos do web)
- **Dentro das fases**: T002/T003/T005 (arquivos distintos); T013 e T019; T021 e T028; T024 e T030 (frontend vs backend); T032/T033
- **Dois implementadores**: trilha backend (Phases 3→4→5→6→8) e trilha frontend (T024, T025–T027, T030–T031)

## Implementation Strategy

- **MVP**: Phases 1–3 (Setup + Foundational + US1) — elimina o vazamento de texto interno e cria o portão de aprovação; já entregável e testável isoladamente
- **Incremento 2**: US2 (saudação correta — fecha o "Olá NOVAURORA")
- **Incremento 3**: US3 + US4 (fallbacks seguros + saneamento do legado — zera recorrência em produção)
- **Incremento 4**: US6 (modal de risco, independente) e US5 + Polish (auditoria, métricas, validação final)
- Cada story termina com sua suíte de testes verde + `pnpm --filter web build` quando tocar o web

---

## Phase 10: Convergence

**Purpose**: Lacunas remanescentes identificadas pela auditoria spec/plan/tasks × código (2026-09-21).

- [X] T035 [US1] Bloquear aprovação de campanha retida: em `approveAiCampaign` (ai-campaign.js), rejeitar com `AiCampaignError('CAMPAIGN_REVIEW_REQUIRED', …, 409)` quando a campanha (email ou WhatsApp) tiver `needsReview: true` — aprovar é caminho de disparo e o BLOCKLIST não detecta eco de texto interno (FR-008, contradicts); adicionar teste em `test/ai-campaign.test.js` (draft IA poluída → retida pelo saneamento → approve 409; após `rederiveWhatsAppBase`/`rederiveEmailBase` → approve 200)
- [X] T036 [US3] Restaurar follow-up de email para campanhas IA: em `_scheduleFollowup` (outreach-workers.js), permitir sequência quando `contact.campaign.source === 'ai'` mesmo com `emailTemplateBody` semeado (follow-up volta a ser gerado por IA sobre a base aprovada — plan D4, partial); adicionar teste em `test/outreach-workers.test.js` (campanha IA → follow-up agendado; suíte manual com template → continua single-shot)
- [ ] T037 **Pós-deploy em PRODUÇÃO** (decisão do dono — não há ambiente dev/staging com WAHA/LiteLLM): executar os cenários do `quickstart.md` §3.1–§3.4 contra produção logo após o deploy — prévia→aprovação→disparo da campanha IA, saneamento das campanhas legadas (rodar `node scripts/sanitize-legacy-campaigns.js` / conferir boot), modal de risco na conexão WhatsApp (rede limpa ao cancelar) e auditoria `compositionOrigin` no histórico. Rollback de contingency: SANITIZE_LEGACY_CAMPAIGNS=off desliga a rotina de boot (missing — pendência de T034)
