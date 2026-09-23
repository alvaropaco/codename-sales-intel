# Contract — REST API `/api/studio/*`

Fase 1 do `$speckit-plan`. Todos os endpoints: autenticação via
`requireAuth` (padrão do repo), escopo de organização obrigatório (contexto
da org autenticada), erros no formato existente
(`{ error: CODE, message?, details? }`). Gating marcado por endpoint:
`[premium]` = exige `assertPremiumOrg` (403 `PREMIUM_REQUIRED`);
`[quota]` = limitado por cota diária de IA da org (403 `STUDIO_AI_QUOTA`).

Convenções: `:id` = id da entidade; datas ISO-8601 com offset; enums conforme
[data-model.md](../data-model.md). Paginação: `?cursor=&limit=` (default 50).

---

## Campanhas

### `POST /api/studio/campaigns`
Cria campanha (sempre `status=draft`; FR-002).
```json
// req
{ "name": "...", "objective"?, "offer"?, "funnelStage"?, "channels": ["email","whatsapp"],
  "origin": "manual", "templateId"?, "duplicateOf"?, "materialId"?, "journeyEnabled"? }
// res 201
{ "campaign": { id, status: "draft", ... } }
```

### `GET /api/studio/campaigns?status=&q=`
Lista campanhas da org com contagens resumidas (audiência, enviados).

### `GET /api/studio/campaigns/:id`
Detalhe completo: campanha + contents[] + schedule + snapshot atual +
journey + experimentos + último parecer de compliance + links de execuções.

### `PATCH /api/studio/campaigns/:id`
Edita metadados/conteúdos **apenas** quando editável
(`draft|in_review|paused`); após `running`, 409 `CAMPAIGN_LOCKED` com
instrução pausar→alterar→re-aprovar (FR-006).

### `POST /api/studio/campaigns/:id/submit-review`
`draft|paused → in_review`. Dispara Compliance Guard (síncrono para checks
determinísticos, assíncrono para LLM) e retorna `complianceReview`
(FR-073). `level=block` impede approve.

### `POST /api/studio/campaigns/:id/approve`
`in_review → approved`. Body: `{ confirm: true }`. Requisitos: último
compliance `level != "block"`; audiência > 0 (senão 409
`EMPTY_AUDIENCE` com filtro zerado no details). Grava `approvedBy/At`,
**congela audiência** (snapshot) e atribui variantes A/B. Idempotente por
campanha (aprovar 2× não duplica snapshot).

### `POST /api/studio/campaigns/:id/schedule`
`approved → scheduled` ou `running` imediato. Body: schedule completo
(`{mode, startAt?, windows[], hourlyLimit, dailyLimit, timezone,
useLeadTimezone}`). Retorna `forecast` (previsão de conclusão, FR-020).

### `POST /api/studio/campaigns/:id/control`
Controle de fila (FR-021). Body: `{ action: "pause"|"resume"|"cancel"|"pace",
pace?: {hourlyLimit, dailyLimit} }`. Cancel com `confirm: true`; leads
não enviados → `CANCELLED` com motivo; em voo mantém status real.

### `GET /api/studio/campaigns/:id/queue?cursor=`
Fila por lead: status, próximo toque agendado, motivo de retenção
(janela, cota, fadiga, anomalia).

### `POST /api/studio/campaigns/:id/require-review`
Marca automação opt-in (guard-rails) para revisão obrigatória do próximo
lote (decisão clarify). Body: `{ reason }`.

---

## Audiência e segmentos

### `POST /api/studio/segments`
Cria segmento salvo. Body: `{ name, description?, criteria, naturalLanguageInput? }`.
Validação: catálogo fechado de campos/ops (403 `INVALID_CRITERIA_FIELD`).
### `GET /api/studio/segments` · `PATCH /api/studio/segments/:id` · `DELETE /api/studio/segments/:id`
CRUD básico. GET retorna `lastCount/lastCountAt` e delta vs. uso anterior (FR-009).
### `POST /api/studio/segments/:id/preview`
Contagem + amostra (primeiros 50) + distribuição por campo de corte.
**Meta de performance: < 2s p95 com 50k leads.**
### `POST /api/studio/segments/preview-nl` `[premium]` `[quota]`
Body: `{ prompt }`. LLM → `criteria` (mesmo schema fechado) + explicação
por condição. **Não salva** — retorna para edição (FR-014).

