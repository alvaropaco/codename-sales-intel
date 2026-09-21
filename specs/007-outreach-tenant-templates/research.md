# Research — 007-outreach-tenant-templates

Fase 0 do `$speckit-plan`. Cada decisão resolve uma questão de design derivada da
spec clarificada. Base de exploração: `ai-campaign.js`, `whatsapp-workers.js`,
`outreach-workers.js`, `whatsapp-utils.js`, `campaign-suite.js`, `org-context.js`,
`server-prod.js`, `prisma/schema.prisma`, `apps/web/src/components/views/WhatsAppView.tsx`.

## D1 — Como compor a mensagem base sem texto interno (FR-002, FR-006)

**Decision**: Nova função de composição (em `ai-campaign.js`, exportada) que monta a
mensagem base **apenas a partir de uma whitelist** do perfil comercial carregado por
`orgContext.loadOrgContext`: `nome`, `propostaValor`/`oQueE` (frase curta voltada ao
lead) e `effectiveCtaText()` (que já converte `ctaGoal` em frase de CTA endereçada ao
lead). Esqueleto seguro: `Olá {{firstName}}, tudo bem? Aqui é o(a) ${nome}. ${valor}
${cta}` — truncado a 400 chars. **`strategy.objective` e `strategy.offer` nunca entram
no corpo**; seguem apenas como metadados da campanha (`objective`/`offer` do model).
Quando o tenant tem template explícito (`OutreachCampaign.whatsappTemplate` da suíte
ou step manual), ele tem precedência e a composição por perfil não roda.

**Rationale**: O bug veio de dados de instrução (`ctaGoal`, `objective` ecoado do
prompt de `ai-campaign.js:101`) serem concatenados como corpo. Whitelist estrutural
elimina a classe do erro: impossível vazar texto que não está na lista.
`effectiveCtaText` já existe (`org-context.js:84-109`) e é lead-facing.

**Alternatives considered**: (a) sanitizar `objective` com regex de frases internas —
frágil, texto livre do LLM; (b) usar só o template mínimo neutro "Olá
{{firstName}}, tudo bem?" — rejeitado na clarificação Q3 (a base deve refletir o
perfil comercial do tenant).

## D2 — Resolução de `{{firstName}}` (FR-003)

**Decision**: `buildTemplateVars` (`whatsapp-utils.js:68-77`) passa a resolver
`firstName` como **primeira palavra de `lead.contactName`, senão nome do sócio
(`cnpjPartners[0].name`), senão string vazia**. `tradeName`/`companyName` **nunca**
 alimentam `firstName` (seguem exclusivamente em `{{companyName}}`). Com `firstName`
vazio, `renderTemplate` remove o placeholder **e a vírgula imediatamente seguinte**
(regra de limpeza: `{{firstName}}:?` → ``), produzindo "Olá, tudo bem?" a partir de
"Olá {{firstName}}, tudo bem?". O bloco de prospect no prompt da IA
(`buildStepMessagePrompt`, `whatsapp-workers.js:87-109`) passa a incluir
`contactName` quando existir.

**Rationale**: `Prospect.contactName` já existe (schema linha ~104, preenchido em
import CSV/PDL) e é ignorado hoje. Sócio é pessoa legítima; nome fantasia não —
era o "Olá NOVAURORA". Degradar para saudação sem nome foi decisão da clarificação
Q1.

**Alternatives considered**: (a) manter sócio→tradeName (comportamento do bug);
(b) pular envio sem contato — rejeitado na Q1 (cria carga operacional, bloqueia
volume); (c) introduzir variável nova `{{saudacao}}` — quebra templates existentes
dos tenants sem ganho.

## D3 — Fallback do WhatsApp = template do tenant (FR-005, FR-007)

**Decision**: `generateStepMessage` (`whatsapp-workers.js:125-155`) mantém o
contrato: qualquer falha (LLM, guard, trial) retorna `renderTemplate(step.messageTemplate,
prospect)`. A correção é **upstream**: o que é gravado em `messageTemplate` passa a
ser sempre (a) template do tenant, ou (b) composição por whitelist (D1) — nunca
texto de instrução. Adicionalmente, `stepMessageGuard` passa a valer também para o
texto do step **na criação/atualização** (POST/PATCH de campanhas e composição IA):
template com BLOCKLIST ou > limite do canal é rejeitado na ingestão, não só na
saída do LLM. Mensagem personalizada que excede 600 chars é truncada em limite de
frase mantendo a base aprovada (nunca substituída por outro texto).

