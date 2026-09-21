# Implementation Plan: Outreach Multi-tenant — Mensagens pelo Template do Tenant

**Branch**: `007-outreach-tenant-templates` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-outreach-tenant-templates/spec.md` (clarificada em 2026-09-21 — 5 decisões registradas em `## Clarifications`, incluindo US6 de aviso de risco na conexão WhatsApp).

## Summary

Corrigir a composição de mensagens de outreach para que **todo envio (email e WhatsApp, em qualquer fluxo) use como base o template/composição aprovada da organização**, eliminando os três caminhos que hoje enviam texto da plataforma: (1) o template sintético da campanha IA que injeta `objective`/`ctaGoal` crus no corpo (`ai-campaign.js:345-358`), (2) o fallback genérico hardcoded de email (`outreach-workers.js:179-197`) e (3) a resolução de `{{firstName}}` que usa `tradeName`/`companyName` como pessoa (`whatsapp-utils.js:68-77`). Acompanham: portão de **aprovação obrigatória da mensagem base** antes de disparar campanhas IA, **saneamento de campanhas legadas poluídas** (reter + sinalizar + rederivação), **origem de composição** persistida por mensagem enviada, e **modal de aviso de risco** antes de conectar conta de WhatsApp (bloqueio pelo WhatsApp). Abordagem técnica: composição de base a partir de whitelist do perfil comercial (`org-context.js`), evolução de schema via Prisma (`compositionOrigin`, `needsReview`, `approvedAt`), endpoints org-scoped em `server-prod.js` e modal Tailwind reusando o padrão de `ProspectModal.tsx`.

## Technical Context

**Language/Version**: Node.js (Express 5, Prisma 5/Postgres, ioredis, Bull, NATS) na plataforma; SPA React + TypeScript + Vite + Tailwind em `apps/web/`. Serviços Python (`services/`) não são afetados.

**Primary Dependencies**: Existentes apenas — `llm-client.js` (LiteLLM API-compatível), `org-context.js`, `whatsapp-utils.js`, `waha-provider.js`, prom-client (métricas). **Nenhuma dependência nova** (modal é Tailwind puro, padrão `ProspectModal.tsx`).

**Storage**: PostgreSQL via Prisma. Migração nova: `compositionOrigin` em `WhatsAppMessage` e `OutreachMessage`; `needsReview`/`reviewReason`/`approvedAt` em `WhatsAppCampaign` e `OutreachCampaign`. Exclusivamente via `pnpm run db:migrate` / `db:deploy`.

**Testing**: `pnpm test` (`node --test test/*.test.js`) com fakes in-memory existentes (`test/helpers/fake-prisma.js`, `fake-llm.js`, `fake-redis.js`); web validado com `pnpm --filter web build` (typecheck + build). Sem rede/banco real nos testes.

**Target Platform**: Linux server (GHCR `sha-<sha>` + ArgoCD) para API/workers; browsers evergreen para a SPA.

**Performance Goals**: Sem novo caminho quente: aprovação substitui o lançamento imediato (mesmo volume de jobs); detecção de saneamento é varredura única por campanha; `compositionOrigin` é coluna string escrita junto do registro existente.

**Constraints**: Mensagem WhatsApp ≤ 600 chars (`STEP_MESSAGE_MAX_LEN`) e BLOCKLIST (`whatsapp-utils.js:137`); campanha IA continua exclusiva de org premium (`assertPremiumOrg` + `isPremiumOrg`); limite diário `AI_CAMPAIGN_DAILY_LIMIT` mantido; nunca `db push` em produção; trial não pode receber capacidade premium nova.

