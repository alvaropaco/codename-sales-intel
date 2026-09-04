# Plano: Agente de Reengajamento de Conversas WhatsApp (B2Base)

> Estratégia de implementação para reativar conversas com leads que esfriaram, com mensagens
> geradas por IA, contextualizadas com o histórico do chat, o escopo da plataforma e o CNPJ MCP.
> Escrito contra o estado real do código (setembro/2026).

---

## ✅ STATUS: MVP do dia 1 IMPLEMENTADO E TESTADO (2026-09-04)

**O que já está no código:**

| Item | Arquivo(s) |
|---|---|
| Migração (`reengageAttempts`, `reengageTotal`, `lastReengageAt`, `automationPausedAt`, `source`) | `prisma/schema.prisma` + `prisma/migrations/20260904120000_add_whatsapp_reengagement/` |
| Agente completo (scan → guard → context assembly → LLM → policy guard → shadow/auto) | `reengagement-agent.js` |
| Contexto do produto para prompts | `b2base-context.js` |
| Filas `whatsapp:reengage-scan` / `whatsapp:reengage` | `whatsapp-queues.js` |
| `source='CAMPAIGN'` no sequence | `whatsapp-workers.js` |
| Resposta do lead zera o ciclo de reengajamento | `whatsapp-engine.js` (`handleMessageEvent`) |
| Boot do agente no start() | `server-prod.js` |
| `COPY` dos módulos novos na imagem | `Dockerfile` |

**Validação executada:** `prisma validate` ✓ · `node --check` em todos os arquivos ✓ ·
smoke test de funções puras ✓ · **E2E contra Postgres real** (instância descartável, 19 migrações
aplicadas) ✓ — shadow (scan SQL encontra a conversa fria; decisão IA logada sem envio;
gap mínimo bloqueia reavaliação; guard derruba claim proibido → fallback; LLM down → fallback;
recusa explícita respeitada sem queimar tentativa) e auto (mensagem `source=REENGAGEMENT`
PENDING criada, contadores 1/1, fila `whatsapp:send` acionada; **final check**: lead respondeu
durante a geração → cancelado; opt-out via `LeadChannelState` bloqueou tudo).

**Runbook de ativação em produção:**

1. Aplicar migração: `npx prisma migrate deploy` (roda sozinho no entrypoint do container).
2. Configurar envs (Infisical → `apps/b2base` no `k8s-infra`):
   `REENGAGE_ENABLED=true`, `REENGAGE_MODE=shadow`, `REENGAGE_MAX_ATTEMPTS=3`,
   `REENGAGE_COOLDOWN_HOURS=48`, `REENGAGE_MIN_GAP_HOURS=24`, `REENGAGE_DAILY_CAP=12`,
   `REENGAGE_SCAN_INTERVAL_MIN=15`, opcional `REENGAGE_LLM_MODEL` (modelo do gateway LiteLLM
   dedicado a este agente) e `REENGAGE_MCP_EXAMPLES` (default on).
3. Deploy pelo pipeline de sempre (push → GHCR → ArgoCD sync ~3min).
4. Auditar 1–2 dias em shadow: `kubectl logs ... | grep '\[reengage\] SHADOW'` — cada linha é a
   mensagem real que iria para o lead, com a estratégia da tentativa.
5. Qualidade OK → `REENGAGE_MODE=auto` + redeploy. Freio de mão: `REENGAGE_ENABLED=false`
   (redeploy ~3min) ou botão "Não contatar" na UI por lead.

**Day 2+ (nesta ordem):** badge/pausa na WhatsAppView → tabela `WhatsAppReengagementEvent` +
modo `suggest` → métricas Prometheus/Grafana → `aiContext` + classificação de intenção →
settings por org + A/B por estratégia.

---

## 1. Diagnóstico: por que as conversas morrem hoje

Fluxo atual (tudo em `server-prod.js` + módulos raiz):

1. Campanha/suite envia o first touch (template `{{firstName}}/{{companyName}}`) via
   Bull `whatsapp:sequence` → `whatsapp:send` → WAHA.