### `POST /api/studio/campaigns/:id/audience`
Define audiência da campanha. Body (uma das formas):
`{ segmentId }` · `{ manual: {prospectIds[]} }` · `{ list: string[] }` (CNPJs
ou e-mails, um por linha, resolvidos contra os prospects **da própria org**
com dedupe; não encontrados voltam em `unmatched` e NÃO criam prospects)
— todas combináveis com `{ excludeProspectIds?[] }` (exclusão manual, FR-012).
Resposta: contagem, excluídos obrigatórios + motivo
(`opt_out|suppressed|recent_contact`) e lista paginada. Opt-out/supressão
**não podem** ser incluídos (400 `PROTECTED_LEAD`). (FR-008–FR-010/012)

### `GET /api/studio/campaigns/:id/audience?filter=included|excluded&cursor=`
Snapshot vigente paginado (após aprovação, somente leitura — FR-013).

### `POST /api/studio/campaigns/:id/audience/sync-delta` `[premium]`
Para campanha recorrente/journey: recalcula segmento, cria **novo snapshot**
(marca anterior como `superseded`) — nunca altera snapshot aprovado de
campanha one-shot (FR-013/FR-055).

---

## Conteúdo, materiais e IA

### `POST /api/studio/campaigns/:id/contents`
Cria/atualiza conteúdo por canal/variante/toque (`emailDoc` para e-mail;
texto para WhatsApp/LinkedIn). Valida placeholders contra catálogo de
variáveis (400 `UNKNOWN_VARIABLE`).
### `GET /api/studio/campaigns/:id/contents/:contentId/preview?channel=email&view=desktop|mobile&variant=`
Renderiza via MJML (e-mail) ou preview WhatsApp realista. **Mesmo renderer
do envio** (SC-006).

### `POST /api/studio/campaigns/:id/personalize` `[premium]` `[quota]`
Geração em lote. Body: `{ contentId, level: "greeting"|"intro"|"full",
prospectIds?[] }` → 202 `{ batchId }`; progresso em
`GET /api/studio/personalization/:batchId` (`{done,total,paused}`) e
`POST .../pause`.
### `GET /api/studio/campaigns/:id/personalization-preview?contentId=&sample=10`
Renderiza o conteúdo para amostra de leads reais com status
(`generated|edited|base_fallback`) — FR-049.
### `PATCH /api/studio/personalization/:contentId/:prospectId`
Body: `{ overrides, propagate?: boolean }` — edição por lead ou regra
(FR-050).

### `POST /api/studio/materials` (multipart)
Upload (`kind` detectado) ou `{url}` / `{prompt}`. → 201 `StudioMaterial`
(`extractionStatus=pending`). Limites por plano (400 `MATERIAL_TOO_LARGE`).
### `POST /api/studio/materials/:id/extract` `[premium]` `[quota]`
Extrai `{product, offer, benefits, audience, cta}` (FR-024). Falhas:
`extractionError` explicável (edge case). Vídeo sem transcrição:
`needs_manual` + pedido de descrição.
### `POST /api/studio/materials/:id/confirm`
Confirmação humana da extração (editável no body) antes de compor.
### `POST /api/studio/campaigns/:id/compose` `[premium]` `[quota]`
Corpo: `{ materialId? | url? | prompt? | companyData: true, tones: ["formal","comercial"], variants: 2 }`
→ gera pacote (FR-025/026) e popula contents por canal/variante. 202 + polling.

### `POST /api/studio/contents/:contentId/rewrite` `[premium]` `[quota]`
Body: `{ action: "improve"|"shorten"|"tone"|"proofread", target: "subject"|"preheader"|"body"|"cta", tone? }`.
### `POST /api/studio/contents/:contentId/suggest`
Sugestões: `{ kind: "subject"|"preheader"|"cta", n: 5 }` (FR-035).
### `POST /api/studio/contents/:contentId/translate` `[premium]` `[quota]`
Body: `{ targetLanguage }` → novo conteúdo variante com variáveis/links
preservados, status `draft` para revisão (US13).
### `POST /api/studio/campaigns/:id/checks`
Rodas de qualidade antes de aprovar: `{ checks: ["spam","links","accessibility"] }`
→ score + motivos (FR-036); UTM: `POST .../apply-utm` (FR-037).

### Classificação de respostas (sem rota pública)
A classificação roda nos hooks dos workers existentes (Gmail sync / webhook
WAHA — ver `contracts/jobs-queues.md`) e grava `StudioReplyClassification`.
Reprocesso em lote é **job interno de fila** (`studio:reclassify`,
`{ campaignId, since? }`), acionado pelo operador da plataforma — não há
endpoint REST público para isso (FR-045).

---

