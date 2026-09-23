---

description: "Task list para o Campaign Studio (010)"
---

# Tasks: Campaign Studio

**Input**: Design documents from `/specs/010-campaign-studio/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: OBRIGATÓRIOS — Constituição III ("Testes como porta de entrada",
não-negociável) e AGENTS.md. Em cada user story, a(s) suíte(s) de teste
vem(êm) **antes** das tarefas de implementação e devem falhar primeiro
(`pnpm test`).

**Organization**: Tarefas agrupadas por user story (US1–US14 da spec) para
implementação/teste/entrega independentes. Referências: contratos em
`specs/010-campaign-studio/contracts/rest-api.md` e `contracts/jobs-queues.md`;
modelos em `data-model.md`; cenários de validação em `quickstart.md` (C1–C7).

> **Revisão pós-análise** (remediação do `$speckit-analyze`): C1 guard-rails
> (US3: T035–T036, validação em T041); F1 importação de lista (US2: T028);
> F2 screenshot no compose (T047); F3 condicionais server-side no renderer
> (T053); I1 segment NL antecipado para a fase US9 (T091, rotulado [US14]);
> E1 política de conflito entre campanhas (T101); S1 asserção de latência do
> compose (T042); T1 rota `classify-replies` internalizada (contrato).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência de tarefa
  incompleta)
- **[Story]**: US a que pertence (apenas nas fases de user story)
- Caminhos absolutos do repo implícitos na raiz; paths exatos na descrição

## Path Conventions

Monorepo existente: backend Node na raiz (módulo `studio/`), SPA em
`apps/web/src/`, testes em `test/`. Nenhum serviço novo.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências, esqueleto do módulo `studio/`, rota `/studio` no
front e infraestrutura de build.

- [X] T001 Instalar dependências novas no workspace raiz (`@dnd-kit/core`, `@dnd-kit/sortable` em `apps/web/package.json`; `mjml`, `pdf-parse`, `mammoth` no `package.json` raiz) e registrar justificativa já existente em `specs/010-campaign-studio/research.md` D6–D8
- [X] T002 Atualizar `Dockerfile` para copiar o diretório `studio/` para a imagem do runtime (mesmo padrão do `discovery/`, commit a119e706)
- [X] T003 Criar esqueleto `studio/router.js` (Express Router) e montar em `server-prod.js` via `app.use('/api/studio', requireAuth, studioRouter)` seguindo o padrão de `adminRouter` (`server-prod.js:212`); todas as rotas com escopo de organização
- [X] T004 Implementar `studio/storage.js` para `STUDIO_STORAGE_DIR` (default `./.data/studio`, criação lazy, caminhos sanitizados) e adicionar a var em `.env.example`
- [X] T005 [P] Criar shell front `apps/web/src/studio/StudioApp.tsx` (layout dark forçado via `className="dark"`, nav interna própria) e renderizá-lo em `apps/web/src/App.tsx` quando `window.location.pathname` inicia com `/studio`, fora do shell de tabs
- [X] T006 Criar cliente API tipado `apps/web/src/studio/api.ts` + tipos `apps/web/src/studio/types.ts` (padrão `apps/web/src/services/api.ts`) com health/404 inicial
- [X] T007 Criar smoke test `test/studio-api.test.js`: sem auth → 401; com auth (fixture de org) → 404 JSON `{error}`; escopo de org isolado

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Modelos centrais, máquina de estados, variáveis e ponte de canal
— pré-requisito de TODAS as stories.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

- [X] T008 Migração Prisma (data-model.md): modelos `StudioCampaign`, `StudioSegment`, `StudioAudienceSnapshot`, `StudioAudienceMember`, `StudioContent` + colunas aditivas `studioCampaignId`, `guardrails`, `sequence` em `OutreachCampaign` e `studioCampaignId`/`guardrails` em `WhatsAppCampaign` (`prisma/schema.prisma`, via `pnpm run db:migrate`)
- [X] T009 Implementar máquina de estados em `studio/campaign-service.js`: estados e transições de `data-model.md` (`draft→in_review→approved→scheduled→running⇄paused→completed|cancelled|retained`), 409 `INVALID_TRANSITION`, trava de edição com fila ativa (`CAMPAIGN_LOCKED`) — funções puras testáveis
- [X] T010 Implementar `studio/variables.js`: catálogo fechado de variáveis (`{{firstName}}`, `{{companyName}}`, `{{city}}`, `{{industry}}`, `{{state}}`, `{{contactName}}`…) com validação de placeholder desconhecido (400 `UNKNOWN_VARIABLE`) e renderização com fallback configurável — **nunca** envia `{{var}}` literal (FR-033, SC-011)
- [X] T011 Implementar `studio/channel-bridge.js`: compila `StudioCampaign` + `StudioContent` em execuções de canal existentes (cria/atualiza `OutreachCampaign` e/ou `WhatsAppCampaign` com `studioCampaignId`, grava `OutreachContact` por membro do snapshot) — pesquisa D1
- [X] T012 [P] Endpoints CRUD de campanhas em `studio/router.js` (`POST/GET/PATCH /api/studio/campaigns`, `GET /:id`) conforme `contracts/rest-api.md`, com validação de enums e origem (`origin`) para auditoria (FR-030)
- [X] T013 [P] Esqueleto de views front: `apps/web/src/studio/views/CampaignsListView.tsx` (lista com status/origem) e `apps/web/src/studio/views/CampaignDetailView.tsx` (tabs: Conteúdo, Audiência, Agenda, Automação, Analytics — placeholders) consumindo `studio/api.ts`

---

## Phase 3: User Story 1 — Nenhum disparo sem revisão (P1)

**Goal**: Toda campanha nasce rascunho; revisão com prévia por lead, edição
inline, Compliance Guard mínimo e aprovação explícita que congela a
audiência; nada dispara sem isso (US1 da spec, FR-001–FR-007).

**Independent Test**: criar campanha manual com audiência manual
(prospectIds), revisar com amostra real, editar, aprovar → dispara imediato
pelos motores; tentar editar pós-run → `CAMPAIGN_LOCKED`; compliance `block`
impede approve.

- [X] T014 [US1] Criar `test/studio-approval-flow.test.js` (ANTES da implementação): transições válidas/inválidas; aprovar sem audiência → 409 `EMPTY_AUDIENCE`; aprovar 2× não duplica snapshot; compliance `block` → 409 `COMPLIANCE_BLOCKED`; edição pós-run bloqueada; estado `retained` exibido com motivo
- [X] T015 [US1] Implementar congelamento de audiência em `studio/campaign-service.js`: na aprovação cria `StudioAudienceSnapshot` + `StudioAudienceMember` (incluído/excluído + `excludeReason`) a partir da audiência declarada (manual nesta story; segmento na US2)
- [X] T016 [US1] Implementar motor de exclusões obrigatórias em `studio/compliance-service.js` (parte 1, determinística): `SuppressionList`, opt-out via `LeadChannelState`, contato recente por canal → `excludeReason` correto; inclusão manual de lead protegido → 400 `PROTECTED_LEAD` (FR-011/FR-012)
- [X] T017 [US1] Estender `studio/compliance-service.js` (parte 2): checks pré-aprovação — audiência > 0, placeholders resolvíveis com fallback, e-mail com mecanismo de descadastro, variável literal no corpo → parecer em `campaign.approval.complianceLevel` (`ok|attention|block`); `block` impede approve (FR-073 mínimo; profundidade LGPD/LLM na US12)
- [X] T018 [US1] Endpoints de fluxo em `studio/router.js`: `POST /:id/submit-review`, `POST /:id/approve`, `POST /:id/control` (ação `pause|resume|cancel`), `POST /:id/require-review` — contratos em `contracts/rest-api.md`; approve grava `approvedById/approvedAt` e chama `channel-bridge` + `startOutreachCampaign`/equivalente WhatsApp para disparo imediato
- [X] T019 [US1] Endpoint de fila `GET /:id/queue` (status por lead, motivo de retenção) — leitura de `OutreachContact`/`WhatsAppCampaignContact` via `studioCampaignId`
- [X] T020 [US1] Front `apps/web/src/studio/components/CampaignReview.tsx`: prévia por canal + amostra de mensagens para leads reais da audiência, edição inline com `editHistory` (FR-004/FR-005), botões Revisar/Aprovar/Exigir revisão, banner de estado `retained` com motivo
- [X] T021 [US1] Front `apps/web/src/studio/components/AudienceReview.tsx`: contagens, excluídos com motivo, exclusão manual (exceto protegidos) consumindo audiência da campanha
- [X] T022 [US1] Wire-up front dos endpoints de fluxo em `apps/web/src/studio/api.ts` + estados visíveis no `CampaignDetailView` (FR-007)
- [X] T023 [US1] Validar cenário C1 (parte manual/imediata) do `quickstart.md`; `pnpm test` verde incluindo regressão das suítes existentes

---

## Phase 4: User Story 2 — Audiência explícita: segmentos salvos (P1)

**Goal**: Segmentos salvos com critérios estruturados sobre o catálogo
fechado, contagem/preview < 2s, reuso com delta, importação de lista e
audiência por segmento (US2 da spec, FR-008–FR-013, FR-010; NL fica na US14,
implementada antecipadamente na fase US9 — ver T091).

**Independent Test**: criar segmento com 2+ critérios → contagem e amostra;
usar em campanha; importar lista colada de CNPJs → resolvida contra a org
com `unmatched` reportado; excluídos com motivo; reuso mostra delta de
tamanho.

- [X] T024 [US2] Criar `test/studio-segments.test.js` (antes da implementação): critérios → contagem com fixtures (setor/estado/score); campo/op fora do catálogo → 400 `INVALID_CRITERIA_FIELD`; grupos AND/OR; exclusões obrigatórias marcadas no preview; delta entre `lastCount`; **importação de lista** (CNPJs/e-mails → prospects da org, dedupe, `unmatched` para não encontrados)
- [X] T025 [US2] Implementar `studio/segment-service.js`: documento `criteria` versionado → query Prisma com whitelist de campos/ops (catálogo de `data-model.md`: industry, city, state, region derivada, revenueEstimate, employees, opportunityScore, verdict, status, enrichmentStatus, creditRiskScore, lastContact, contactedChannels, CNAE quando disponível, createdAt) + resolução de listas (CNPJ/e-mail → prospectId, case/normalização de CNPJ) — pesquisa D3
- [X] T026 [US2] Endpoints em `studio/router.js`: `POST/GET/PATCH/DELETE /api/studio/segments`, `POST /:id/preview` (contagem + amostra 50 + distribuição), `POST /api/studio/campaigns/:id/audience` (por segmento, manual **ou lista** com `unmatched`) — contratos em `contracts/rest-api.md`
- [X] T027 [US2] Delta de reuso: `lastCount/lastCountAt` em `StudioSegment` atualizado no preview; endpoint retorna variação vs. último uso (FR-009)
- [X] T028 [US2] Importação de lista (FR-010): aceitar `list` colada **ou** arquivo (CSV/txt) no `POST /:id/audience`, resolução via `segment-service.js`, retorno `{matched, unmatched}` com motivo; nunca cria prospects novos na importação de audiência (isso é fluxo de importação existente)
- [X] T029 [US2] Front `apps/web/src/studio/components/SegmentBuilder.tsx`: editor de grupos AND/OR sobre catálogo (chips com campos/ops), preview com contagem em tempo real, salvar/nomear, indicação de delta, aba "colar lista" com resultado matched/unmatched (US2)
- [X] T030 [US2] Integrar segmentos e importação no `AudienceReview.tsx` (seleção de segmento salvo + contagem prévia) e validar prévia de audiência congelada no fluxo C1 do `quickstart.md`; `pnpm test` verde
- [X] T031 [P] [US2] Índices/medição: verificar plano de consulta da contagem com 50k fixtures e registrar resultado no PR (meta < 2s p95 — SC-010)

---

## Phase 5: User Story 3 — Agendamento, janelas e guard-rails (P1)

**Goal**: Agendamento futuro, janelas por dia/hora com fuso, limites por
hora/dia, previsão de conclusão, controle de fila, pausa fora da janela e
**guard-rails da automação opt-in** (US3 da spec, FR-016–FR-022, FR-079 e a
exceção de FR-003 decidida no clarify — apreciação do primeiro lote, pausa
por anomalia, retomada humana).

**Independent Test**: agendar amanhã 9h–12h com 5/h → nada envia antes;
dentro da janela respeita ritmo; 12h pausa com motivo; retoma sozinha;
cancelamento preserva enviados. Automação opt-in adotada pelo Studio exige
aprovação do 1º lote; pico de bounce simulado → pausa com motivo + notificação,
retomada só com ação humana (C6).

- [X] T032 [US3] Criar `test/studio-scheduler.test.js` (antes da implementação): janela fechada não enfileira; cota horária/diária respeitada; fuso da org vs. `useLeadTimezone`; previsão de conclusão; pausa/retomada/cancelamento; follow-ups simples (`sequence`) agendam toque seguinte dentro da janela; **conflito entre campanhas** sobre o mesmo lead aplica `fallbackPolicy.campaignConflict` (`postpone|priority|block`)
- [X] T033 [US3] Implementar `studio/schedule-service.js`: validação de `schedule` (windows, limites, timezone), cálculo de "dentro da janela" por lead (fuso org ou lead), previsão de conclusão (audiência restante ÷ ritmo × mapa de janelas) — FR-016/017/020/022
- [X] T034 [US3] Implementar worker `studio/scheduler-worker.js` (BullMQ repeat 60s, job id `studio:sched:{campaignId}:{bucket}`): varre campanhas `scheduled|running`, re-checa supressão/opt-out/fadiga e enfileira lotes nos motores via `channel-bridge` respeitando cotas de campanha e rate limiters globais por conta (`outreach-rate-limiter.js`, `whatsapp-rate-limiter.js`) — pesquisa D5, contratos `jobs-queues.md`
- [X] T035 [US3] Criar `test/studio-guardrails.test.js` (antes da implementação): automação opt-in (`trigger=on_enrichment` adotada pelo Studio) **não libera o 2º lote sem `firstBatchApprovedAt`**; aprovação do 1º lote com amostra real de mensagens; anomalia simulada (pico de bounce/opt-out acima do limiar por canal) → `paused` com `anomalyPausedAt/anomalyReason` + notificação; retomada exige ação humana; `require-review` força aprovação do lote seguinte
- [X] T036 [US3] Implementar `studio/guardrails.js` + integração no `scheduler-worker.js` e `campaign-service.js`: avaliação pós-lote de anomalias (limiares por canal configuráveis via env), primeira liberação de automação com amostra para aprovação (estados em `guardrails` Json das execuções de canal, `data-model.md`), pausa/retomada com motivo — decisão de clarify Q1, pesquisa D2 (FR-003, exceção de guard-rails)
- [X] T037 [US3] Endpoints em `studio/router.js`: `POST /:id/schedule` (com `forecast` na resposta), `POST /:id/control` ação `pace`, `GET /:id/queue` enriquecido com motivo de retenção (`outside_window|quota|fatigue|anomaly|first_batch_pending`), `POST /:id/approve-first-batch` (amostra do guard-rails)
- [X] T038 [US3] Follow-ups simples (FR-079): `sequence` da campanha (`[{stepIndex, delayDays, condition, maxTouch}]`) alimenta `StudioContent.kind=followup` e o agendamento do toque seguinte pelo scheduler; worker de follow-up existente mantém fallback `[3,5,7]` quando `sequence` vazio
- [X] T039 [US3] Front `apps/web/src/studio/views/ScheduleView.tsx`: agendamento com data/hora/fuso, janelas visuais por dia, limites h/d, previsão de conclusão, controles pausar/retomar/ritmo/cancelar com confirmação, fila por lead com motivos, painel de guard-rails da automação (aprovar 1º lote com amostra, banner de anomalia) (FR-021)
- [X] T040 [US3] Métricas prom-client do scheduler (`studio_scheduler_ticks_total`, `studio_sends_enqueued_total`) e logs estruturados sem PII — `contracts/jobs-queues.md`
- [X] T041 [US3] Validar cenários C1 completo **e C6 (guard-rails)** do `quickstart.md`; `pnpm test` verde

---

## Phase 6: User Story 4 — Criação por IA: material, URL ou prompt (P2)

**Goal**: Upload/URL/prompt → extração confirmada → pacote de campanha
multicanal com ≥2 tons, caindo em revisão (US4 da spec, FR-023–FR-030).

**Independent Test**: PDF fictício → extração → confirmar → compor 2 tons →
e-mail ≠ WhatsApp em revisão, nada dispara; URL ilegível → erro explicável.

- [X] T042 [US4] Criar `test/studio-materials.test.js` (antes da implementação): extração de PDF/DOCX fixture; URL inacessível → `extractionError`; vídeo → `needs_manual`; confirmação obrigatória antes de compor; compose gera ≥2 variantes por canal em `in_review`; **asserção de latência**: duração total do compose (com mock LLM) registrada e sob teto de regressão (SC-005)
- [X] T043 [US4] Migração Prisma: modelo `StudioMaterial` (`prisma/schema.prisma`, `data-model.md`)
- [X] T044 [US4] Implementar `studio/material-service.js`: upload (multipart, limites por plano), metadados + storage em `studio/storage.js`; extração PDF (`pdf-parse`), DOCX (`mammoth`), PPTX (unzip+XML local), URL (fetch+texto), prompt direto, `company_data` via `org-context.js` — pesquisa D8
- [X] T045 [US4] Implementar `studio/ai/extract.js` sobre `llm-client.js` (jsonMode + `parseJsonLoose`): `{product, offer, benefits, audience, cta, confidence}`; imagem via modelo multimodal se configurado, senão `needs_manual` — pesquisa D9
- [X] T046 [US4] Implementar fila `studio:ai-batch` (`contracts/jobs-queues.md`: job ids `studio:ai:*`, contadores Redis de progresso) genérica para gerações em lote (usada por compose aqui e por personalize na US7)
- [X] T047 [US4] Implementar `studio/ai/compose.js`: pacote completo (título, assunto, preheader, corpo e-mail em `emailDoc`, mensagem WhatsApp, LinkedIn text, segmento sugerido, timing) com N tons/variantes → cria `StudioContent` por canal/variante e campanha em `in_review` (FR-025/026); **aceita imagem de referência (captura de tela/design) quando modelo multimodal configurado**, com degradação explícita `needs_manual` caso contrário (FR-032)
- [X] T048 [US4] Endpoints em `studio/router.js`: `POST /api/studio/materials` (multipart/url/prompt), `POST /:id/extract` `[premium][quota]`, `POST /:id/confirm`, `POST /api/studio/campaigns/:id/compose` `[premium][quota]` (202 + polling) — gating via `plan.js`/cota Redis (D13)
- [X] T049 [US4] Front wizard em `apps/web/src/studio/views/CampaignDetailView.tsx` (aba Criar com IA): upload/URL/prompt, revisão da extração editável, seleção de tons, comparação lado a lado de variantes, escolha e edição (US4)
- [X] T050 [US4] Variação de campanha existente: `duplicateOf` em `POST /campaigns` + re-compose com novo foco/tom como rascunho vinculado, original intocada (FR-028)
- [X] T051 [US4] Validar cenário C2 do `quickstart.md`; `pnpm test` verde

---

## Phase 7: User Story 5 — Email Studio (P2)

**Goal**: Editor drag-and-drop completo, render MJML com preview ≡ envio,
geradores IA, checks (spam/links), UTM, banco de templates, geração de
imagens (US5 da spec, FR-031–FR-039).

**Independent Test**: template → editor DnD (blocos, colunas, resize) →
variáveis com fallback → 3 assuntos IA → checks apontam spam/links → preview
desktop/mobile → UTM aplicada.

- [X] T052 [US5] Criar `test/studio-email-renderer.test.js` (antes da implementação): documento de blocos → MJML → HTML responsivo com CSS inline; preview igual ao render de envio (mesma função); variável sem dado → fallback, nunca literal; **blocos condicionais/dinâmicos resolvidos por lead no render**; UTM anexada aos links
- [X] T053 [US5] Implementar `studio/email-renderer.js` (MJML server-side, pesquisa D7): blocos (texto, imagem, botão, separador, colunas com resize) → MJML → HTML; **avaliação server-side de blocos condicionais/dinâmicos por lead no momento do envio, com a MESMA função usada no preview** (FR-034, SC-006); render também usado no envio (channel-bridge injeta htmlBody)
- [X] T054 [US5] Endpoint `GET /api/studio/campaigns/:id/contents/:contentId/preview` (desktop/mobile) em `studio/router.js` usando o **mesmo** renderer do envio (SC-006)
- [X] T055 [US5] Editor front `apps/web/src/studio/components/EmailEditor.tsx` com `@dnd-kit`: canvas com blocos livres, colunas, redimensionamento, salvamento automático em `emailDoc` (FR-031); UI de blocos condicionais/dinâmicos por segmento (FR-034)
- [X] T056 [US5] Implementar `studio/ai/write.js` (`llm-client.js`): sugestões de assunto/preheader/CTA (n sugestões), rewrite (`improve|shorten|tone|proofread`) — FR-035
- [X] T057 [US5] Endpoints `POST /:id/rewrite` `[premium][quota]` e `POST /:id/suggest` em `studio/router.js` consumindo `ai/write.js`
- [X] T058 [US5] Checks em `studio/compliance-service.js` (parte 3): score de spam com motivos (heurísticas + LLM opcional), verificador de links (quebrados/encurtadores), acessibilidade mínima (alt, contraste de texto) — endpoint `POST /:id/checks` (FR-036)
- [X] T059 [US5] UTM automática: `utmTemplate` da campanha aplicada pelo `email-renderer.js` no envio e no preview; endpoint `POST /:id/apply-utm` (FR-037)
- [X] T060 [US5] Banco de templates (mínimo da US5; CRUD completo na US13): modelos `StudioTemplate` `isSystem` semeadores por objetivo em `studio/template-service.js` + endpoint `GET /api/studio/templates?objective=` aplicável como ponto de partida (FR-038)
- [X] T061 [US5] Geração de imagens `[premium][quota]` atrás de config de modelo de imagem (`llm-client.js`); sem modelo configurado → UI explica e oferece upload (FR-039, degradação explícita)
- [X] T062 [US5] Validar cenário C5 (checks/preview) do `quickstart.md`; `pnpm test` verde

---

## Phase 8: User Story 6 — WhatsApp Studio (P2)

**Goal**: Geração/conversão e-mail→WA, templates Meta-compatíveis, preview
realista, sequências, fallbacks comportamentais e classificação de respostas
(US6 da spec, FR-040–FR-046).

**Independent Test**: e-mail → versão WA curta com CTA em preview realista;
sequência 2 toques cancela toque 2 se responder; fallback "abriu sem clicar"
enfileira WA; resposta de opt-out suspende tudo.

- [X] T063 [US6] Criar `test/studio-reply-classification.test.js` (antes da implementação): respostas fixture → labels (`interested|not_interested|doubt|meeting_request|opt_out|out_of_scope`) com mock LLM; `opt_out` propaga para `LeadChannelState`+supressão e pausa toques; baixa confiança → `needsHumanReview`
- [X] T064 [US6] Migração Prisma: modelo `StudioReplyClassification` (`data-model.md`)
- [X] T065 [US6] Implementar `studio/ai/classify-reply.js` sobre `llm-client.js` + hook no fluxo de resposta existente (Gmail sync em `outreach-workers.js`, webhook WAHA em `whatsapp-workers.js`) gravando classificação sem alterar contratos (aditivo); reprocesso manual via job de fila `studio:reclassify` (sem rota pública — ver contrato) — FR-045
- [X] T066 [US6] Validação de conteúdo WA em `studio/channel-bridge.js`: botões/CTA válidos, mídia referenciada, template no **formato Meta** (categoria, variáveis posicionais) — `whatsappMeta` (FR-041/042); validação de placeholders com `variables.js`
- [X] T067 [US6] Conversão e-mail→WA e sequências: `ai/compose.js` (ou `ai/write.js`) gera versão curta por canal; sequência via steps existentes (`WhatsAppSequenceStep`) compilados de `StudioContent` `stepIndex>1` — FR-040/043
- [X] T068 [US6] Fallbacks comportamentais no `studio/scheduler-worker.js` + helper de comportamento (opens/clicks/replies por lead a partir de eventos existentes): condições `opened_no_click`, `clicked_no_reply`, `email_failed` → enfileira WA respeitando janela/ritmo (FR-044)
- [X] T069 [US6] Front `apps/web/src/studio/components/WhatsAppPreview.tsx`: preview realista da conversa (bolhas, botões, mídia, variáveis resolvidas com dados de lead real) (FR-041)
- [X] T070 [US6] Integração da classificação no inbox WhatsApp existente (`apps/web` WhatsAppView): badge de label + fila de revisão humana de baixa confiança (FR-045)
- [X] T071 [US6] Validar cenário C4 (parte WA) do `quickstart.md`; `pnpm test` verde

---

## Phase 9: User Story 7 — Personalização com IA por lead (P2)

**Goal**: Copy única por empresa com dados do B2Base, níveis, lote com
progresso, preview de amostra, edição por lead/regra (US7 da spec,
FR-047–FR-051).

**Independent Test**: 10 leads de 3 setores → intros corretas por setor; lead
sem dados → `base_fallback` sinalizado; editar 1 não muda os demais.

- [X] T072 [US7] Criar `test/studio-personalization.test.js` (antes da implementação): geração em lote com mock LLM usando somente dados existentes (`dataBasis` preenchido); fallback para lead sem dados; edição por lead isolada; `propagate` cria regra; preview == render de envio
- [X] T073 [US7] Migração Prisma: modelo `StudioPersonalization` (`data-model.md`)
- [X] T074 [US7] Implementar `studio/ai/personalize.js`: níveis (`greeting|intro|full`), prompts com pilares (`org-context.js` + proposta + dados do lead — enriquecimento/análise/engajamento), saída com `dataBasis` auditável, `base_fallback` quando dados insuficientes — FR-047/FR-051, pesquisa D9
- [X] T075 [US7] Lote na fila `studio:ai-batch`: job `studio:ai:{contentId}:{prospectId}`, progresso Redis `studio:batch:{batchId}` (done/total/paused), pausa mid-batch, item com falha não aborta o lote (FR-048)
- [X] T076 [US7] Endpoints em `studio/router.js`: `POST /:id/personalize` `[premium][quota]` (202 batchId), `GET /personalization/:batchId`, `POST .../pause`, `GET /:id/personalization-preview?sample=10`, `PATCH /personalization/:contentId/:prospectId` (com `propagate`) — `contracts/rest-api.md`
- [X] T077 [US7] Front `apps/web/src/studio/components/PersonalizationPanel.tsx`: seletor de nível, progresso/pausa, grade de preview por lead com status, edição inline por lead, botão propagar regra (FR-049/050)
- [X] T078 [US7] Ponto de extensão no `channel-bridge.js`: no envio, mensagem do lead resolve overrides de `StudioPersonalization` (edited > generated > base) — garante preview ≡ envio
- [X] T079 [US7] Validar cenário C3 do `quickstart.md`; `pnpm test` verde

---

## Phase 10: User Story 8 — Automação: journeys (P3)

**Goal**: Canvas de journeys com blocos/condições/paradas, gatilhos
(incl. webhook), campanhas recorrentes e stats por bloco (US8 da spec,
FR-052–FR-056).

**Independent Test**: e-mail→wait→abriu?→WA→resposta para; ramos corretos
com fixtures; webhook inicia para lead da org; recorrência recalcula
audiência com salvaguardas.

- [X] T080 [US8] Criar `test/studio-journey.test.js` (antes da implementação): validação estrutural do grafo (ciclo sem wait → erro; branch sem fim → erro); transição de blocos com fixtures; parada global por resposta/conversão/opt-out em todos os canais; webhook autenticado (token válido/inválido, lead de outra org → 202 sem efeito); stats por bloco
- [X] T081 [US8] Migração Prisma: modelos `StudioJourney` + `StudioJourneyLead` (`data-model.md`)
- [X] T082 [US8] Implementar `studio/journey-engine.js`: validação do grafo (`definition`), avaliação de condições (comportamento real via eventos, score, atributos), waits (`waitingUntil`), paradas globais — worker `studio:journey` com job ids `studio:journey:{journeyId}:{prospectId}:{blockId}` idempotentes — `contracts/jobs-queues.md`
- [X] T083 [US8] Gatilhos: `segment_enter` (re-check agendado via `segment-service`), `behavior` (open/click/reply), `score_threshold`, `webhook` — registro na timeline do lead (FR-054)
- [X] T084 [US8] Webhook externo: geração/revogação de token (SHA-256 no banco, comparação tempo constante), endpoint `POST /api/studio/journeys/:id/webhook/:token` (202 sempre, rate limit Redis por token) — `contracts/jobs-queues.md`, pesquisa D15
- [X] T085 [US8] Campanhas recorrentes/por data (reativação, aniversário, nurturing, abandono): modo `recurring` no schedule, `POST /:id/audience/sync-delta` `[premium]` criando novo snapshot marcado `superseded`, salvaguardas completas no recálculo (FR-055)
- [X] T086 [US8] Endpoint `GET /api/studio/journeys/:id/stats` (por bloco: entered/waiting/done/stopped) (FR-056)
- [X] T087 [US8] Front `apps/web/src/studio/components/JourneyCanvas.tsx` com `@xyflow/react`: blocos (envio, espera, condição, update, fim) com config por painel, validação visual, stats por bloco (US8)
- [X] T088 [US8] Métricas `studio_journey_leads_by_block` + logs; validar cenário C4 do `quickstart.md`; `pnpm test` verde

---

## Phase 11: User Story 9 — AI Campaign Agent (P3)

**Goal**: Objetivo em linguagem natural → plano completo item a item, ativação
só com aprovação humana, sugestões pós-disparo (US9 da spec, FR-057–FR-059).

**Independent Test**: prompt → plano (audiência/estratégia/conteúdos/timing)
editável; rejeitar audiência e aprovar → campanha `in_review`, nunca ativa;
sugestão pós-disparo exige decisão humana.

> Nota: T091 é rotulado [US14] (o requisito FR-014 pertence à US14) mas vive
> nesta fase por dependência do agente — remediação I1 do `$speckit-analyze`.

- [X] T089 [US9] Criar `test/studio-agent.test.js` (antes da implementação): proposta com mock LLM contém audiência/estratégia/conteúdos; decisão item a item; convert cria campanha `origin=agent` em `in_review` sem disparar; recomendação `requiresConfirmation` não aplica sem `confirm`
- [X] T090 [US9] Migração Prisma: modelos `StudioAgentProposal` + `StudioRecommendation` (`data-model.md`)
- [X] T091 [US14] (antecipada — dependência do US9) Implementar `studio/ai/segment-nl.js` (LLM → mesmo `criteria` fechado de `segment-service.js` + explicação por condição, nunca SQL) + endpoint `POST /api/studio/segments/preview-nl` `[premium][quota]` em `studio/router.js` + caso de teste em `test/studio-segments.test.js` — FR-014, pesquisa D3
- [X] T092 [US9] Implementar `studio/agent-service.js`: orquestra NL de audiência (T091) + `ai/compose.js` + sugestão de schedule → `StudioAgentProposal.plan`; conversão com decisões dos itens — FR-057/FR-058
- [X] T093 [US9] Endpoints em `studio/router.js`: `POST /agent/propose` `[premium][quota]` (202), `GET /agent/proposals/:id`, `POST /agent/proposals/:id/decide` — `contracts/rest-api.md`
- [X] T094 [US9] Loop de monitoramento: recomendações de `studio/recommendations` geradas por thresholds (performance por segmento, pacing) com `rationale`+`evidence`, aplicáveis só com decisão humana — FR-059
- [X] T095 [US9] Front `apps/web/src/studio/components/AgentPanel.tsx`: chat do pedido, plano com aceitar/editar/rejeitar por item, progresso, lista de sugestões pendentes (US9)
- [X] T096 [US9] Validar fluxo do Independent Test no `quickstart.md`; `pnpm test` verde

---

## Phase 12: User Story 10 — Experimentação e otimização (P3)

**Goal**: A/B de assunto/copy/CTA/horário/canal com divisão determinística,
vencedor por critério, otimização contínua opcional e fadiga (US10 da spec,
FR-060–FR-063).

**Independent Test**: A/B 20/80 → divisão estável; vencedor declarado pelo
critério com basis; otimização off mantém split; fadiga adia/bloqueia toque.

- [X] T097 [US10] Criar `test/studio-experiments.test.js` (antes da implementação): hash determinístico (`sha256(campaign:prospect:experiment)`) com pesos 20/80 estável entre execuções; declaração por critério (métrica, mínimo, confiança — teste de duas proporções local); contínua off → split estático; política de fadiga `postpone|skip` registrada
- [X] T098 [US10] Migração Prisma: modelo `StudioExperiment` (`data-model.md`)
- [X] T099 [US10] Implementar `studio/experiment-service.js`: divisão no congelamento (integração no snapshot da US1: `variantLabel`), agregação por variante direto dos eventos existentes, critério de vencedor com teste de duas proporções (sem lib externa — pesquisa D10), declaração + basis (FR-060/061)
- [X] T100 [US10] Otimização contínua opcional: ajuste de pesos por janela de avaliação com registro em `StudioRecommendation`/timeline; off por default (FR-062)
- [X] T101 [US10] Fadiga e conflito: detector de fadiga (N toques em Y dias sobre eventos existentes) + política da campanha (`postpone|skip`) aplicada no `scheduler-worker.js` com motivo na fila; **avaliação da `fallbackPolicy.campaignConflict` quando duas campanhas disputam o mesmo lead** (`postpone|priority|block`, decisão registrada) — FR-063 + edge case da spec
- [X] T102 [US10] Endpoints em `studio/router.js`: `POST /:id/experiments`, `GET /experiments/:id`, `POST /experiments/:id/declare-winner` — `contracts/rest-api.md`
- [X] T103 [US10] Front `apps/web/src/studio/components/ExperimentPanel.tsx`: criação (dimensão/split/critério), métricas por variante, status do critério, toggle de otimização contínua (US10)
- [X] T104 [US10] Validar cenário C5 (parte A/B) do `quickstart.md`; `pnpm test` verde

---

## Phase 13: User Story 11 — Analytics (P3)

**Goal**: Dashboard por campanha com funil, cortes, timeline do lead,
métricas estimadas rotuladas, ROI declarado vs. medido, visão consolidada
(US11 da spec, FR-064–FR-069).

**Independent Test**: interações simuladas refletem no funil em ≤5min; corte
por segmento recalcula; timeline multi-canal ordenada; ROI distingue
declarado/medido.

- [X] T105 [US11] Criar `test/studio-analytics.test.js` (antes da implementação): rollup idempotente (`@@unique` upsert) a partir de eventos fixture; funil com flags `estimated`; cortes por segmento/estado/canal/variante; timeline agregada ordenada; ROI `declared` vs `measured`; overview consolidado
- [X] T106 [US11] Migração Prisma: modelo `StudioMetricDaily` (`data-model.md`)
- [X] T107 [US11] Implementar `studio/analytics-service.js` + worker `studio:metrics` (repeat 5min, upsert idempotente) — `contracts/jobs-queues.md`, pesquisa D11
- [X] T108 [US11] Endpoints em `studio/router.js`: `GET /:id/analytics` (funil+cortes+ROI), `GET /:id/analytics/daily`, `GET /api/studio/prospects/:id/timeline`, `GET /api/studio/overview` — `contracts/rest-api.md`
- [X] T109 [US11] Métrica `studio_queue_wait_seconds` (histograma agendado→enviado) no `scheduler-worker.js` — `contracts/jobs-queues.md`
- [X] T110 [US11] Front `apps/web/src/studio/views/AnalyticsView.tsx` com recharts: funil, séries diárias, cortes (segmento/setor/região/canal/toque), timeline do lead, badges "estimado", ROI (FR-064–FR-068)
- [X] T111 [US11] Visão consolidada front (Overview no StudioApp) com comparativo de campanhas (FR-069)
- [X] T112 [US11] Validar cenário C5 completo do `quickstart.md`; `pnpm test` verde

---

## Phase 14: User Story 12 — Marca e conformidade (P4)

**Goal**: Brand Voice aprendida + Brand Kit + verificador de consistência +
Compliance Guard completo (LGPD/consentimento/spam) com bloqueio real (US12
da spec, FR-070–FR-073).

**Independent Test**: voz configurada → desvio apontado com sugestão; kit
aplicado no e-mail gerado; sem descadastro → `block` impede aprovação; leads
sem base legal contados no parecer.

- [X] T113 [US12] Criar `test/studio-compliance.test.js` e `test/studio-brand.test.js` (antes da implementação): checks LGPD/consentimento/descadastro/spam/data sensível com níveis `ok|attention|block`; `block` trava approve (estende suíte US1); aprendizado de voz a partir de samples (mock LLM) com exemplos do/dont; consistência aponta trecho+motivo+sugestão
- [X] T114 [US12] Migração Prisma: modelos `StudioBrandProfile` + `StudioComplianceReview` (`data-model.md`)
- [X] T115 [US12] Implementar `studio/brand-service.js`: `learn` de materiais/campanhas/samples → `voice` (doExamples/dontExamples/learnedFrom), kit (logo/cores/fontes), diretriz injetada nos prompts de `ai/*` — FR-070/071, pesquisa D9
- [X] T116 [US12] Verificador de consistência em `studio/brand-service.js` (LLM): trecho desviante + motivo + sugestão reescrita; endpoint `POST /:id/brand-check` `[premium]` (FR-072)
- [X] T117 [US12] Compliance Guard completo em `studio/compliance-service.js`: consentimento/base legal por lead (fonte: estado do lead + supressão + engajamento), LGPD (finalidade comercial B2B), mecanismo de descadastro, risco de spam/banimento por canal (LLM + heurísticas), dados sensíveis → parecer persistido em `StudioComplianceReview` com `affectedLeads` (FR-073)
- [X] T118 [US12] Aplicar kit por default no `ai/compose.js` e no `email-renderer.js` (logo/cores/fontes quando configurados) (FR-071)
- [X] T119 [US12] Endpoints `GET/PUT /api/studio/brand`, `POST /brand/learn` `[premium]`, `GET/POST /:id/compliance` em `studio/router.js`; bloqueio `block` vigente no approve (já plumbado na US1, validar) — FR-073
- [X] T120 [US12] Front `apps/web/src/studio/components/BrandSettings.tsx` (voz com exemplos, kit com preview) + painel de parecer de compliance no `CampaignReview.tsx` (itens, níveis, leads afetados)
- [X] T121 [US12] Validar cenário C7 (gating) e parte de compliance do C1 do `quickstart.md`; `pnpm test` verde

---

## Phase 15: User Story 13 — Biblioteca: templates, reuso e funil (P4)

**Goal**: Biblioteca por objetivo/estágio, duplicar/adaptar/traduzir com
original intocada (US13 da spec, FR-028/FR-038, US13).

**Independent Test**: duplicar + adaptar tom + traduzir EN → variáveis e
links preservados; original inalterada; estágio do funil filtra templates.

- [X] T122 [US13] Criar `test/studio-templates.test.js` (antes da implementação): CRUD; sementes do sistema por objetivo/estágio; duplicação cria rascunho vinculado (`sourceCampaignId`) sem alterar original; tradução preserva placeholders e links (mock LLM) e nasce em revisão
- [X] T123 [US13] Implementar `studio/template-service.js` completo (CRUD, sementes `isSystem` por objetivo/estágio, `POST /templates/seed` admin) — FR-038
- [X] T124 [US13] Implementar `studio/ai/translate.js`: tradução/adaptação preservando `{{variáveis}}` e links funcionais; endpoint `POST /contents/:contentId/translate` `[premium][quota]` (US13/FR-028)
- [X] T125 [US13] Endpoints CRUD `GET/POST/PATCH/DELETE /api/studio/templates` + filtro por `objective`/`funnelStage` em `studio/router.js`
- [X] T126 [US13] Front `apps/web/src/studio/views/LibraryView.tsx`: templates por objetivo/estágio, campanhas passadas reutilizáveis (duplicar/adaptar/traduzir), badge de vínculo com original (US13)
- [X] T127 [US13] Validar cenário de reuso do `quickstart.md` (US13); `pnpm test` verde

---

## Phase 16: User Story 14 — Diferenciais de IA avançados (P4)

**Goal**: Lookalike, follow-up generator, next best action, handoff, analista
de campanha (US14 da spec, FR-015/FR-075–FR-078). O construtor de segmentos
por NL (FR-014, também da US14) foi **antecipado para a fase US9 (T091)** por
dependência do agente.

**Independent Test**: lookalike explica atributos; resposta "interessado em
reunião" → handoff cria registro com contexto mediante confirmação; pergunta
de performance → diagnóstico com evidências.

- [X] T128 [US14] Criar `test/studio-advanced-ai.test.js` (antes da implementação, mock LLM): lookalike a partir de convertidos com atributos-base explicados; follow-up gerado cita interação real; next best action com `evidence`; analista responde com dados da campanha
- [X] T129 [US14] Lookalike: `studio/segment-service.js` (extensão) — atributos dominantes de leads convertidos/engajados → `criteria` revisáveis + endpoint `POST /api/studio/segments/lookalike` `[premium]` — FR-015
- [X] T130 [US14] Follow-up generator: `studio/ai/write.js` (extensão) gera follow-up baseado na interação anterior real (abriu/clicou/respondeu/silencioso) — FR-078
- [X] T131 [US14] Next best action + handoff: recomendações `next_best_action` por lead em `StudioRecommendation` com `evidence`; handoff por intenção de compra (label `meeting_request`/`interested` + regra) cria `Activity` da org com contexto da conversa, `requiresConfirmation` respeitado — FR-075/FR-076
- [X] T132 [US14] Analista: `studio/ai/analyze.js` (Q&A com evidências dos dados de analytics) + endpoint `POST /:id/ask` `[premium][quota]` — FR-077
- [X] T133 [US14] Front: botão lookalike no `SegmentBuilder.tsx`, cards de next best action no lead, chat do analista no `AnalyticsView.tsx` (o campo NL do SegmentBuilder foi entregue em T091) (US14)
- [X] T134 [US14] Validar cenário do Independent Test no `quickstart.md`; `pnpm test` verde

---

## Phase 17: Polish & Cross-Cutting

**Purpose**: Observabilidade completa, seeds, regressão e validação final.

- [X] T135 Completar métricas prom-client restantes (`studio_ai_batch_items_total`, `studio_guardrail_pauses_total`, `studio_compliance_reviews_total`) e expor em `/metrics` — `contracts/jobs-queues.md`
- [X] T136 Auditoria de logs estruturados (JSON, sem PII além do padrão atual) em todos os módulos `studio/` — constituição VII
- [X] T137 Notificações operacionais (in-app via `OpsNotification` + e-mail opt-in): `paused_anomaly`, `queue_error`, `awaiting_approval`, `experiment.winner` — `contracts/jobs-queues.md`
- [X] T138 [P] Purga de snapshots `superseded` > 90 dias (job repeat, low priority) — `data-model.md` (índices e volume)
- [X] T139 Regressão completa: `pnpm test` (todas as suítes existentes + `studio-*`), `pnpm --filter web build`, `pnpm run db:migrate` limpo de staging; validar `pnpm run docker:build` com `studio/` na imagem
- [ ] T140 Executar validação final `quickstart.md` C1–C7 ponta a ponta em ambiente de staging e registrar resultado no PR

---

## Dependencies & Execution Order

```text
Phase 1 (Setup) → Phase 2 (Foundational)
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
   US1 (P1) ──────► US2 (P1) ──────► US3 (P1)   ← MVP: C1 + C6 completos
        │
        ├──► US4 (P2) ──► US5 (P2) ──► US6 (P2) ──► US7 (P2)
        │         (US5 depende de US4 só para "criar com IA";
        │          editor/checks são independentes → pode paralelizar)
        └──► US8 (P3) ──► US9 (P3) ──► US10 (P3) ──► US11 (P3)
                  │                                   ▲
                  └──► US12 (P4) ──► US13 (P4) ──► US14 (P4)
                                                       (US14 usa US11 analytics)
Phase 17 (Polish) por último.
```

- **US1 → US2 → US3**: núcleo sequencial (audiência congela na aprovação da
  US1; segmentos da US2 alimentam a audiência; agenda + guard-rails da US3
  fecham o MVP com C1 e C6).
- **US4–US7 (P2)**: após MVP; US5 pode iniciar em paralelo com US4 (renderer
  e editor não dependem de materiais); US6/US7 dependem de US4 (compose/fila
  `studio:ai-batch`).
- **US8–US11 (P3)**: journeys precisam de US3 (janelas/ritmo) e US6
  (fallbacks); **T091 [US14] (segment NL) vive na fase US9 por dependência do
  agente** — sem dependência cruzada restante; US10 independe de US11
  (agregação própria); US11 depende apenas do MVP.
- **US12–US14 (P4)**: US12 enriquece compliance da US1; US14 usa segmentos
  (US2), personalização (US7) e analytics (US11).

## Parallel Execution Examples

- **MVP track**: um agente em US1→US2→US3; segundo agente em paralelo a partir
  de T052 (US5 Email Studio) — arquivos distintos (`studio/email-renderer.js`,
  `apps/web/src/studio/components/EmailEditor.tsx`).
- **P2 track**: US6 e US7 em agentes paralelos após US4 (T046 desbloqueia a
  fila `studio:ai-batch`).
- **P3/P4 track**: US10 e US11 paralelizáveis (arquivos distintos); US12 e
  US13 paralelizáveis.

## Implementation Strategy

1. **MVP primeiro (Phases 1–5 = US1+US2+US3)**: entrega C1 + C6 do quickstart —
   os três problemas originais resolvidos (revisão/aprovação, audiência
   explícita, janelas/ritmo) e os guard-rails da automação opt-in, no shell
   dark próprio. É o único conjunto bloqueante.
2. **Ondas incrementais**: P2 (criação IA + studios de canal + personalização)
   → P3 (automação, agente, experimentos, analytics) → P4 (marca/compliance
   completo, biblioteca, diferenciais).
3. **Testes primeiro em toda story** (constituição III): cada fase começa
   pela suíte `test/studio-*.test.js` correspondente, verde só após a
   implementação; regressão das suítes existentes é critério de todo merge.
4. **Validação por story**: última tarefa de cada fase executa o cenário
   correspondente do `quickstart.md`.