2. Lead responde ("olá tenho interesse") → webhook `POST /webhooks/whatsapp/waha`
   (`server-prod.js:3442`) grava a mensagem e **imediatamente** coloca a conversa em
   `HUMAN_HANDOFF` + `stopAutomationForProspect()` (`whatsapp-engine.js:453`).
3. O humano responde uma vez ("legal, vou te enviar o link") — resposta manual síncrona
   (`POST /api/whatsapp/conversations/:id/messages`).
4. **Nada mais acontece.** Não existe nenhum job que consuma `lastInboundMessageAt` /
   `lastMessageAt` da `WhatsAppConversation`. A conversa morre aí.

Ou seja: o buraco não está no first touch (já automatizado) e sim na **janela pós-engajamento**,
que hoje depende 100% de memória humana. O lead respondeu, demonstrou interesse, recebeu o link e
saiu do radar — exatamente o lead mais quente do funil.

**Escopo do agente:** conversas que tiveram **pelo menos uma resposta inbound do lead** e voltaram a
esfriar. Leads que nunca responderam ao first touch ficam fora (território das sequências de
campanha, que já existem e têm limites próprios). Isso protege a reputação do número: reengajar
quem já conversou com a gente é muito menos arriscado que insistir com quem nunca respondeu.

---

## 2. Decisões de arquitetura (o que seguir e o que descartar do plano original)

O plano de referência (arquitetura event-driven com ~9 workers, NATS como transporte, RAG) está
correto conceitualmente, mas o código real permite algo muito mais simples e igualmente robusto:

| Decisão | Motivo |
|---|---|
| **Monólito, não microserviços.** Novas filas Bull + workers registrados no boot do `server-prod.js`, mesma imagem, mesmo container | É o padrão da casa (`whatsapp-workers.js`, `outreach-workers.js`). Reusa rate limiter, guardas de terminal state, JID handling, acks, métricas, auth e o pipeline CI→ArgoCD sem nenhuma mudança de deploy |
| **Banco como fonte de verdade, polling com Bull repeatable job — não NATS.** | Em produção `NATS_ENABLED=false` (Dockerfile:85); NATS é só telemetria. `WhatsAppConversation` já tem `lastInboundMessageAt`/`lastMessageAt`/`status` — o agente nasce de uma query, não de um barramento novo |
| **Envio reusa a fila `whatsapp:send` existente.** | Acks (SENT/DELIVERED/READ), JID original (`conversation.chatId`, fix 647f4e83), reconciliação de sessão e rate limit valem de graça |
| **1 chamada LLM com JSON estrito (decisão + mensagem juntas) no MVP; split Decision/Message Agent depois se a qualidade exigir** | Volume é baixo (só candidatos), custo e latência caem, e o Policy Guard determinístico continua sendo o veto duro |
| **Sem RAG/Qdrant no MVP.** Conhecimento da plataforma = módulo estruturado de contexto (`b2base-context.js`) montado no prompt | O catálogo B2Base cabe em poucos KB. CNPJ MCP entra como *tool call opcional*, não como RAG |
| **Sem locks Redis.** Idempotência por `jobId` determinístico no Bull + re-check transacional do estado da conversa no processador | O "final check" do plano original, sem infra nova |

A ideia central do plano de referência que **mantemos integralmente**: STALE ≠ mandar mensagem;
frequência limitada; valor novo por tentativa; final check anti-colisão com o humano;
nunca insistir indefinidamente; métrica de sucesso = taxa de reativação.

---

## 3. Máquina de estados da automação

Novo campo `WhatsAppConversation.automationStatus`, **separado** do `status` atual
(não sobrecarregar `HUMAN_HANDOFF`, que hoje significa apenas "lead respondeu"):

```text
                        (lead responde ≥1x)
  [sem automação] ────────────────────────────────► ENGAGED
                                                      │  sem inbound por COOLDOWN_HOURS
                                                      ▼
                                                   STALE ──(scan encontra candidato)──► REENGAGING
                                                      ▲                                   │
                              lead responde           │                    sem resposta após tentativa N
                    (zera tentativas do ciclo,        │◄────────────────────────────────────────┘
                     volta a esperar esfriar)         │
                                                      │
  tentativas esgotadas sem resposta ──────────────► CLOSED_NO_RESPONSE (fim; não insiste)
  opt-out / "não tenho interesse" / toggle manual ─► DO_NOT_AUTOMATE (fim)
```

