# Data Model — 007-outreach-tenant-templates

Entidades afetadas, campos novos (todos **aditivos**, migração Prisma única) e
transições de estado. Campos/relações existentes listados apenas quando relevantes.

## 1. Organization (existente, sem mudança)

- `plan` (`trial` | `premium`), `name`, `orgId` implícito como escopo de tudo.
- Relevo: gating premium do ciclo IA (`isPremiumOrg`), limite diário IA por org.

## 2. CommercialSettings (existente, sem mudança de schema)

- Insumo da composição de base (whitelist D1): `companyName`, `valueProposition`,
  `productDescription`, `businessModel`, `ctaGoal`, `toneNotes`, `websiteUrl`.
- `orgCtx.configured` (derivado em `org-context.js`) decide "há insumo suficiente
  para compor base" (`oQueE || propostaValor`).
- **Regra (FR-002)**: campos são insumo de composição — nunca corpo literal;
  `ctaGoal` só entra via `effectiveCtaText()` (frase lead-facing).

## 3. Prospect (existente, sem mudança de schema)

- `contactName String?` — **passa a ser fonte primária de `{{firstName}}`** (D2).
- `tradeName`/`companyName` — exclusivos de `{{companyName}}`; nunca nome de pessoa.
- `cnpjPartners Json?` — fonte secundária de pessoa (sócio), já mascarada no trial
  via `redactProspectForPlan` (gating por plano preservado).

## 4. OutreachCampaign (email) — campos novos

| Campo | Tipo | Default | Uso |
|-------|------|---------|-----|
| `needsReview` | `Boolean` | `false` | Retenção por saneamento (D7) |
| `reviewReason` | `String?` | `null` | Motivo legível (`synthetic_template_leak`) |
| `approvedAt` | `DateTime?` | `null` | Portão de aprovação do fluxo IA (D6) |

- Existentes relevantes: `emailTemplateSubject/Body` (passam a ser **sempre
  preenchidos** em campanhas IA, com base composta — D4/D6), `source`
  (`manual|ai`), `status` (`draft|active|paused|...`), `tenantId`, `trigger`,
  `autoWhatsAppCampaignId`.

## 5. WhatsAppCampaign — campos novos

| Campo | Tipo | Default | Uso |
|-------|------|---------|-----|
| `needsReview` | `Boolean` | `false` | Retenção por saneamento (D7) |
| `reviewReason` | `String?` | `null` | Motivo legível |
| `approvedAt` | `DateTime?` | `null` | Portão de aprovação (D6) |

- Existentes: `orgId`, `status` (`DRAFT|SCHEDULED|RUNNING|PAUSED|COMPLETED|CANCELLED`), `source` (`manual|ai`).

## 6. WhatsAppSequenceStep (existente, sem mudança de schema)

- `messageTemplate String` — passa por **guard de ingestão** (D3): BLOCKLIST +
  comprimento; conteúdo criado apenas por (a) tenant ou (b) composição whitelist.
- `aiPersonalized Boolean` — inalterado; fallback do step é sempre o próprio
  template (agora seguro).

## 7. WhatsAppMessage — campo novo

| Campo | Tipo | Valores | Uso |
|-------|------|---------|-----|
| `compositionOrigin` | `String?` | `tenant_template` \| `ai` \| `ai_fallback_template` \| `profile_base` | Auditoria por envio (FR-010, D5) |

- Unicidade/idempotência preservada: `@@unique([campaignContactId, stepIndex])`.
- Escrita no `create` existente de `processSequence` (sem escrita extra).

## 8. OutreachMessage — campo novo

| Campo | Tipo | Valores | Uso |
|-------|------|---------|-----|
| `compositionOrigin` | `String?` | `tenant_template` \| `ai` \| `profile_base` | Auditoria por envio (D5) |

- `aiReasoningFacts` permanece (fatos livres da IA); origem canônica passa a ser a
  coluna.

## 9. Transições de estado — ciclo IA com aprovação (D6)

```text
POST /api/ai/campaigns
  └─ cria OutreachCampaign(status='draft',  approvedAt=null, base composta)
     cria WhatsAppCampaign (status='DRAFT', approvedAt=null, step 0 composto, aiPersonalized)
  └─ NENHUMA fila é enfileirada
        │
        ▼
POST /api/ai/campaigns/approve   (premium, org-scoped, revalida posse)
  ├─ grava approvedAt; opcionalmente aplica edições do tenant na base
  ├─ startOutreachCampaign → status 'active'  (filas outreach:prepare)
  └─ whatsappWorkers.startCampaign → status 'RUNNING' (fila whatsapp:sequence)
        │
        ▼
falha de um canal → canal afetado 'paused'/'PAUSED' (comportamento atual mantido)
```

## 10. Transições de estado — saneamento legado (D7)

```text
sanitize-legacy-campaigns (idempotente, por orgId):
  campanha source='ai' com texto interno detectável no template/step
    ├─ needsReview = true, reviewReason = 'synthetic_template_leak'
    └─ status ativo → 'paused'/'PAUSED'  (retém novos envios)
  campanha manual/[auto]: NUNCA tocada
        │
        ▼
tenant resolve (Q2):
  POST .../rederive  → base regenerada por whitelist; needsReview=false; segue pausada
  PATCH (edição manual do template) → needsReview=false
        │
        ▼
tenant reativa por endpoints existentes (resume/start) — ação explícita obrigatória
```

## 11. Regras de validação (resumo operacional)

- Template/steps na ingestão: BLOCKLIST (`whatsapp-utils.js:137`) rejeita;
  comprimento ≤ 600 chars (WhatsApp); placeholders só do conjunto suportado
  (`firstName`, `companyName`, `jobTitle`, `city`, `industry`) — desconhecidos
  sinalizados ao tenant (FR-004), removidos na renderização.
- `firstName` vazio → saudação sem vírgula pendurada (D2).
- `compositionOrigin` obrigatória em todo `create` de mensagem de campanha nova.
- Nenhum endpoint novo aceita ação fora do `orgId`/`tenantId` do request (404/400
  nos padrões existentes de server-prod.js).
