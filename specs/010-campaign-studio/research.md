# Research — Campaign Studio (010)

Fase 0 do `$speckit-plan`. Cada decisão segue o formato **Decisão /
Racional / Alternativas consideradas**. A spec (com as clarificações da
sessão 2026-09-23) é a fonte de verdade funcional; aqui se decide o **como**.

---

## D1 — Camada de produto sobre os motores existentes (não um motor novo)

**Decisão**: `StudioCampaign` é a entidade de produto (conteúdo, audiência
congelada, agenda, journey, experimento, analytics) que **compila para
execuções de canal existentes**: 1 `OutreachCampaign` (e-mail) e/ou 1
`WhatsAppCampaign` por campanha Studio, criadas e geridas por
`studio/channel-bridge.js`. Envio, tracking (pixel + Gmail History), sync de
replies, inbox WhatsApp e reengagement continuam nos workers atuais
(`outreach-workers.js`, `whatsapp-workers.js`). O Studio adiciona dois
workers próprios: `studio:scheduler` (ritmo/janelas) e `studio:journey`
(estados por lead), mais o batch de IA.

**Racional**: tracking, detecção de reply, follow-ups e inbox são a parte
mais difícil e mais testada do sistema; duplicá-los seria risco sem ganho. O
motor atual já suporta sequência por lead (`OutreachContact.nextFollowupAt`,
`WhatsAppCampaignContact.nextSendAt`) — o Studio apenas decide **quando**
liberar cada lead para o motor, dentro da janela/ritmo.

**Alternativas consideradas**:
- *Motor de envio novo e paralelo* — rejeitado: duplicaria sync/tracking
  (Gmail History, webhooks WAHA) e criaria dois comportamentos divergentes.
- *Estender `OutreachCampaign` com todos os campos do Studio* — rejeitado:
  mistura produto (segmento, journey, experimento) com execução; a suíte
  `on_enrichment` existente continua funcionando sem migração.

---

## D2 — Estados e fluxo de aprovação (US1 + guard-rails do clarify)

**Decisão**: máquina de estados própria em `StudioCampaign.status`:
`draft → in_review → approved → scheduled → running → paused → completed |
cancelled` (+ `retained` quando o saneamento 007 retém conteúdo). A
aprovação grava `approvedBy/approvedAt` e congela a audiência no mesmo
momento (snapshot). Guard-rails para automações opt-in (`trigger=on_enrichment`
adotadas pelo Studio): aprovação do **primeiro lote** (amostra real de
mensagens) grava `firstBatchApprovedAt`; `studio/guardrails.js` avalia
anomalias (taxa de bounce/opt-out da janela recente acima de limiares por
canal) e pausa com motivo (`anomalyPausedAt/anomalyReason`), retomando só
com ação humana.

**Racional**: implementa FR-003/FR-006/FR-007 e a decisão de clarify sem
quebrar a suíte existente, que só adota guard-rails quando gerida pelo Studio.

**Alternativas**: aprovação total inclusive para automações (rejeitada no
clarify — elimina o "zero toque"); manter automação fora do Studio
(rejeitada — preserva o risco que motivou a feature).

---

## D3 — Segmentos: critérios estruturados resolvidos em query, nunca SQL de usuário

**Decisão**: `StudioSegment.criteria` é um documento JSON versionado
(`{field, op, value}[]` combinadas por AND, com grupos OR explícitos) sobre
um **catálogo fechado de campos** do lead: `industry`, `city`, `state`,
`region` (derivada de `state`), `revenueEstimate`, `employees`,
`opportunityScore`, `verdict`, `status`, `enrichmentStatus`, `creditRiskScore`,
`lastContact`, `contactedChannels`, CNAE (quando disponível via
enriquecimento/discovery), `createdAt`. `studio/segment-service.js` traduz
critérios → `prisma.prospect.findMany/count` com whitelist de campos/ops
(transferência de acesso do lexicográfico para o código). Segmento por
linguagem natural (FR-014): LLM produz o **mesmo** documento JSON, nunca SQL.

**Racional**: audiência é o coração de segurança da feature (FR-008–FR-015);
whitelist elimina injeção semântica e torna o resultado auditable. Com 50k
leads/org e índices existentes (`status`, `tenantId/orgId`), `count` fica
muito abaixo do alvo de 2s; snapshot materializa IDs uma única vez.