- `HUMAN_HANDOFF` (status atual) continua sendo setado a cada inbound — o agente lê o histórico
  mas a automação é governada por `automationStatus`.
- Resposta do lead a um reengajamento **reinicia o ciclo** (tentativas do ciclo zeradas), com um
  teto vitalício (`reengageTotal`, ex.: 6 mensagens automatizadas por conversa) para nunca virar loop.

---

## 4. Pipeline (tudo no monólito, novas filas Bull)

```text
[Bull repeatable, 15 min]  whatsapp:reengage-scan
        │  query determinística de candidatos (SQL, zero LLM)
        ▼
   fila whatsapp:reengage  (jobId = reengage:<conversationId>:<attempt>  → idempotente)
        │
        ▼
[reengagement-agent.js]  Context Assembly
   ├─ b2base-context.js          (o que é o B2Base, funcionalidades, caso de uso, o que não prometer)
   ├─ CommercialSettings         (valueProposition, segmentos-alvo da própria org — "sua operação")
   ├─ Prospect                   (cnpjPartners[0] → contato, industry, city/UF, porte, enrichmentSummary)
   ├─ últimas ~15 mensagens      (WhatsAppMessage da conversa)
   ├─ aiContext                  (resumo incremental: interesse, objeções, última promessa, próximo passo)
   └─ [opcional, tentativa 2]    mcp-cnpj.js search_companies → 2–3 empresas reais do segmento/cidade
        │                        do lead = "posso te mostrar X corretoras em Sua Cidade" (demo do produto na própria mensagem)
        ▼
   LLM (LiteLLM gateway — LITELLM_URL, modelo próprio REENGAGE_LLM_MODEL)
   saída JSON estrita:
   { should_send, reason, strategy, message, next_delay_hours, updated_context }
        │
        ▼
[Policy Guard — determinístico, veto duro]
   • org flag ON + modo (shadow | suggest | auto)
   • LeadChannelState ativo + conversa não OPTED_OUT/PAUSED + automationStatus ≠ DO_NOT_AUTOMATE
   • attempt < maxAttempts (ciclo) e reengageTotal < teto vitalício
   • última mensagem automatizada ≥ REENGAGE_MIN_GAP_HOURS (24h) atrás
   • message ≤ 600 chars, ≠ (normalizada) das anteriores, sem claims proibidos (preço/desconto/garantia)
   • **final check**: re-ler conversa — se chegou inbound (ou mudou status) depois da decisão, CANCELAR
        │
        ▼
   WhatsAppMessage (PENDING, source=REENGAGEMENT) → fila whatsapp:send (path existente: WAHA, acks, JID, rate limit)
        │
        ▼
   WhatsAppReengagementEvent (auditoria: decisão, estratégia, conteúdo, status GENERATED/SENT/CANCELLED_INBOUND/BLOCKED/FAILED)
```

**Loop de resposta** (`whatsapp-engine.js handleMessageEvent`, após gravar inbound):
cancelar/remover jobs `reengage:*` pendentes da conversa; se estava em STALE/REENGAGING →
`automationStatus=ENGAGED`, tentativas do ciclo zeradas, `nextReengageAt=null`, registrar evento
`REACTED` (é a métrica principal nascendo); se o modo `auto` estiver ligado e houver classificador
de intenção (fase 2), "não tenho interesse"/opt-out → `DO_NOT_AUTOMATE`.

---

## 5. Escada de estratégia por tentativa (valor novo, nunca "vi minha mensagem")

