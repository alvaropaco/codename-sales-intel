# Data Model — Campaign Studio (010)

Fase 1 do `$speckit-plan`. Convenções do repo (mantidas): `@id @default(cuid())`,
`createdAt/updatedAt`, `orgId`/`tenantId` como `String` (organization.id) com
`@@index([orgId])`, estados como `String` comentados, coleções opcionais como
`Json`. Migração **exclusivamente** via `prisma migrate dev` (`pnpm run
db:migrate`) — nunca `db push` em produção.

Novos modelos vivos em `studio/` usam prefixo `Studio`. Modelos existentes
recebem **apenas colunas aditivas opcionais** (sem quebra).

---

## Novos modelos

### StudioCampaign — a unidade central do Studio

| Campo | Tipo | Notas / validações |
|---|---|---|
| id | String @id cuid | |
| orgId | String | organization.id; `@@index([orgId])` |
| name | String | obrigatório |
| description | String? | |
| objective | String? | pilar 2 dos prompts (mesma semântica dos motores) |
| offer | String? | idem |
| funnelStage | String @default("middle") | `top` \| `middle` \| `bottom` (US13) |
| status | String @default("draft") | `draft` \| `in_review` \| `approved` \| `scheduled` \| `running` \| `paused` \| `completed` \| `cancelled` \| `retained` |
| statusReason | String? | motivo de estados `retained`/`paused` (sanimento 007, anomalia) |
| origin | String @default("manual") | `manual` \| `ai_prompt` \| `material` \| `url` \| `company_data` \| `duplicate` \| `template` \| `agent` (FR-030, auditoria) |
| sourceCampaignId | String? | quando `duplicate`/variação: campanha original (nunca alterada) |
| channels | Json @default("[]") | subconjunto de `["email","whatsapp","linkedin_text"]` |
| schedule | Json @default("{}") | `{ mode: "immediate"\|"scheduled", startAt?, windows: [{days:[1..7], startHour, endHour}], hourlyLimit, dailyLimit, timezone, useLeadTimezone: bool }` — FR-016/017/018/022 |
| goalMetric | String? | métrica-objetivo do funil (analytics/ROI) |
| convertedValue | Int? | receita declarada por conversão (centavos) — FR-068 |
| utmTemplate | Json @default("{}") | `{utmSource,utmMedium,utmCampaign}` defaults — FR-037 |
| fallbackPolicy | Json @default("{}") | fallbacks por variável, política de fadiga (`postpone`\|`skip`), conflito entre campanhas (`postpone`\|`priority`\|`block`) |
| approval | Json @default("{}") | `{ approvedBy?, approvedAt?, complianceLevel?, reviewNotes? }` — espelhado em colunas abaixo para consulta |
| approvedById | String? | user.id — aprovação humana (FR-003) |
| approvedAt | DateTime? | |
| emailExecutionId | String? | → OutreachCampaign (compilada pelo channel-bridge) |
| whatsappExecutionId | String? | → WhatsAppCampaign |
| journeyEnabled | Boolean @default(false) | |
| createdAt/updatedAt | DateTime | |

Transições de estado (enforçadas em `studio/campaign-service.js`, testadas):
`draft→in_review→approved`; `approved→scheduled→running`; `running⇄paused`;
`qualquer ativo→cancelled`; `in_review→retained` só via saneamento; edição de
conteúdo após `running` exige `running→paused` + volta a `in_review` (FR-006).
Automação opt-in adotada pelo Studio usa os mesmos estados + campos de
guard-rails da suíte (abaixo, colunas novas em OutreachCampaign).

Relações: audienceSnapshots[], contents[], materials[], experiments[],
journeys[], proposals[], complianceReviews[], recommendations[], metricDays[]

### StudioSegment — segmento salvo e reutilizável