**Rationale**: O fallback em si já é "o template do step" — o incidente existia
porque o step era sintético/poluído. Guard na ingestão fecha o caminho de templates
ruins entrarem; guard na saída permanece como defesa para a personalização.

**Alternatives considered**: regerar via LLM no fallback — agrava dependência de
disponibilidade e custo; trocar por texto fixo da plataforma — proibido pela spec.

## D4 — Fallback de email = base por perfil ou skip (FR-005, FR-006)

**Decision**: `_templateFallback` (`outreach-workers.js:179-197`) é removida. Em
`processPrepare`: (1) campanha com `emailTemplateSubject/Body` do tenant → renderiza
template (`compositionOrigin: 'tenant_template'`); (2) sem template e campanha
`source: 'ai'` → compõe subject+body por whitelist do perfil (D1, análogo ao
WhatsApp; `compositionOrigin: 'profile_base'`) e a IA por lead continua como
personalização quando disponível; (3) sem template e perfil comercial não
configurado (`orgCtx.configured === false`) → **não envia**: contato marcado como
skipped com razão `no_base_message` (nunca texto genérico da plataforma).

**Rationale**: Espelha a decisão Q3/Q4 do WhatsApp no email e elimina o último
texto hardcoded ("Gostaria de agendar uma conversa rápida de 15 min..."). Skip
explícito é preferível a inventar conteúdo sem insumo do tenant.

**Alternatives considered**: fallback para modelo barato de LLM — mantém
dependência de rede no caminho de garantia; texto mínimo da plataforma — proibido
pela spec (FR-005).

## D5 — Origem de composição persistida (FR-010)

**Decision**: Coluna aditiva `compositionOrigin String?` em `WhatsAppMessage` e
`OutreachMessage` (migração Prisma). Valores: `tenant_template`, `ai`,
`ai_fallback_template`, `profile_base`. Escrita no `create` existente de cada
worker (nenhuma escrita extra). Métrica `outreach_composition_origin_total{channel,origin}`
(prom-client) incrementada no mesmo ponto. Histórico unificado
(`GET /api/outreach/dispatches`, server-prod.js:4001) passa a expor `compositionOrigin`
por item.

**Rationale**: `WhatsAppMessage` hoje não distingue IA de template;
`OutreachMessage` tem só `aiReasoningFacts` (array livre). Coluna explícita dá
auditoria consultável (Q5) e alimenta a verificação de SC-001/SC-003. Precedente
interna: `WhatsAppReengagementEvent.origin`.

**Alternatives considered**: derivar origem por heurística no GET — custo por
leitura e impreciso; JSON livre em `metadata` — não filtrável/indexável.

## D6 — Portão de aprovação da campanha IA (FR-009, Q4)

**Decision**: `createAndLaunchAiCampaign` deixa de disparar. Novo fluxo: criação
grava **ambas as campanhas com mensagem base composta persistida e visível** —
WhatsApp: step 0 com template composto (D1) + `aiPersonalized: true`; email:
`emailTemplateSubject/Body` compostos pelo perfil (D4) — ambas em status
`draft`/`DRAFT` com `approvedAt: null`. Endpoint responde com a **prévia renderizada
para um lead real da org** (primeiro prospect qualificado) + ids das campanhas. Novo
endpoint `POST /api/ai/campaigns/approve` (premium, org-scoped) recebe os ids (e
edições opcionais do template WhatsApp/email feitas na UI), revalida posse e plano,
grava `approvedAt` e aí chama `startOutreachCampaign` + `whatsappWorkers.startCampaign`.
Campanha sem aprovação não gera fila (`outreach:prepare`/`whatsapp:sequence`).
Limite diário e revalidação premium permanecem nos dois pontos.

**Rationale**: É o freio que falta para o incidente não se repetir em escala
(decisão Q4); aprovação única por campanha preserva o 1-clique. Persistir a base
antes da aprovação garante que o disparo usa exatamente o que foi aprovado (SC-005).

**Alternatives considered**: aprovação por lead — rejeitada (Q4: única por
campanha); flag configurável de dispensa — rejeitada (escopo, decisão Q4 opção A).