**Scale/Scope**: ~12 módulos planos na raiz tocados + 2 telas do web; 1 migração Prisma; ~7 arquivos de teste novos/atualizados. Volume: campanhas por org (dezenas), mensagens por campanha (centenas) — varredura de saneamento é O(campanhas ativas).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Evidência |
|-----------|--------|-----------|
| I. Especificação antes de código | ✅ Pass | `spec.md` criada, clarificada (5 Q→A) e estendida com US6 antes do plan. |
| II. Persistência idempotente orientada a eventos | ✅ Pass | Nenhum contrato NATS muda (`MESSAGE_SENT`/`MESSAGE_FAILED` intactos). Novas colunas são aditivas com default; consumidores continuam idempotentes (`@@unique([campaignContactId, stepIndex])` preservado). |
| III. Testes como porta de entrada | ✅ Pass | Tarefas de teste antecedem implementação em `tasks.md` (a gerar): `whatsapp-utils`, composição de base, `generateStepMessage`, fallback de email, ciclo IA (criar→aprovar→disparar), saneamento, dispatches. Fakes existentes reutilizados, sem dependências novas. |
| IV. Multi-tenancy e gating por plano | ✅ Pass | Endpoints novos/recebem `orgId`/`tenantId` do request (padrão `requireRequestOrgId`/`user.orgId`); aprovação e rederivação revalidam posse da campanha; premium gating mantido no ciclo IA; saneamento por `orgId`. |
| V. Segredos fora do repositório | ✅ Pass | Nenhuma credencial nova; WAHA/LiteLLM continuam por env. |
| VI. Simplicidade incremental (YAGNI) | ✅ Pass | Módulos existentes evoluídos (`ai-campaign.js`, `whatsapp-workers.js`, `outreach-workers.js`, `whatsapp-utils.js`, `campaign-suite.js`); sem camada nova, sem framework novo; modal copia padrão visual existente. |
| VII. Deploy GitOps observável | ✅ Pass | Métricas prom-client novas: `outreach_composition_origin_total{channel,origin}` e `whatsapp_campaign_review_total{action}`; logs estruturados dos guards sem conteúdo de mensagem do cliente. Deploy segue CI/ArgoCD; saneamento roda como rotina idempotente no boot/pós-migração. |

**Re-check pós-Fase 1**: mantém-se ✅ — design não introduz dependência, camada ou contrato de evento novo (ver `research.md` D1–D10).

## Project Structure

### Documentation (this feature)

```text
specs/007-outreach-tenant-templates/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões D1–D10
├── data-model.md        # Fase 1 — entidades, campos e transições
├── contracts/
│   └── api.md           # Fase 1 — contratos de endpoints alterados/novos
├── quickstart.md        # Fase 1 — roteiro de validação ponta a ponta
└── tasks.md             # Fase 2 ($speckit-tasks — ainda não criado)
```

### Source Code (repository root)

```text
# Módulos de plataforma tocados (raiz, Node.js)
ai-campaign.js            # composição de base por whitelist, fluxo criar→aprovar→disparar, saneamento
whatsapp-workers.js       # fallback = template do tenant; origin na persistência; métricas
outreach-workers.js       # remoção de _templateFallback genérico; base por perfil; origin
whatsapp-utils.js         # buildTemplateVars (contactName), limpeza de saudação, guard de template
campaign-suite.js         # default de step continua template do tenant (suite.whatsappTemplate)
org-context.js            # helper de composição lead-facing (sem mudança de contrato público)
server-prod.js            # endpoints: aprovar, rederivar, editar/revalidar steps; dispatches com origin
prisma/schema.prisma      # campos novos (aditivos) + migração
scripts/sanitize-legacy-campaigns.js  # rotina idempotente de saneamento (executada no boot/pós-deploy)

# SPA (apps/web)
apps/web/src/components/views/WhatsAppView.tsx          # modal de risco gating handleConnect/reconnect
apps/web/src/components/views/OutreachView.tsx          # fluxo de aprovação da campanha IA (prévia + aprovar/editar)
apps/web/src/components/modals/WhatsAppRiskModal.tsx    # novo modal (padrão ProspectModal.tsx)
apps/web/src/services/api.ts                            # approve/rederive/preview endpoints

# Testes (node --test, fakes in-memory)
test/whatsapp-utils.test.js        # firstName do contato + saudação degradada (atualizado)
test/ai-campaign.test.js           # novo: composição sem texto interno, ciclo de aprovação
test/whatsapp-workers.test.js      # novo: fallback do tenant, origin, guard
test/outreach-workers.test.js      # novo: template do tenant, base por perfil, origin
test/sanitize-legacy.test.js       # novo: detecção conservadora, manual intocado, multi-tenant
test/dispatches.test.js            # novo: origin no histórico unificado
```

**Structure Decision**: Estrutura atual mantida — módulos planos na raiz (Constituição VI), SPA em `apps/web/`, testes em `test/` com fakes. Nenhum diretório/serviço novo além de `scripts/sanitize-legacy-campaigns.js` (rotina operacional idempotente) e do modal em `apps/web/src/components/modals/` (padrão existente).

## Complexity Tracking

> Sem violações de Constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