| Campo | Tipo | Notas |
|---|---|---|
| id / orgId | cuid / String | `@@index([orgId])` |
| name | String | único por org (`@@unique([orgId, name])`) |
| description | String? | |
| criteria | Json | documento versionado `{version:1, groups:[{op:"AND"\|"OR", conditions:[{field,op,value}]}]}` sobre catálogo fechado (research D3) |
| naturalLanguageInput | String? | pedido original quando criado por NL (FR-014) |
| lastCount / lastCountAt | Int? / DateTime? | cache da última contagem |
| createdBy | String | user.id |
| createdAt/updatedAt | DateTime | |

### StudioAudienceSnapshot — audiência congelada (FR-013)

| Campo | Tipo | Notas |
|---|---|---|
| id / orgId | cuid / String | |
| campaignId | String | → StudioCampaign, `@@index([campaignId])` |
| segmentId | String? | quando derivada de segmento salvo |
| criteriaVersion | Json | critérios efetivos no congelamento (auditoria) |
| totalCount / includedCount / excludedCount | Int | contagens congeladas |
| status | String @default("active") | `active` \| `superseded` (nova sync cria novo snapshot) |
| createdAt | DateTime | |

### StudioAudienceMember — linha por lead do snapshot

| Campo | Tipo | Notas |
|---|---|---|
| id | cuid | |
| snapshotId | String | `@@index([snapshotId])` |
| prospectId | String | `@@index([prospectId])`; `@@unique([snapshotId, prospectId])` |
| included | Boolean | false = excluído |
| excludeReason | String? | `opt_out` \| `suppressed` \| `recent_contact` \| `manual` \| `fatigue` \| `no_consent` |
| variantLabel | String? | atribuição A/B determinística (research D10) |
| excludedManuallyById | String? | user.id quando `manual` |

### StudioContent — conteúdo versionado por canal/variante

| Campo | Tipo | Notas |
|---|---|---|
| id / orgId | cuid / String | |
| campaignId | String | `@@index([campaignId])` |
| channel | String | `email` \| `whatsapp` \| `linkedin_text` |
| variantLabel | String @default("A") | variante de experimento/tonalidade (`formal`, `comercial`…) |
| kind | String @default("base") | `base` \| `followup` (sequência de toques simples, FR-079) |
| stepIndex | Int @default(1) | 1 = toque principal; 2..n = follow-ups |
| title | String? | título interno da campanha |
| emailDoc | Json? | documento de blocos do editor → MJML (research D7) |
| subject | String? | assunto do e-mail |
| preheader | String? | pré-header do e-mail |
| whatsappText | String? | mensagem (placeholders `{{...}}` validados) |
| whatsappMeta | Json? | botões/CTA, mídia (referência), template Meta compatível (categoria, variáveis posicionais) |
| linkedinText | String? | texto para uso manual |
| ctaUrl | String? | |
| tone | String? | `formal` \| `comercial` \| `tecnico` \| `urgente` \| custom |
| origin | String @default("manual") | `ai` \| `manual` \| `template` \| `ai_from_material` (FR-030) |
| editHistory | Json @default("[]") | `[{by,at,summary}]` (FR-005) |
| createdAt/updatedAt | DateTime | |

`@@index([campaignId, channel, variantLabel, kind, stepIndex])`

### StudioPersonalization — variação por lead (FR-047–FR-051)

| Campo | Tipo | Notas |
|---|---|---|
| id | cuid | |
| contentId | String | → StudioContent, `@@index([contentId])` |
| prospectId | String | `@@unique([contentId, prospectId])` |
| overrides | Json | `{intro?, valueProp?, cta?, full?}` — usa somente dados existentes do lead |
| dataBasis | Json @default("[]") | fatos usados (auditoria "explicável", FR-075) |
| status | String @default("pending") | `pending` \| `generated` \| `edited` \| `base_fallback` (sem dados suficientes) |
| editedById | String? | quando edição por lead (FR-050) |
| propagatedRule | Json? | regra aplicada em massa a partir desta edição |
| createdAt/updatedAt | DateTime | |

### StudioMaterial — fonte de criação (FR-023/024)

