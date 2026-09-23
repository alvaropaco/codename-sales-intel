# Contract — Filas, jobs e eventos internos do Studio

Fase 1 do `$speckit-plan`. O Studio **não cria eventos NATS** (research D15):
toda coordenação é BullMQ/Redis no processo da plataforma, junto às filas
`outreach:prepare | outreach:message-send | outreach:gmail-sync` e às filas
WhatsApp existentes. Princípios: job IDs determinísticos (idempotência,
constituição II), métricas prom-client e logs estruturados (constituição VII).

---

## Filas novas

### `studio:scheduler` (repeat, a cada 60s)
Varre campanhas `scheduled|running` da org e libera lotes para os motores.

- **Job id**: `studio:sched:{campaignId}:{bucket-60s}` — tick repetido nunca
  enfileira o mesmo lead/toque duas vezes.
- **Contrato do payload**: `{ campaignId }` — tudo o mais é lido do banco
  (estado é fonte da verdade, não a mensagem).
- **Loop por campanha**:
  1. janela de envio ativa? (fuso da org ou do lead — `useLeadTimezone`)
  2. cota da campanha (hora/dia) disponível?
  3. busca membros `included` do snapshot com próximo toque elegível
     (respeitando sequência de follow-ups e condições)
  4. re-checa supressão/opt-out/fadiga **agora** (defense in depth, FR-046)
  5. enfileira no motor: e-mail → job em `outreach:prepare` (lote com
     stagger existente); WhatsApp → job do `whatsapp-workers` correspondente
  6. cota de conta global: rate limiter Redis existente é a última barreira
- **Anomalias (guard-rails)**: após cada lote, `guardrails.js` avalia
  bounce/opt-out da janela recente; acima do limiar → campanha `paused`
  (`anomalyPausedAt/Reason`) + notificação (abaixo).

### `studio:journey`
Um job por transição de bloco por lead.

- **Job id**: `studio:journey:{journeyId}:{prospectId}:{blockId}:{attempt}` —
  reprocesso idempotente; `StudioJourneyLead @@unique` trava duplicidade.
- **Payload**: `{ journeyId, prospectId, blockId }`.
- **Semântica dos blocos**: `send` (enfileira toque do canal com janela/ritmo
  da campanha-pai), `wait` (grava `waitingUntil`, re-enfileira a si), 
  `condition` (avalia comportamento real: opens/clicks/replies/score/
  atributos), `update` (mutação de estado do lead no escopo do Studio),
  `end`. Condições de parada global (`reply|converted|opt_out`) checadas
  antes de cada bloco — parada em **todos** os canais (FR-053).
- **Webhook trigger**: o endpoint externo (rest-api.md) enfileira
  `studio:journey:{id}:start:{prospectId}`.

### `studio:ai-batch`
Personalização/gerações em lote (FR-048).

- **Job id**: `studio:ai:{contentId}:{prospectId}` — rerun não duplica
  (`StudioPersonalization @@unique`).
- **Payload**: `{ batchId, campaignId, contentId, prospectId, level }`.
- **Progresso**: contadores atômicos Redis (`studio:batch:{batchId}`:
  done/total/paused) consultados pelo endpoint; pausa → workers saem do loop.
- **Modelo LLM**: via `llm-client.js` (research D9); timeout por item;
  falha de item → `base_fallback` + registro (não aborta o lote).

### `studio:metrics` (repeat, a cada 5 min)
Rollup incremental `StudioMetricDaily` a partir de `OutreachEvent` /
`WhatsAppMessage` / classificações / conversões desde o último marcador
(dados-model.md). Idempotente por `@@unique([campaignId, day, channel,
variantLabel, stepIndex])` (upsert). Garante SC-007 (defasagem ≤ 5 min).

---

## Integração com motores existentes (sem alteração de contrato)

| Motor existente | Uso pelo Studio | Mudança |
|---|---|---|
| `outreach:prepare` (`outreach-workers.js`) | scheduler/journey enfileiram leads do snapshot com o conteúdo/variante do Studio | payload ganha campos **opcionais** `studioCampaignId`, `variantLabel`, `stepIndex` — workers atuais ignoram; novos consumidores usam |
| follow-ups de e-mail | sequência configurável (FR-079) | worker lê `OutreachCampaign.sequence` quando presente; ausente = `[3,5,7]` atual (comportamento preservado) |
| `whatsapp-workers` (sequence/send) | idem, com `studioCampaignId/variantLabel` | colunas opcionais; sem mudança de assinatura obrigatória |
| Gmail sync / WAHA webhook | tracking, replies, inbox | **nenhuma** — eventos continuam sendo gravados como hoje; o Studio consome |
| reengagement / saneamento 007 | respostas classificadas alimentam agentes | `StudioReplyClassification` é insumo novo, não substitui |

Regra de compatibilidade: nenhum worker existente passa a **exigir** campo
novo; todos os campos novos são opcionais e aditivos (versão de contrato
implícita `.v1` compatível).

---

## Notificações operacionais

Canal: centro de notificações in-app (`OpsNotification` já existe no schema —
reuso) + e-mail para eventos críticos da org (opt-in do usuário):

- `studio.campaign.paused_anomaly` — guard-rails pausou (com motivo)
- `studio.campaign.queue_error` — conta de envio desconectada / falha de fila
- `studio.campaign.awaiting_approval` — automação com lote aguardando revisão
- `studio.experiment.winner` — vencedor declarado

Formato: `{ orgId, type, campaignId, severity, messageKey, details }` —
sem PII de lead no payload da notificação.

---

## Métricas prom-client (constituição VII)

| Métrica | Tipo | Labels |
|---|---|---|
| `studio_scheduler_ticks_total` | counter | `result` (`ok`\|`skipped_window`\|`paused`) |
| `studio_sends_enqueued_total` | counter | `channel`, `campaignId` |
| `studio_queue_wait_seconds` | histogram | `channel` (agendado→enviado) |
| `studio_journey_leads_by_block` | gauge | `journeyId`, `blockId`, `status` |
| `studio_ai_batch_items_total` | counter | `kind`, `result` (`ok`\|`fallback`\|`error`) |
| `studio_guardrail_pauses_total` | counter | `channel`, `reason` |
| `studio_compliance_reviews_total` | counter | `level` |

Logs estruturados (JSON) com `orgId`, `campaignId`, `prospectId` quando
aplicável — mesmos limites de PII dos logs atuais.

---

## Webhook externo (única superfície nova de entrada)

`POST /api/studio/journeys/:id/webhook/:token` — ver rest-api.md.

- Autenticação: `token` opaco aleatório (≥128 bits) por journey; banco guarda
  SHA-256; comparação em tempo constante; revogável (regenerar token).
- Rate limit por token (Redis, ex.: 60/min) — 429 com `Retry-After`.
- Resposta sempre 202 (não revela existência de lead); payload mínimo
  `{ prospectRef }`; corpo ignorado além disso (sem execução de conteúdo
  arbitrário).
