# API Contracts — 007-outreach-tenant-templates

Contratos dos endpoints alterados/criados em `server-prod.js`. Padrões vigentes
mantidos: auth JWT; `orgId` resolvido do token (`requireRequestOrgId`) ou
`tenantId` via `user.orgId`; erros `{ error: code, message? }`.

## 1. `POST /api/ai/campaigns` — **ALTERADO** (não dispara mais)

Cria o par de campanhas IA com **mensagem base composta e persistida**, sem
enfileirar nada (D6). Premium-only (`403 PREMIUM_REQUIRED`), limite diário
(`429 AI_CAMPAIGN_LIMIT`).

**Response 201**

```json
{
  "outreachCampaignId": "…",
  "whatsappCampaignId": "…",
  "status": "pending_approval",
  "preview": {
    "sampleProspect": { "id": "…", "companyName": "Metalúrgica Exemplo", "contactName": "Mariana" },
    "whatsapp": { "message": "Olá Mariana, tudo bem? Aqui é o(a) MB…", "aiPersonalized": true },
    "email": { "subject": "…", "body": "…" }
  }
}
```

- `preview.*.message/body` = base **renderizada com um lead real da org** (primeiro
  prospect `qualified` por `opportunityScore`); sem lead qualificado → renderização
  com placeholders vazios e saudação sem nome (D2).
- `pending_approval`: nenhuma fila (`outreach:prepare`, `whatsapp:sequence`) pode
  existir para esses ids até `approve`.

## 2. `POST /api/ai/campaigns/approve` — **NOVO**

```json
{ "outreachCampaignId": "…", "whatsappCampaignId": "…",
  "edits": { "whatsappMessageTemplate": "…", "emailTemplateSubject": "…", "emailTemplateBody": "…" } }
```

- **202**: dispara `startOutreachCampaign` + `whatsappWorkers.startCampaign` após
  gravar `approvedAt` e aplicar `edits` (opcionais; passam pelo mesmo guard de
  ingestão — 400 `TEMPLATE_REJECTED` se violarem BLOCKLIST/limite).
- Erros: `403 PREMIUM_REQUIRED` · `404` campanha fora da org · `409 ALREADY_APPROVED`
  · `400 TEMPLATE_REJECTED`.
- `edits` ausente → base composta original é aprovada como está (SC-005: o que foi
  pré-visualizado é o que dispara).

## 3. `PATCH /api/whatsapp/campaigns/:id` — **NOVO** (edição de steps/revalidação)

```json
{ "steps": [ { "id": "…", "messageTemplate": "Olá {{firstName}}, tudo bem? …", "delayMinutes": 0 } ] }
```

- **200** com a campanha atualizada. Somente campanhas da org (`orgId` no where).
- Gravação passa pelo guard de ingestão (`400 TEMPLATE_REJECTED`).
- Se `needsReview === true`, edição bem-sucedida limpa `needsReview` + `reviewReason`
  (D7). **Não reativa** a campanha — reativação continua nos endpoints existentes
  (`resume`/`start`).

## 4. `POST /api/whatsapp/campaigns/:id/rederive` e `POST /api/outreach/campaigns/:id/rederive` — **NOVOS**

Rederiva a mensagem base a partir do perfil comercial (whitelist D1/D4) — atalho de
revalidação da Q2.

**Response 200**

```json
{ "id": "…", "needsReview": false,
  "whatsapp": { "messageTemplate": "Olá {{firstName}}, tudo bem? …" } }
```

- Org-scoped (`404` fora da org). Idempotente. **Mantém a campanha pausada** —
  reativação é sempre ação explícita do tenant.
- Perfil comercial não configurado → `409 NO_PROFILE_CONTEXT` (tenant precisa
  completar o perfil comercial; nada é inventado).

## 5. Start/resume — **REGRAS ADICIONAIS**

`POST /api/whatsapp/campaigns/:id/start` (server-prod.js:5153),
`POST /api/outreach/campaigns/:id/start` (3908), `…/resume`:

- Se `needsReview === true` → **`409 CAMPAIGN_REVIEW_REQUIRED`** (retenção FR-008).
- Se fluxo exige template e ele não existe (FR-012) → `409 TEMPLATE_REQUIRED` com
  orientação de configuração.
- Validação de posse dos prospects por `orgId`/`tenantId` inalterada.

## 6. `GET /api/outreach/dispatches` — **ESTENDIDO**

Cada item passa a incluir:

```json
{ "compositionOrigin": "tenant_template | ai | ai_fallback_template | profile_base | null" }
```

- `null` para registros anteriores à migração (auditoria histórica sem origem).
- Filtros existentes (`channel`, `campaignId`, `status`, `q`) inalterados; envios de
  campanhas retidas continuam listáveis por `campaignId` (decisão Q5 — suficiente
  para identificar leads afetados).

## 7. `POST|PATCH /api/outreach/campaigns` — **VALIDAÇÃO ADICIONAL**

- `whatsappTemplate`/`emailTemplateSubject`/`emailTemplateBody` passam pelo guard de
  ingestão (BLOCKLIST + comprimento): violação → `400 TEMPLATE_REJECTED` com a razão
  (`blocked_claim` | `too_long` | `unknown_placeholder`).
- `PATCH` com alteração de template limpa `needsReview` (mesma semântica do §3).

## 8. Conexão WhatsApp — **SEM MUDANÇA DE CONTRATO**

`POST /api/whatsapp/accounts`, `POST /:id/connect`, `GET /:id/qr`,
`POST /:id/disconnect`, `POST /:id/reconnect`, `DELETE /:id` permanecem como estão
(server-prod.js:4572-4768). O aviso de risco (US6) é **gate exclusivo de frontend**
(D8): o modal precede qualquer chamada; cancelar não gera request. Nenhuma sessão é
criada sem a confirmação porque nenhuma chamada de conexão acontece sem ela.

## 9. Eventos NATS — **SEM MUDANÇA**

`MESSAGE_SENT` / `MESSAGE_FAILED` e demais `*.v1` intactos (Constituição II).
`compositionOrigin` é dado de leitura/auditoria via API, não propagado em eventos.