| Campo | Tipo | Notas |
|---|---|---|
| id / orgId | cuid / String | |
| kind | String | `pdf` \| `docx` \| `pptx` \| `image` \| `video` \| `url` \| `prompt` \| `company_data` |
| sourceRef | String? | URL ou caminho relativo em `STUDIO_STORAGE_DIR` |
| mimeType / sizeBytes | String? / Int? | |
| extraction | Json? | `{product?, offer?, benefits[], audience?, cta?, confidence}` — apresentada para confirmação (FR-024) |
| extractionStatus | String @default("pending") | `pending` \| `extracted` \| `failed` \| `needs_manual` (imagem/vídeo sem visão configurada) |
| extractionError | String? | motivo explicável (edge case) |
| confirmedAt | DateTime? | confirmação humana da extração |
| uploadedById | String | user.id |
| createdAt | DateTime | |

### StudioJourney / StudioJourneyLead — automação visual (FR-052–FR-056)

**StudioJourney**: `id, orgId, campaignId (→StudioCampaign), definition Json`
(grafo: `{blocks:[{id,type:"send"\|"wait"\|"condition"\|"update"\|"end", config}], edges:[{from,to,branch?}]}`,
`status` (`draft`\|`active`\|`paused`), `triggers Json`
(`segment_enter`\|`behavior`\|`score_threshold`\|`webhook`), `stopConditions Json`
(`reply`\|`converted`\|`opt_out`), stats por bloco em `StudioJourneyLead`
(agregação no endpoint).

**StudioJourneyLead**: `id, journeyId (@@index), prospectId, currentBlockId,
waitingUntil DateTime?, status (`waiting`\|`active`\|`waiting_human`\|`done`\|`stopped`),
stopReason String?, updatedAt`.
`@@unique([journeyId, prospectId])`; worker idempotente por
`studio:journey:{journeyId}:{prospectId}:{blockId}` (research D14).

### StudioExperiment — A/B (FR-060–FR-063)

| Campo | Tipo | Notas |
|---|---|---|
| id / orgId / campaignId | | `@@index([campaignId])` |
| dimension | String | `subject` \| `copy` \| `cta` \| `send_time` \| `channel` |
| split | Json | `{A: 20, B: 80}` pesos |
| winnerCriterion | Json | `{metric, minPerVariant, confidence}` |
| status | String @default("running") | `running` \| `winner_declared` \| `closed` |
| winnerVariant | String? | |
| declaredAt / declaredBasis | DateTime? / Json? | dados que motivaram a declaração |
| continuousOptimization | Boolean @default(false) | FR-062; efeitos em `StudioRecommendation` |
| createdAt/updatedAt | DateTime | |

### StudioBrandProfile — Brand Voice + Brand Kit (FR-070/071)

`id, orgId @unique, voice Json` (`{toneNotes, doExamples[], dontExamples[],
learnedFrom[]}`), `kit Json` (`{logoUrl, colors{}, fonts{}, assets[]}`),
`consistencyChecks Json @default("[]")` (últimos pareceres), timestamps.

### StudioTemplate — biblioteca (FR-038, US13)

`id, orgId, name, channel, objective` (`prospection`\|`launch`\|`promotion`\|`newsletter`\|`event`\|`reactivation`\|`nurturing`),
`funnelStage, content Json` (mesmo formato de StudioContent sem campaignId),
`variables Json` (placeholders declarados), `isSystem Boolean @default(false)`
(sementes da plataforma), timestamps. `@@index([orgId, objective])`.

### StudioComplianceReview — parecer pré-aprovação (FR-073)

`id, orgId, campaignId (@@index), level` (`ok`\|`attention`\|`block`),
`items Json` (`[{check, level, detail, affectedLeads?}]` — consentimento,
LGPD, descadastro presente, spam/banimento, dados sensíveis),
`checkedById String?` (sistema = null), `createdAt`.
Regra: aprovação (`campaign-service`) exige último parecer `level != "block"`.

### StudioReplyClassification — classificação de respostas (FR-045)

`id, orgId, prospectId (@@index), channel` (`email`\|`whatsapp`),
`sourceMessageId String` (OutreachMessage/WhatsAppMessage), `label`
(`interested`\|`not_interested`\|`doubt`\|`meeting_request`\|`opt_out`\|`out_of_scope`),
`confidence Float`, `needsHumanReview Boolean`, `confirmedById String?`,
`createdAt`. `opt_out` propaga para `LeadChannelState` + supressão (FR-046).

### StudioMetricDaily — rollup (FR-064–FR-069)

`id, orgId, campaignId (@@index), day DateTime, channel, variantLabel,
stepIndex, sent, delivered, deliveredEstimated, opens, opensEstimated, clicks,
replies, conversions, bounces, unsubs, whatsappReads` — todos `Int @default(0)`;
`@@unique([campaignId, day, channel, variantLabel, stepIndex])`.
Atualização incremental por job (research D11).

### StudioAgentProposal / StudioRecommendation — agente e otimização (FR-057–FR-059, FR-075–FR-078)

**StudioAgentProposal**: `id, orgId, campaignId? (nasce sem campanha),
requestPrompt, plan Json` (`{audience: {segmentCriteria, rationale},
strategy: {channels, timing}, contents: [...], tracking}`), `items Json`
(`[{key, decision: "accepted"\|"edited"\|"rejected", editedValue?}]`),
`status` (`proposed`\|`decided`\|`converted`), timestamps.
Converte em StudioCampaign `origin="agent"` **somente** após decisões (FR-058).

**StudioRecommendation**: `id, orgId, campaignId (@@index), kind`
(`subject_swap`\|`pace_change`\|`pause_segment`\|`next_best_action`\|`fatigue`\|`handoff`),
`targetProspectId?`, `rationale String`, `evidence Json` (dados que motivam,
FR-075), `status` (`proposed`\|`applied`\|`rejected`), `appliedAt?`,
`requiresConfirmation Boolean`, timestamps.

---

## Colunas novas em modelos existentes (aditivas, todas opcionais)

| Modelo | Coluna | Motivo |
|---|---|---|
| OutreachCampaign | `studioCampaignId String? @unique` | link reverso da execução de e-mail → campanha Studio (research D1) |
| OutreachCampaign | `guardrails Json @default("{}")` | `{firstBatchApprovedAt?, anomalyPausedAt?, anomalyReason?, sampleMessageIds[]}` — guard-rails da suíte opt-in (D2) |
| WhatsAppCampaign | `studioCampaignId String? @unique` | idem e-mail |
| WhatsAppCampaign | `guardrails Json @default("{}")` | idem |
| OutreachCampaign | `sequence Json @default("[]")` | follow-ups simples configuráveis (FR-079): `[{stepIndex, delayDays, condition, maxTouch}]` — populates `kind=followup` do StudioContent; o worker existente de follow-up passa a ler desta config quando presente (fallback: `[3,5,7]` atual) |

Nenhuma coluna existente é removida ou renomeada; nenhum contrato de evento
NATS muda. A suíte `on_enrichment` atual funciona sem migração de dados
(`guardrails` vazio = comportamento atual; preenchido quando adotada pelo
Studio).

---

## Índices e volume

- 50k prospects/org: contagem de segmento usa índices existentes
  (`status`, `tenantId/orgId` em Prospect) + filtros indexáveis; snapshot
  materializa membros (50k linhas por campanha grande — paginação na leitura,
  `@@index([snapshotId])`).
- `StudioAudienceMember` é a tabela de maior crescimento; limpeza: snapshots
  `superseded` > 90 dias podem ser purgados por job (não bloqueia v1).

## Idempotência (constituição II)

- Toda escrita derivada de job tem chave natural ou jobId determinístico:
  `StudioJourneyLead @@unique([journeyId, prospectId])`,
  `StudioPersonalization @@unique([contentId, prospectId])`,
  `StudioMetricDaily @@unique([...])`, jobs BullMQ com IDs
  `studio:*:{campaignId}:{prospectId|bucket}` — reprocessar nunca duplica.
- Envio por lead/toque permanece único nos motores
  (`@@unique([prospectId, campaignId])` em OutreachContact).