## D7 — Saneamento de campanhas legadas (FR-008, Q2, US4)

**Decision**: Colunas aditivas `needsReview Boolean @default(false)` +
`reviewReason String?` em `WhatsAppCampaign` e `OutreachCampaign` (+ `approvedAt` de
D6). Rotina idempotente `scripts/sanitize-legacy-campaigns.js` (invocada no boot da
API após migrate e re-executável via npm script): para campanhas `source: 'ai'`,
marca `needsReview` quando o step/template contém **texto interno detectável** —
objetivo da campanha (normalizado, substring ≥ 30 chars) ou marcadores do prompt
(`pré-qualificados`, `leads prontos para contato`, `enriquecimento de CNPJ`,
`decisores dos`) — e **retém** (`status: PAUSED`, `pausedAt`) campanhas ativas.
Campanhas `source: 'manual'`/suíte `[auto]` nunca são alteradas (falso positivo
zero, Q2). Rederivação: endpoint org-scoped por canal que regenera a base via D1 e
limpa `needsReview` (campanha permanece pausada até o tenant reativar pelos
endpoints existentes de resume/start). Edição manual do template também limpa
`needsReview`. Métrica `whatsapp_campaign_review_total{action=detected|rederived|edited}`.

**Rationale**: Sem saneamento, campanhas legadas agendadas continuam disparando o
texto do incidente pós-deploy (US4). Detecção conservadora (só `source: 'ai'` +
evidência textual) atende o requisito de zero falso positivo.

**Alternatives considered**: correção automática silenciosa — rejeitada na Q2;
deletar steps — destrutivo; varrer mensagens já enviadas — fora de escopo (Q5).

## D8 — Modal de risco na conexão WhatsApp (US6, FR-013, FR-014)

**Decision**: Componente novo `WhatsAppRiskModal.tsx` em
`apps/web/src/components/modals/`, copiando o padrão de overlay Tailwind de
`ProspectModal.tsx:64-80` (sem lib de dialog nova). `WhatsAppView.tsx` gateia
`handleConnect` (linha 157) e o caminho de reconexão (`GET .../qr` /
`POST .../reconnect`): confirmar → segue o fluxo atual; cancelar → nenhuma chamada
de rede, nenhum estado alterado. **Backend inalterado** — o endpoint
`POST /api/whatsapp/accounts/:id/connect` (server-prod.js:4651) continua idempotente
e org-scoped. Texto do alerta informa que uso automatizado pode resultar em
**bloqueio da conta pelo WhatsApp** e recomenda número dedicado.

**Rationale**: A criação de sessão acontece só no backend ao clicar conectar; um
gate 100% frontend antes da chamada satisfaz FR-013/FR-014 sem nova superfície de
API e sem estado novo (YAGNI).

**Alternatives considered**: flag de confirmação persistida no backend — estado
extra sem valor de auditoria para o escopo; `window.confirm` — padrão visual
insuficiente para aviso de risco legal/UX.

## D9 — Migrações e compatibilidade (Constituição II/IV)

**Decision**: Única migração Prisma aditiva: `compositionOrigin` em
`WhatsAppMessage`/`OutreachMessage`; `needsReview`, `reviewReason`, `approvedAt` em
`WhatsAppCampaign`/`OutreachCampaign`. Tudo nullable/default — deploy sem downtime,
consumidores atuais não mudam. Nenhum campo existente é renomeado; `source` de
`WhatsAppMessage` continua sendo contexto (MANUAL/CAMPAIGN/REENGAGEMENT) e não
origem de composição.

**Rationale**: Evolução aditiva com default é o padrão do repo (`db:migrate`/
`db:deploy`, nunca `db push`).

## D10 — Observabilidade e logs (Constituição VII)

**Decision**: Métricas D5/D7 + contador de aprovações (`ai_campaign_approvals_total{result}`).
Logs estruturados dos guards registram razão (`blocked_claim`, `too_long`,
`no_base_message`) com ids (`messageId`, `campaignId`, `orgId`) — **nunca o conteúdo
da mensagem do cliente**. Dashboards ficam fora do escopo (infra argo).

**Rationale**: Fluxo crítico novo (aprovação/retención) exige diagnóstico sem acesso
a dado de cliente, como pede a Constituição VII.