| Tentativa | Quando (após cooldown) | Objetivo | Ângulo |
|---|---|---|---|
| 1 | 48h | Retomar contexto | Retomar exatamente onde parou (o lead pediu, o link foi enviado) + perguntar se conseguiu acessar. Tom: continuidade, não cobrança |
| 2 | +3–4 dias | Valor novo concreto | Consulta CNPJ MCP: 2–3 empresas reais do segmento/cidade do lead. "Separei 3 escritoras de Sua Cidade que caberiam no perfil que você procura — quer ver?" É a própria plataforma se demonstrando |
| 3 | +4–5 dias | Novo ângulo | Reframe: "não é uma lista de empresas, é encontrar empresas com características X e transformar em oportunidade" — ancorado no CNAE/porte do lead |
| 4 (breakup) | +7 dias | Fechar com elegância | "Vou encerrar por aqui para não incomodar; me chama quando quiser testar" → `CLOSED_NO_RESPONSE`. Nunca mais自动 na conversa |

Os delays são default por org (`CommercialSettings`), a IA pode sugerir `next_delay_hours`
(ex.: "me chama semana que vem" detectado no histórico adia a próxima tentativa).

Cada tentativa usa o modelo via LiteLLM (`REENGAGE_LLM_MODEL`, default o mesmo `LITELLM_MODEL`).
O gateway já está operado por vocês — trocar para um modelo maior só para este agente é mudar 1 env.
Fallback: templates pt-BR por estratégia (mesmo padrão do `_templateFallback` do email), para o
agente nunca ficar sem mensagem.

---

## 6. Mudanças concretas no código

### 6.1 Prisma (`prisma/schema.prisma`) — 1 migração

```prisma
model WhatsAppConversation {
  // ... existente
  automationStatus   String    @default("OFF") // OFF|ENGAGED|STALE|REENGAGING|CLOSED_NO_RESPONSE|DO_NOT_AUTOMATE
  automationPausedAt DateTime?
  reengageAttempts   Int       @default(0)      // no ciclo atual
  reengageTotal      Int       @default(0)      // vitalício (teto anti-loop)
  nextReengageAt     DateTime?
  aiContext          Json?                      // resumo incremental mantido pelo agente
  aiContextAt        DateTime?
  lastReengageAt     DateTime?
}

model WhatsAppMessage {
  // ... existente
  source String @default("MANUAL") // MANUAL|CAMPAIGN|REENGAGEMENT
}

model WhatsAppReengagementEvent {
  id             String   @id @default(cuid())
  orgId          String
  conversationId String
  prospectId     String?
  attempt        Int
  strategy       String
  reason         String?            // justificativa da IA
  content        String?            // mensagem gerada
  mode           String             // shadow|suggest|auto
  status         String             // GENERATED|SENT|CANCELLED_INBOUND|BLOCKED_GUARD|FAILED|REACTED
  sentMessageId  String?
  createdAt      DateTime @default(now())
  @@index([orgId, createdAt])
  @@index([conversationId])
}

model CommercialSettings {
  // ... existente
  reengageEnabled        Boolean @default(false)
  reengageMode           String  @default("shadow") // shadow|suggest|auto
  reengageMaxAttempts    Int     @default(3)
  reengageCooldownHours  Int     @default(48)
}
```

### 6.2 Módulos novos (raiz, CommonJS, padrão da casa)

| Arquivo | Responsabilidade |
|---|---|
| `b2base-context.js` | Conhecimento estruturado da plataforma p/ prompt (produto, público, funcionalidades, casos de uso, regras do que não prometer). Revisado a cada mudança de posicionamento |
| `reengagement-scheduler.js` | Job repeatable `whatsapp:reengage-scan` (15 min) + query de candidatos + enqueue `whatsapp:reengage` com jobId determinístico |
| `reengagement-agent.js` | Context assembly, chamada LiteLLM (JSON estrito), Policy Guard, criação da mensagem `source=REENGAGEMENT`, gravação de `WhatsAppReengagementEvent`, fallback por templates |

Query de candidatos (o gate determinístico — 90% das conversas nunca chegam ao LLM):