**Alternativas**: query builder genérico no front (rejeitado — superfície de
abuso e acoplamento ao schema); JSONPath/filtros livres (rejeitado —
impossível auditar).

---

## D4 — Audiência congelada como tabela materializada

**Decisão**: aprovação cria `StudioAudienceSnapshot` (counts + versão dos
critérios) com membros em `StudioAudienceMember` (prospectId, variante de
experimento, incluído/excluído + `excludeReason` — motivo legível:
`opt_out`, `suppressed`, `recent_contact`, `manual`, `fatigue`). O scheduler
só envia para membros `included` que ainda não completaram o toque, re-checando
opt-out/supressão **no momento do envio** (defense in depth — um lead que
descada depois do congelamento é barrado na fila).

**Racional**: FR-013 exige congelamento; materializar IDs permite contagem
estável, divisão de A/B determinística e cortes de analytics por snapshot sem
re-executar o segmento. A re-checagem na fila cumpre FR-046/edge case de
opt-out no meio da campanha.

**Alternativas**: re-resolver o segmento a cada envio (rejeitado — viola o
congelamento e muda a audiência no meio do disparo); só arrays JSON na
campanha (rejeitado — 50k IDs em Json degrada consultas e A/B).

---

## D5 — Scheduler: repeat job + filas dos motores, com cotas de conta globais

**Decisão**: worker `studio:scheduler` (BullMQ repeat, 60s) varre campanhas
`running`/`scheduled` e, para cada uma dentro da janela de envio (fuso da
org ou do lead, configurável), enfileira lotes de leads no motor de canal
correspondente respeitando: limite por hora/dia da campanha (`StudioSchedule`
embutido na campanha: `windows`, `hourlyLimit`, `dailyLimit`, `timezone`)
e os rate limiters **globais por conta** já existentes
(`outreach-rate-limiter.js`, `whatsapp-rate-limiter.js` — Redis). Previsão de
conclusão (FR-020) é cálculo determinístico no service (audiência restante ÷
ritmo × mapa de janelas). Pausa/retomada/aceleração são mutações de estado
lidas pelo scheduler no próximo tick.

**Racional**: os rate limiters atuais já são compartilhados por conta
(FR-019 resolvido sem código novo de throttling); o scheduler do Studio
governa o **quando**, o motor governa o **como**. Tick de 60s dá granularidade
suficiente para os limites mínimos de minuto existentes.

**Alternativas**: cron por campanha (rejeitado — explosão de jobs e
dificuldade de pausa global); enviar direto no POST (é o comportamento atual
problemático).

---

## D6 — Dependência nova: `@dnd-kit/core` (editor drag-and-drop)

**Decisão**: usar `@dnd-kit/core` (+ `@dnd-kit/sortable`) para o editor de
e-mail drag-and-drop completo decidido no clarify (blocos livres, colunas,
redimensionamento).

**Racional**: o usuário escolheu explicitamente DnD completo na v1; dnd-kit é
o padrão de mercado em React com suporte a teclado/touch (acessibilidade),
mantido e leve (~12kB gzip). Implementar DnD nativo (HTML5) daria trabalho
maior com resultado pior (sem touch, sem a11y).

**Alternativas**: DnD nativo HTML5 (rejeitado — fragilidade/sem touch);
`react-dnd` (rejeitado — API antiga, pesado para o mesmo efeito);
`framer-motion` Reorder (já é dependência, mas só resolve reordenação
simples — não canvas com colunas/resize).

---

## D7 — Dependência nova: `mjml` (blocos → HTML responsivo)

**Decisão**: o editor salva um documento JSON de blocos; o backend renderiza
blocos → MJML → HTML responsivo com CSS inline (`studio/` usa o pacote
`mjml` server-side). Geração por IA também produz/consome o mesmo documento
de blocos (IA edita blocos, não HTML cru).

**Racional**: compatibilidade de clientes de e-mail (Outlook, Gmail app,
dark-mode) é o risco técnico dominante de "HTML de e-mail feito à mão";
MJML é o compilador padrão desse problema, roda server-side em Node, sem
serviço externo. Um único renderer garante que preview == envio (SC-006).