## Automação (journeys)

### `PUT /api/studio/campaigns/:id/journey`
Salva `definition` + `triggers` + `stopConditions` (validação estrutural do
grafo: blocos conectados, sem ciclo sem wait, todo branch com fim).
### `POST /api/studio/journeys/:id/control`
`{ action: "activate"|"pause" }` — activate exige campanha aprovada.
### `POST /api/studio/journeys/:id/webhook/:token`
Externo, autenticado por token opaco (hash SHA-256 no banco). Body:
`{ prospectRef }` (CNPJ/e-mail/id de um lead **da mesma org**) → inicia
journey para o lead. 202 sempre (não vaza existência do lead); eventos em
timeline (FR-054, research D15).
### `GET /api/studio/journeys/:id/stats`
Por bloco: `{ blockId, entered, waiting, done, stopped }` (FR-056).

---

## Experimentos

### `POST /api/studio/campaigns/:id/experiments`
Cria A/B: `{ dimension, split, winnerCriterion, continuousOptimization? }`.
Variantes devem existir em StudioContent (400 `MISSING_VARIANT`).
### `GET /api/studio/experiments/:id`
Métricas por variante + status do critério de vencedor.
### `POST /api/studio/experiments/:id/declare-winner`
Manual ou avaliação automática registra vencedor + basis (FR-061).

---

## Brand, templates, compliance

### `GET/PUT /api/studio/brand`
Brand Voice + Kit da org. `POST /api/studio/brand/learn` `[premium]`:
aprende voz de `{ materialIds? , campaignIds?, samples? }` (FR-070).
`POST /api/studio/campaigns/:id/brand-check` `[premium]`: consistência
(FR-072) → itens com trecho, motivo e sugestão.

### `GET/POST/PATCH/DELETE /api/studio/templates`
Biblioteca por objetivo/estágio (FR-038/US13). `POST /api/studio/templates/seed`
(admin) instala sementes do sistema.

### `GET /api/studio/campaigns/:id/compliance`
Último parecer; re-executa com `POST` (FR-073).

---

## Agente, recomendações, analytics

### `POST /api/studio/agent/propose` `[premium]` `[quota]`
Body: `{ prompt }` → 202 `proposalId`; polling:
`GET /api/studio/agent/proposals/:id` (plan + itens).
### `POST /api/studio/agent/proposals/:id/decide`
Body: `{ items: [{key, decision, editedValue?}], confirm?: true }`.
`convert` cria campanha `origin="agent"` em `draft`/`in_review` — **nunca
ativa disparo** (FR-058).

### `GET /api/studio/campaigns/:id/recommendations?status=proposed`
### `POST /api/studio/recommendations/:id/decide`
`{ decision: "apply"|"reject" }` — aplicações com efeito externo exigem
`requiresConfirmation` + `confirm: true` (FR-059, FR-076).
### `POST /api/studio/campaigns/:id/ask` `[premium]` `[quota]`
Analista: `{ question }` → resposta com evidências (`{ sections: [{metric,
value, interpretation}] }`) (FR-077).

### `GET /api/studio/campaigns/:id/analytics?segmentId=&state=&channel=&variant=`
Funil + taxas + cortes (FR-064/065), flags `estimated` (FR-067), ROI com
`declared` vs `measured` (FR-068).
### `GET /api/studio/campaigns/:id/analytics/daily?from=&to=`
Série para gráficos (StudioMetricDaily).
### `GET /api/studio/prospects/:id/timeline?campaignId=`
Timeline unificada multi-canal (FR-066) — agregação de eventos existentes +
classificações + decisões de automação.
### `GET /api/studio/overview`
Consolidado de campanhas (FR-069).

---

## Erros semânticos (além dos códigos do repo)

| HTTP | code | Quando |
|---|---|---|
| 409 | `CAMPAIGN_LOCKED` | edição com fila em execução (FR-006) |
| 409 | `EMPTY_AUDIENCE` | aprovação com audiência 0 |
| 409 | `COMPLIANCE_BLOCKED` | parecer `block` vigente (FR-073) |
| 409 | `INVALID_TRANSITION` | máquina de estados (D2) |
| 400 | `PROTECTED_LEAD` | tentativa de incluir opt-out/supressão (FR-012) |
| 400 | `INVALID_CRITERIA_FIELD` | campo/op fora do catálogo (D3) |
| 403 | `STUDIO_AI_QUOTA` | cota diária de IA excedida (D13) |
| 402/403 | `PREMIUM_REQUIRED` | rota `[premium]` em org trial |