```sql
SELECT c.* FROM WhatsAppConversation c
JOIN CommercialSettings s ON s.orgId = c.orgId AND s.reengageEnabled
LEFT JOIN LeadChannelState l ON l.prospectId = c.prospectId AND l.channel = 'whatsapp'
WHERE c.automationStatus IN ('STALE','REENGAGING')
  AND c.status NOT IN ('OPTED_OUT','PAUSED')
  AND (l.status IS NULL OR l.status = 'active')
  AND c.reengageAttempts < s.reengageMaxAttempts
  AND c.reengageTotal < 6
  AND (c.nextReengageAt IS NULL OR c.nextReengageAt <= now())
  AND (c.lastReengageAt IS NULL OR c.lastReengageAt < now() - interval '24 hours')
  AND EXISTS (SELECT 1 FROM WhatsAppMessage m           -- lead já engajou alguma vez
              WHERE m.conversationId = c.id AND m.direction = 'INBOUND')
  AND c.lastMessageAt < now() - (s.reengageCooldownHours || ' hours')::interval
  AND NOT EXISTS (SELECT 1 FROM WhatsAppMessage m       -- última mensagem é NOSSA e ficou sem resposta
                  WHERE m.conversationId = c.id
                  AND m.createdAt > COALESCE(c.lastInboundMessageAt, to_timestamp(0)))
ORDER BY c.lastMessageAt ASC LIMIT 25;                   -- lote pequeno, respeita rate limit
```

Transição `ENGAGED → STALE` pode ser calculada na mesma query (estado derivado na leitura) —
sem job extra.

### 6.3 Pontos de integração no código existente

- `whatsapp-workers.js`: registrar processors `whatsapp:reengage-scan` (concurrency 1) e
  `whatsapp:reengage` (concurrency 2); novo par de filas em `whatsapp-queues.js` (segue o padrão).
- `whatsapp-engine.js`: no `handleMessageEvent` (após dedup), bloco "inbound → cancela reengajamento
  pendente + transição de estado + evento REACTED". No `stopAutomationForProspect`, também parar
  reengajamento (opt-out/dnç continuam valendo para o novo fluxo).
- `server-prod.js`: registrar scheduler no boot (junto de `whatsappWorkers.registerAllWorkers()`,
  ~linha 4042); rotas novas:
  - `GET/PATCH /api/whatsapp/automation/settings` (org: enable, modo, tentativas, cooldown)
  - `GET /api/whatsapp/conversations/:id/automation` (estado, próxima ação, histórico de eventos)
  - `POST /api/whatsapp/conversations/:id/automation/pause` / `/resume` / `/disable`
  - modo `suggest`: `GET /api/whatsapp/automation/suggestions` + `POST .../suggestions/:id/approve|edit|discard`
- `metrics.js`: counters `b2base_reengage_candidates_total`, `_decisions_total{decision}`,
  `_messages_sent_total`, `_reactivated_total`, `_optouts_total` (métrica de segurança: se opt-out
  pós-reengajamento subir, as bottas de segurança fecham primeiro) + painel no
  `monitoring/b2base-outreach-dashboard.json`.
- `Dockerfile`: `COPY` dos 3 módulos novos (padrão existente).

### 6.4 UI (`apps/web`)

- `WhatsAppView.tsx`: badge de automação por conversa (estado + próxima ação + tentativa N/M),
  botões pausar/desativar; painel de configuração da org (enable, modo, tentativas, cooldown).
- Modo `suggest`: fila de sugestões (mensagem gerada + por quê) com Enviar/Editar/Ignorar —
  é o dataset de aprovações que depois calibra o modo `auto`.

### 6.5 Infra k3s — **zero mudanças no MVP**

O agente roda dentro do container atual (workers in-process), enviado pelo pipeline existente
(`.github/workflows/build.yml` → GHCR → values.yaml do `k8s-infra` → ArgoCD). Novas envs
(Infisical, prefixo `REENGAGE_*`): `REENGAGE_ENABLED`, `REENGAGE_SCAN_INTERVAL_MIN`,
`REENGAGE_LLM_MODEL`, `REENGAGE_MCP_EXAMPLES`, limites via `WHATSAPP_*` existentes.
Se um dia precisar escalar/resilência separada: mesmo worker como Deployment adicional no
`k8s-infra` com `B2BASE_ROLE=workers` — evolução, não pré-requisito.