**Alternativas**: templates de blocos com CSS inline artesanal (rejeitado —
custo de manutenção alto e regressões por cliente de e-mail que só aparecem
em produção); MJML direto sem camada de blocos (rejeitado — o editor visual
precisa de um documento estruturado editável, não de XML).

---

## D8 — Dependências novas: `pdf-parse`, `mammoth` (Campaign from Material)

**Decisão**: extração de texto v1: PDF → `pdf-parse`; DOCX → `mammoth`;
PPTX → unzip + parse do XML de slides (implementação local, sem dependência
extra — pptx é um zip de XML); imagem → modelo multimodal via `llm-client.js`
(quando configurado) com fallback para descrição manual obrigatória; vídeo →
sem transcrição na v1: o Studio aceita o upload para referência/brand kit e
pede descrição/pontos-chave manual (documentado como limitação); URL →
`fetch` + extração de texto do HTML (parse próprio leve, sem headless
browser).

**Racional**: cobre os formatos prometidos (FR-023) com dependências mínimas
e pequenas; vídeo com STT exigiria infra de transcrição nova (fora do
escopo/custo v1) e a spec aceita "legendagem disponível" como insumo manual.

**Alternativas**: serviço Python de extração (rejeitado — constituição VI,
carga não justifica novo serviço); `pdfjs-dist` no server (rejeitado —
pesado para uso server-side); LangChain/unstructured (rejeitado —
dependências grandes para o mesmo efeito).

---

## D9 — IA: módulos `studio/ai/*` sobre `llm-client.js`

**Decisão**: toda geração passa por `llm-client.js` (gateway LiteLLM já
usado por `ai-campaign.js`, `deep-analysis.js`, WhatsApp). Modelos: default
barato para classificações/extrações leves, `premiumModel()` para composição
de campanha/personalização (mesma env `AI_CAMPAIGN_LLM_MODEL` usada hoje).
Prompts recebem os 3 pilares já estabelecidos (`org-context.js` → pilar 1,
proposta da campanha → pilar 2, dados do lead → pilar 3) mais Brand Voice
quando configurada. Toda saída estruturada usa `jsonMode` +
`parseJsonLoose`. Personalização em lote (FR-047–FR-051) roda em fila
própria `studio:ai-batch` com job idempotente por (campanha, lead, conteúdo)
e progresso consultável.

**Racional**: reuso direto da infraestrutura existente (constituição VI);
separar em módulos por capacidade evita repetir o padrão de cópias inline
criticado em `outreach-workers.js`.

**Alternativas**: novo provider/SDK de IA (rejeitado — sem justificativa);
chamadas inline nos workers (rejeitado — padrão que a própria codebase já
sinaliza como débito).

---

## D10 — A/B e otimização: assignment determinístico por hash

**Decisão**: divisão A/B no momento do congelamento: cada
`StudioAudienceMember` recebe `variantLabel` por hash determinístico
(`sha256(campaignId:prospectId:experimentId) mod pesos`), estável entre
re-execuções. Vencedor declarado por critério configurado (métrica-objetivo
entre `replyRate/clickRate/openRate/conversionRate`, mínimo por variante,
limiar de significância por teste de duas proporções — implementação local,
sem dependência estatística). Otimização contínua (opcional, FR-062) ajusta
os pesos a cada janela de avaliação com registro em timeline.

**Racional**: determinístico = reprojetável em testes e auditável; teste de
duas proporções é ~30 linhas e evita dependência de biblioteca estatística
para um uso único.

**Alternativas**: randomização por envio (rejeitado — um lead pode receber
variantes diferentes em toques diferentes); lib estatística (Multi-armed
bandit completo fica para quando a otimização contínua pedir — YAGNI na v1).

---

## D11 — Analytics: rollup diário pré-agregado

**Decisão**: `studio/analytics-service.js` mantém `StudioMetricDaily`
(campanha × dia × canal × variante × toque) atualizado por job incremental
(ancorado nos eventos já gravados: `OutreachEvent`, `WhatsAppMessage`,
classificações, conversões) + recálculo sob demanda ao abrir dashboard se
houver eventos não agregados. Timeline individual do lead (FR-066) é
**agregação no endpoint** de `OutreachEvent` + `WhatsAppMessage` +
`StudioReplyClassification` — sem tabela nova de timeline. Métricas
inferidas (abertura/entrega de e-mail) carregam flag `estimated` do próprio
evento.

