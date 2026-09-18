# Contract: API de Decisão de Contato

**Feature**: 003-contact-decision-metrics | **Date**: 2026-09-17

Contrato do único endpoint novo da feature. Padrões herdados dos endpoints
vizinhos de `server-prod.js` (`GET /api/prospects/:id`,
`GET /api/enrichment/graph/:cnpj`): auth por cookie Firebase, escopo por
organização via `requireRequestOrgId`, envelope `{ success, data }`.

## GET /api/prospects/:id/contact-decision

Painel de decisão de contato do lead (métricas Atingibilidade e Momento,
recomendação, freshness). Cálculo determinístico on-read — sem LLM, sem
chamadas externas.

### Request

| Param | In | Obrig. | Descrição |
|-------|----|--------|-----------|
| `id` | path | sim | id do prospect |

- **Auth**: sessão Firebase (mesma do restante da API).
- **Multi-tenancy**: o prospect é buscado com `findFirst({ id, orgId })`; org
  diferente → **404** (nunca vaza existência cross-tenant).

### Response 200

```jsonc
{
  "success": true,
  "data": {
    "prospectId": "clx…",
    "generatedAt": "2026-09-17T12:00:00.000Z",
    "dataRestricted": false,

    "freshness": {
      "stale": false,
      "lastEvidenceAt": "2026-09-10T08:00:00.000Z",
      "thresholdDays": 90
    },

    "reachability": {
      "level": "high",                 // high | medium | low | unknown
      "score": 80,                     // 0–100 | null quando unknown
      "usableChannel": true,
      "recommendedChannel": "email",   // email | phone | whatsapp | null
      "channels": [
        { "type": "email", "classification": "corporate", "confidence": 0.9 },
        { "type": "phone", "classification": "unknown", "confidence": 0.7 },
        { "type": "whatsapp", "classification": "unknown", "confidence": 0.7 }
      ],
      "evidence": [
        { "key": "corporate_email", "label": "E-mail corporativo próprio", "detail": "domínio próprio do lead", "confidence": 0.9, "date": "2026-09-10T08:00:00.000Z" },
        { "key": "phone_cnpj", "label": "Telefone no cadastro CNPJ", "detail": "1 telefone", "date": "2026-08-02T09:30:00.000Z" }
      ],
      "basis": { "prospect": true, "graph": true, "graph_available": true },
      "stale": false
    },

    "timing": {
      "level": "medium",
      "score": 55,
      "inactive": false,               // true = situação cadastral irregular
      "missingOfficialSignals": [],    // FR-018: ex. ["situacao_cadastral","cnpj_age"]
      "evidence": [
        { "key": "active_status", "label": "Situação cadastral ativa", "detail": "Receita Federal" },
        { "key": "website_active", "label": "Site no ar", "detail": "HTTPS ativo" },
        { "key": "growth_stack", "label": "Ferramentas de marketing/vendas", "detail": "analytics + marketing" }
      ],
      "basis": { "prospect": true, "graph": true, "graph_available": true },
      "stale": false
    },

    "recommendation": {
      "verdict": "contact_now",        // contact_now | contact_lower_priority | do_not_prioritize
      "reasons": [
        { "code": "corporate_email", "detail": "e-mail corporativo próprio disponível" },
        { "code": "good_timing", "detail": "empresa operando e investindo" }
      ],
      "factors": {
        "reachability": { "weight": 40, "value": 80, "status": "used" },
        "timing":       { "weight": 35, "value": 55, "status": "used" },
        "fit":          { "weight": 15, "value": 50, "status": "neutral" },
        "risk":         { "weight": 10, "value": 85, "status": "used" }
      },
      "suggestedAction": "start_email", // enrich_lead | start_email | start_whatsapp | defer | null
      "contactedContext": {              // FR-015 — null quando nunca contatado
        "contacted": true,
        "channels": ["email"],
        "lastContact": "2026-09-01T14:00:00.000Z"
      }
    }
  },
  "timestamp": "2026-09-17T12:00:00.000Z"
}
```

### Errors

| Status | Quando |
|--------|--------|
| 401 | sessão inválida |
| 404 | prospect inexistente **ou** de outra organização |
| 500 | erro inesperado (log estruturado no servidor, sem dados do lead na mensagem) |

### Garantias contratuais (cada uma vira teste)

1. **Zero valores de contato no payload** — nenhum campo contém e-mail ou
   telefone; canais trazem apenas `type`, `classification`, `confidence`
   (FR-011/SC-006 — auditar por regex no corpo da resposta).
2. `score` é `null` ⇔ `level === 'unknown'` (FR-008).
3. `verdict === 'contact_now'` ⇒ `usableChannel === true`, `inactive !== true`,
   risco ≠ alto (FR-014).
4. Lead sem CNPJ ⇒ `timing.missingOfficialSignals` não-vazio (FR-018).
5. `dataRestricted === true` (trial) ⇒ mesmo shape de payload — métricas
   visíveis, valores nunca presentes (FR-011).
6. Falha do grafo não muda o status HTTP — `basis.graph_available === false` e
   métricas computadas com o prospect (FR-013).
7. Determinismo: mesmo input → mesmo `data` (exceto carimbos de tempo).

## Códigos de reason (estáveis, mapeados para PT-BR no frontend)

| Code | Emissão |
|------|---------|
| `corporate_email` | e-mail corporativo próprio disponível |
| `generic_email_only` | único e-mail é gratuito/terceirizado |
| `no_channel` | nenhum canal utilizável |
| `channels_available` | canais utilizáveis presentes |
| `good_timing` | momento favorável |
| `bad_timing` | sinais de empresa parada |
| `inactive_company` | situação cadastral irregular/baixa (gate) |
| `high_credit_risk` | risco de crédito alto (gate) |
| `insufficient_data` | fatores em `unknown` dominaram o cálculo |

## Códigos de suggestedAction

| Code | Significado |
|------|-------------|
| `enrich_lead` | disparar enriquecimento para obter canais/momento |
| `start_email` | iniciar contato por e-mail (canal recomendado) |
| `start_whatsapp` | iniciar contato por WhatsApp |
| `defer` | lead atingível, mas momento/risco desaconselham agora |
| `null` | sem ação coerente (ex.: veredito `do_not_prioritize` por inatividade) |

## Consumer (frontend)

- `apps/web/src/services/api.ts`: `fetchContactDecision(id)` → `ContactDecision | null` (404 ⇒ null).
- `useLeadDetail.ts`: seção `decision` com estado próprio + polling durante enriquecimento ativo.
- `LeadIntelligence.tsx`: renderiza o painel; rótulos PT-BR dos códigos ficam no frontend (mapa estático).