WAHA segue intocado: reengajamento envia pelo mesmo `whatsapp:send` → mesma sessão por org
(`deterministicSessionName`), mesmo JID handling.

---

## 7. Cronograma: **1 dia (MVP em produção)**

> ⚡ **Escopo comprimido a pedido: tudo em produção em 1 dia de trabalho (~8–9h).**
> Corta-se interface, governança e refinamento; mantém-se o motor completo com limites
> conservadores. As seções 6.1–6.4 acima descrevem a visão completa — o que segue é o
> subconjunto que efetivamente entra no dia 1, e o que fica para depois.

### O que entra no dia 1

| # | Entrega | Tempo |
|---|---|---|
| 1 | **Migração mínima** (ADD COLUMN com default, online): `WhatsAppConversation` += `reengageAttempts`, `reengageTotal`, `lastReengageAt`, `automationPausedAt`; `WhatsAppMessage` += `source`. **Sem** máquina de estados (derivada na query), **sem** `aiContext` (o histórico cru das últimas ~15 mensagens basta), **sem** tabela de eventos (logs estruturados) | 1h |
| 2 | **`reengagement-agent.js`** (arquivo único): job repeatable 15 min → query de candidatos (§6.2, usando só campos existentes + os 3 novos) → context assembly (`b2base-context.js` + valueProposition + Prospect + últimas 15 msgs) → 1 chamada LiteLLM com JSON estrito → Policy Guard (tentativas, gap 24h, tamanho, duplicidade, **final check**: última mensagem INBOUND ⇒ cancela) → cria `WhatsAppMessage` `source=REENGAGEMENT` → fila `whatsapp:send` | 3h |
| 3 | **Escada de estratégia por tentativa + fallback templates** (mesmo arquivo; ângulo = função do nº de tentativa). **MCP `search_companies` na tentativa 2**, best-effort (falha ⇒ mensagem sem exemplos) | incluído |
| 4 | **Inbound em `whatsapp-engine.js`**: resposta do lead zera `reengageAttempts` (novo ciclo); opt-out/DNC já existentes continuam valendo como corte definitivo | 45min |
| 5 | **Teste em shadow local**: seed de conversas frias reais, `REENGAGE_MODE=shadow`, iterar prompt até as mensagens ficarem boas | 1h30 |
| 6 | **Deploy + ativação**: pipeline existente (GHCR → ArgoCD, sync ~3min), 1ª hora em shadow em prod, depois flip `REENGAGE_MODE=auto` | 1h |
| 7 | **Monitoramento**: logs + conferir envios no WhatsApp real; cap inicial de 10–15 msgs/dia (LIMIT do scan + `WHATSAPP_RECIPIENT_DAILY_LIMIT` existente) | contínuo |

Config só por env (Infisical), sem schema de settings: `REENGAGE_ENABLED`, `REENGAGE_MODE`
(`shadow`|`auto`), `REENGAGE_MAX_ATTEMPTS=3`, `REENGAGE_COOLDOWN_HOURS=48`, `REENGAGE_DAILY_CAP=12`,
`REENGAGE_LLM_MODEL`. Kill switches no dia 1 (sem UI nova): flag de env (redeploy ArgoCD ~3min) e
o botão **"Não contatar"** que já existe no WhatsAppView (`LeadChannelState` já bloqueia o scan).

### Day 2 — IMPLEMENTADO (2026-09-04)

- Tabela `WhatsAppReengagementEvent` (migração `20260904160000`): auditoria de toda decisão do
  agente (`GENERATED`/`SENT`/`BLOCKED_GUARD`/`REFUSED_IA`/`CANCELLED_INBOUND`) + fila de aprovação.
- **Modo `suggest`**: agente gera a mensagem e aguarda aprovação humana. O scan não duplica
  sugestão pendente; aprovar revalida os guardas e o final check (lead respondeu entretanto →
  sugestão vira `CANCELLED_INBOUND`); edição do operador passa de novo pelo policy guard.
- Pausa/reativação de automação por conversa (`automationPausedAt`), respeitada pelo scan.
- Rotas: `GET /api/whatsapp/automation/config`, `GET /api/whatsapp/automation/suggestions`,
  `POST .../suggestions/:id/approve|discard`,
  `GET /api/whatsapp/conversations/:id/automation`, `POST .../automation/pause|resume`.