**Racional**: dashboards com 50k leads não podem agregar on-the-fly por
request; rollup diário atende SC-007 (5 min de defasagem) com custo baixo.
Evitar tabela de timeline evita duplicar a fonte da verdade já existente.

**Alternativas**: agregação on-the-fly (rejeitado — latência e custo de CPU);
event store novo para o Studio (rejeitado — duplica eventos dos motores).

---

## D12 — Front: shell próprio em `/studio` com tema dark forçado

**Decisão**: `apps/web/src/studio/StudioApp.tsx` é renderizado pelo `App.tsx`
quando `pathname` inicia com `/studio` (antes do shell de tabs atual), com
wrapper que força `className="dark"` (tokens `.dark` já existem em
`index.css`). Navegação interna por pathname próprio (`/studio/campaigns`,
`/studio/audience/:id`, `/studio/analytics/:id`...), sem react-router
(padrão atual: `tabFromPath`). Reaproveita: `services/api.ts` (novo cliente
`studio/api.ts` seguindo o mesmo padrão), primitivas `ui/*`, recharts,
`@xyflow/react` (canvas de journeys), `@dnd-kit` (editor).

**Racional**: atende "página separada com UI diferente, tema dark" sem
introduzir router (decisão de arquitetura atual mantida) nem app separado
(auth/build duplicados).

**Alternativas**: nova tab no shell existente (rejeitado — explicitamente
contra o pedido); SPA separada com build próprio (rejeitado — duplica auth,
deploy e tipos).

---

## D13 — Gating por plano e cotas

**Decisão**: rotas base do Studio: qualquer plano. Rotas de IA avançada
(compose por material/URL, personalize em lote, agent, otimização contínua,
analista, translate): `assertPremiumOrg`. Cotas de uso premium
(generações/dia) registradas em contadores Redis por org (padrão do
`AI_CAMPAIGN_DAILY_LIMIT` atual), com resposta 402/403 semântica e mensagem
de upgrade. Trial mantém `plan-masking.js` intocado — o Studio só expõe
dados que as views atuais já liberam para o plano.

**Racional**: decisão de clarify (freemium) + coerência com gating existente
de campanhas IA; contadores Redis evitam nova tabela de quota.

**Alternativas**: Studio premium-only (rejeitada no clarify); cotas em
tabela (rejeitado — estado extra sem necessidade).

---

## D14 — Observabilidade e idempotência dos workers novos

**Decisão**: jobs dos workers novos usam IDs determinísticos
(`studio:sched:{campaignId}:{tickBucket}`, `studio:journey:{campaignId}:{prospectId}:{blockId}`,
`studio:ai:{contentId}:{prospectId}`) — reprocessar não duplica estado
(princípio II). Métricas prom-client: `studio_scheduler_ticks_total`,
`studio_sends_enqueued_total{channel}`, `studio_journey_leads_by_block`,
`studio_ai_batch_progress`, `studio_guardrail_pauses_total`. Logs
estruturados por campanha/lead-ID (sem PII além do que os logs atuais já
carregam).

**Racional**: constituição II e VII; padrão já estabelecido em
`nats-enrichment.js`/`outreach-workers.js`.

**Alternativas**: sem métricas novas (rejeitado — fluxo crítico novo exige
observabilidade).

---

## D15 — Sem mudanças em contratos NATS; único evento novo é interno

**Decisão**: o Studio não publica novos eventos NATS (`*.v1` intocados). A
comunicação entre scheduler/journeys/motores é por BullMQ (filas internas do
processo da plataforma, como hoje). O webhook externo de journey (FR-054) é
HTTP autenticado por token opaco por campanha (hash SHA-256 no banco,
comparação em tempo constante), recebendo `{prospectRef}` — apenas inicia
journey para um lead existente da org.

**Racional**: NATS é a fronteira entre serviços; o Studio vive dentro do
serviço da plataforma. Evitar `.v2` desnecessário.

**Alternativas**: eventos `studio.campaign.*.v1` no NATS (rejeitado —
nenhum consumidor externo hoje; adiar até existir).
