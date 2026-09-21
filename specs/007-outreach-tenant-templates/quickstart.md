# Quickstart — Validação 007-outreach-tenant-templates

Roteiro de validação ponta a ponta. Pré-requisitos: Node 20+, Postgres de dev,
`pnpm install`. Comandos na raiz do repo.

## 1. Setup

```bash
pnpm install
pnpm run db:migrate          # aplica a migração aditiva (compositionOrigin, needsReview, approvedAt)
pnpm test                    # suíte node --test (deve passar 100% antes de qualquer manual)
pnpm --filter web build      # typecheck + build da SPA
```

## 2. Cenários de teste automatizado (portas de entrada — Constituição III)

Executados por `pnpm test`; fakes in-memory de `test/helpers/` (`fake-prisma`,
`fake-llm`, `fake-redis`), sem rede/banco:

| Arquivo | Cenários cobertos |
|---------|-------------------|
| `test/whatsapp-utils.test.js` | `firstName` de `contactName`; sócio como fallback; `tradeName`/`companyName` **nunca** viram pessoa; "Olá {{firstName}}, tudo bem?" → "Olá, tudo bem?" sem contato |
| `test/ai-campaign.test.js` | Composição de base **sem** `objective`/`ctaGoal` crus (texto do incidente não aparece); criação NÃO enfileira nada e responde `pending_approval` + prévia; approve grava `approvedAt` e dispara os dois canais; trial → 403; limite diário → 429 |
| `test/whatsapp-workers.test.js` | Fallback do `generateStepMessage` (LLM falha/trial/guard) = template do step renderizado com `firstName` correto; `compositionOrigin` gravado; guard de ingestão rejeita BLOCKLIST/>600 |
| `test/outreach-workers.test.js` | Template do tenant renderizado (`tenant_template`); sem template + perfil configurado → base por perfil (`profile_base`); sem perfil → contato skipped (`no_base_message`, nada genérico enviado) |
| `test/sanitize-legacy.test.js` | Campanha `source:'ai'` com objetivo ecoado → `needsReview` + PAUSED; start/resume → 409; campanha manual/[auto] **intocada**; rederiva limpa `needsReview` mantendo pausa; isolamento por org |
| `test/dispatches.test.js` | Histórico expõe `compositionOrigin`; filtro por `campaignId` lista envios de campanha retida |

## 3. Validação manual ponta a ponta (ambiente dev)

### 3.1 Bug do template — org com perfil comercial

1. Configurar Perfil Comercial (nome "MB", proposta de valor, CTA) para a org de teste.
2. Criar campanha com IA → **esperado**: UI mostra prévia da mensagem base ("Olá
   Mariana, tudo bem? Aqui é o(a) MB…") **sem** nenhuma frase de objetivo interno
   ("pré-qualificados por enriquecimento de CNPJ" etc.) e **nenhum disparo iniciou**
   (filas vazias).
3. Aprovar na UI → disparos começam. Inspecionar `WhatsAppMessage`/`OutreachMessage`:
   `compositionOrigin` preenchida; conteúdo = prévia aprovada (personalização por
   lead permitida, registrada).
4. Derrubar o LLM (env `LITELLM_*` inválido) e repetir com outra campanha →
   mensagens saem com o template/base aprovada, nunca texto de plataforma.

### 3.2 Saudação

- Lead **com** `contactName` "Mariana Souza" → mensagem começa "Olá Mariana…".
- Lead **sem** `contactName`/sócios → "Olá, tudo bem?" — **nunca** "Olá
  <NOME-DA-EMPRESA>". `{{companyName}}` segue resolvendo a empresa.

### 3.3 Saneamento de campanha legada

1. Criar (via SQL de fixture ou seed) campanha `source:'ai'` ativa com step
   contendo o texto do incidente; criar também uma campanha manual com template
   legítimo.
2. Rodar `node scripts/sanitize-legacy-campaigns.js` → campanha IA: `PAUSED` +
   `needsReview=true`; manual: intocada.
3. Tentar `start`/`resume` na retida → `409 CAMPAIGN_REVIEW_REQUIRED`.
4. Na UI: editar o template (ou clicar em rederivar) → `needsReview` limpa,
   campanha segue pausada; reativar manualmente → dispara com o novo template.
5. `GET /api/outreach/dispatches?campaignId=<retida>` → lista envios históricos
   com conteúdo exato (identificação de leads afetados, decisão Q5).

### 3.4 Modal de risco WhatsApp (US6)

1. Organização sem conta conectada → clicar **Conectar WhatsApp** → modal de risco
   aparece **antes** de qualquer request (verificar network do browser: nada
   disparou).
2. **Cancelar** → nenhuma sessão criada (status inalterado no backend).
3. **Confirmar** → fluxo atual segue (QR em `ConnectionsPanel`).
4. Desconectar e reconectar → modal reaparece na reconexão.

## 4. Critérios de aceite rápidos (mapeamento SC)

- SC-001/SC-003: nenhuma mensagem contém texto de objetivo interno; fallback = base
  aprovada (cenários 3.1.4 e testes `ai-campaign`/`whatsapp-workers`).
- SC-002: cenário 3.2.
- SC-004: cenário 3.3 (zero falso positivo na manual).
- SC-005: conteúdo disparado = prévia aprovada (cenário 3.1.3).
- SC-007: cenário 3.4 (nada conecta sem confirmação).