- UI (`WhatsAppView`): badge de reengajamento (🤖 N/M) na lista e no cabeçalho da conversa,
  botão pausar/reativar auto, painel de sugestões com Enviar/Editar/Descartar.
- E2E contra Postgres real: suggest 7/7 ✓ · shadow e auto gravando eventos ✓.

### O que fica para o day 3+ (nesta ordem)

1. Métricas Prometheus (`_messages_sent_total`, `_reactivated_total`, `_optouts_total`) + painel Grafana.
2. `aiContext` (resumo incremental) e classificação de intenção no inbound ("me chama semana que vem" → agenda).
3. Settings por org na `CommercialSettings`; A/B por estratégia (agregar por `strategy` nos eventos).

### Descoberta em produção (2026-09-04): chats LID sem Prospect — agente relaxado

Diagnóstico no banco de produção: 59 conversas = **21 grupos de WhatsApp** (JIDs `@g.us`,
corretamente fora do escopo) + conversas reais. As conversas onde o lead respondeu e o humano
já devolveu (o caso-alvo do agente) chegam como **JID LID** (identificador interno do WhatsApp,
não o telefone real) → `prospectId = null`, porque `findProspectIdForPhone` não consegue casar
LID com o telefone do cadastro. A WAHA não expõe o mapa LID→telefone (endpoints de
contatos/chats exigem `noweb.store.enabled` + `full_sync`, que exigem recriar as sessões).

**Adaptação implementada:** o agente agora trabalha sem Prospect — o scan exclui grupos
(`chatId NOT LIKE '%@g.us'`, telefone ≤15 dígitos) em vez de exigir cadastro, e o prompt usa o
**histórico da conversa como contexto** com regra explícita de NÃO inventar nome/empresa/segmento.
Fallbacks sem nome também cobertos. Consequência: sem cadastro não há personalização por
firmografia nem exemplos do CNPJ MCP (tentativa 2 fica genérica).

**Caminho ideal (decisão pendente):** (a) habilitar o store da noweb na WAHA (recriar sessões,
novo QR) para resolver LID→telefone e vincular automaticamente; ou (b) ação manual "vincular
lead" no inbox para o operador associar a conversa ao Prospect. Enquanto isso, o modo atual
funciona com qualidade um pouco menor para chats LID.

### Store NOWEB habilitado + backfill LID→Prospect (2026-09-04, executado em produção)

1. **Store habilitado via GitOps** (`k8s-infra/apps/b2base-waha`): envs `WAHA_NOWEB_STORE_ENABLED`
   e `WAHA_NOWEB_STORE_FULL_SYNC` (⚠ o prefixo `WHATSAPP_NOWEB_*` é ignorado pela engine).
   A config da sessão é persistida na criação: para ativar o store foi preciso **recriar a
   sessão** (delete + create + novo QR — pareamento refeito em 2026-09-04).
2. **Mapa LID→telefone**: mesmo com o endpoint `chats/overview` ainda bloqueado para a sessão
   (config antiga), a engine grava `lid-mapping-*.json` em
   `/app/.sessions/noweb/<sessão>/` — **nome do arquivo = telefone real (PN), conteúdo = LID**
   (e os `_reverse` ao contrário). 2.546 mapeamentos já gravados.
3. **Backfill executado**: 17 de 20 conversas LID resolvidas para telefone real; **6 vinculadas
   ao Prospect** (via contatos de campanha, com variante com/sem o 9 do celular), incluindo as 5
   conversas-alvo do reengajamento. As outras 10 (telefone resolvido, sem match de cadastro) e 3
   LIDs ainda sem mapeamento usam o caminho relaxado (histórico como contexto).
4. **Pendências**: (a) a API de consulta do store (`chats/overview`, `contacts/check-exists`)
   só ativa em sessão criada JÁ com o store — nova recriação de sessão desbloquearia; (b)
   automatizar o vínculo (job que lê os `lid-mapping-*.json` — requer volume compartilhado ou
   endpoint exposto); (c) corrigir `phoneNumber` das conversas LID para o telefone real (hoje
   só o `prospectId` foi vinculado; envio continua pelo `chatId` LID, que funciona).

### Risco assumido no dia 1 e mitigação

Sem modo `suggest`, a IA envia sem aprovação humana. Mitigações: (a) iteração de prompt em shadow
*antes* do auto, (b) caps agressivos (3 tentativas, gap 24h, cap diário, teto vitalício 6),
(c) só reengaja quem **já respondeu** (população de baixo risco), (d) opt-out por keyword +
"Não contatar" como freio de mão imediato. Se qualquer mensagem sair ruim: flag off + redeploy
em ~3 minutos para o dano parar.

---

### Anexo: rollout original em 4 fases (referência, substituído pelo cronograma de 1 dia)

| Fase | Entrega | Risco | Prazo |
|---|---|---|---|
| **0. Fundação** | Migração Prisma + `b2base-context.js` + wiring de workers/queues | zero (nada envia) | 1–2 dias |
| **1. Shadow** | Scheduler + agente + guard rodando com `reengageMode=shadow`: gera decisão+mensagem, grava eventos, **não envia**. Você audita no banco/UI por 1 semana: as mensagens fazem sentido? O gate está pegando as conversas certas? | zero | +2–3 dias |
| **2. Suggest** | Mensagens aparecem no inbox para aprovar (Enviar/Editar/Ignorar). Um clique. Coleta o dataset de qualidade | mínimo (humano no loop) | +2 dias |
| **3. Auto** | `reengageMode=auto`: envia sozinho dentro do Policy Guard, com limites conservadores (3 tentativas/ciclo, 24h mínimo entre automatizadas, horário comercial via rate limiter existente, teto vitalício 6) | controlado | +1 dia |
| **4. Iteração** | Classificação de intenção no inbound (interessado / depois / não), "me chama semana que vem" → agenda; A/B por estratégia (campo `strategy` já é gravado por evento — só agregar) | — | contínuo |

**Critério de sucesso** (o que o dashboard mostra): taxa de reativação = conversas com inbound
em ≤48h após reengajamento ÷ mensagens de reengajamento enviadas; secundárias: respostas positivas
(classificador de intenção), conversas para `CLOSED_NO_RESPONSE` vs reativadas, e **opt-outs
pós-reengajamento** (a métrica que protege o número).

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Ban do número WABA por automação | Só reengaja quem já respondeu; rate limiter existente; horário comercial; teto vitalício; opt-out keyword já interceptado no engine; métrica de opt-out pós-reengajamento com corte automático (pausar org se >X%) |
| Colisão IA × humano (IA fala depois que o lead respondeu) | Final check no processador: inbound > timestamp da decisão ⇒ cancela. jobId determinístico evita duplicidade |
| IA inventar fato (preço, promessa) | `b2base-context.js` com regras negativas explícitas + regex blocklist no guard + fallback template |
| Mensagem repetida/genérica | Guard compara conteúdo normalizado com envios anteriores; escada de estratégias obrigatórias por tentativa |
| LLM fraco p/ vendas em pt-BR | `REENGAGE_LLM_MODEL` no gateway LiteLLM independente do modelo de email; qualidade auditada no modo shadow antes de qualquer envio |
| Migração em tabela quente (`WhatsAppConversation`) | Só ADD COLUMN com defaults — Prisma `migrate deploy` online, sem lock longo |

---

## 9. Resumo executivo

Reusar ~90% do que existe: Bull/Redis, engine WAHA, rate limiter, LeadChannelState, LiteLLM,
CNPJ MCP, ArgoCD. Construir: 1 migração, 3 módulos, 1 job repeatable, 1 guard determinístico,
poucas rotas e um badge na UI. A inteligência está em (a) o gate determinístico que decide quem
merece uma chamada de LLM, (b) o contexto montado (histórico + resumo + CNPJ MCP + contexto B2Base)
e (c) o guard que garante que a IA nunca fale demais. O rollout shadow→suggest→auto elimina o risco
de colocar o agente no ar sem validação.
