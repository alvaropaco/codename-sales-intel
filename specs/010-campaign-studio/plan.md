# Implementation Plan: Campaign Studio

**Branch**: `010-campaign-studio` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-campaign-studio/spec.md`

## Summary

O Campaign Studio é a nova experiência de criação, revisão, agendamento e
acompanhamento de campanhas de outreach (e-mail + WhatsApp) do B2Base: uma
área separada do app com UI própria em tema dark, onde toda campanha nasce
como rascunho e só dispara após revisão + aprovação explícitas (com a exceção
de guard-rails para automações opt-in decidida no clarify), sobre audiências
explícitas (segmentos salvos + snapshot congelado) e agendas com janelas e
ritmo.

Abordagem técnica: o Studio é uma **camada de produto sobre os motores de
canal existentes** — não substitui `OutreachCampaign`/`WhatsAppCampaign`, que
continuam executando envio, tracking, sync de replies e inbox. Novos módulos
em `studio/` (backend, Node/Express + Prisma, padrão de módulos planos do
repo) implementam domínio próprio: campanha + conteúdo + personalização,
segmentos/audiência congelada, scheduler com janelas/ritmo, journeys, A/B,
brand profile, compliance e analytics rollup. No front (`apps/web`), um shell
próprio em `/studio` com tema dark, fora do shell de tabs atual. Geração por
IA reutiliza `llm-client.js` (gateway LiteLLM).

## Technical Context

**Language/Version**: Node.js (Express 5, ESM/CJS do repo), Prisma 5/Postgres; SPA React 18 + TypeScript + Vite + Tailwind 3 (`apps/web/`)

**Primary Dependencies**: existentes — Prisma, BullMQ+Redis (filas), ioredis, `llm-client.js` (LiteLLM OpenAI-compatível), `email-provider.js` (Gmail API/SMTP/Resend), `waha-provider.js` (WhatsApp), rate limiters de outreach/WhatsApp, recharts, @xyflow/react, framer-motion. **Novas (justificadas)**: `@dnd-kit/core` (drag-and-drop acessível/touch do editor), `mjml` (blocos JSON → HTML responsivo com compatibilidade de clientes de e-mail), `pdf-parse` + `mammoth` (extração de texto de PDF/DOCX para Campaign from Material — ver research.md).

**Storage**: PostgreSQL (Prisma) + Redis (filas/rate limit); binários de material em volume local configurável (`STUDIO_STORAGE_DIR`), metadados+extração no Postgres

**Testing**: `pnpm test` (`node --test test/*.test.js`) na plataforma; build + typecheck do `apps/web`

**Target Platform**: Linux (deploy GitOps via GHCR/ArgoCD), SPA servida pelo backend

**Performance Goals**: contagem/prévia de segmento em até 2s p95 com 50k leads/org; scheduler avaliando filas a cada 60s; geração de pacote IA (e-mail+WhatsApp+variantes) < 2 min; dashboard carregando rollup diário pré-agregado (< 500ms p95 por campanha)

**Constraints**: respeitar rate limits por conta de envio existentes (ex.: Gmail 5.000/dia; defaults do `outreach-rate-limiter.js`); nenhuma alteração quebradora em contratos NATS existentes (Studio usa filas internas BullMQ); dados isolados por organização em todos os endpoints; IA avançada gated premium (`plan.js`)

**Scale/Scope**: 14 user stories (P1–P4) da spec; ~18 modelos novos/alterados; ~35 endpoints REST sob `/api/studio/*`; 2 workers novos (scheduler, journeys) + 1 worker de batch IA; shell front próprio com ~10 telas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação pré-fase 0 | Pós-fase 1 |
|---|---|---|
| I. Especificação antes de código | ✅ spec.md + clarify concluídos | ✅ |
| II. Persistência idempotente orientada a eventos | ✅ Studio usa BullMQ interno com job IDs determinísticos (idempotente por campanha+lead+toque); nenhum contrato NATS existente é alterado; eventos `*.v1` seguem intocados | ✅ ver data-model.md (chaves de idempotência por job) |
| III. Testes como porta de entrada | ✅ quickstart.md define cenários automatizados (`pnpm test`) antes da implementação; tasks herdarão test-first | ✅ |
| IV. Multi-tenancy e gating por plano | ✅ todos os modelos novos com `orgId` + `@@index([orgId])`; router do Studio sob `requireAuth` com scope de org; rotas de IA avançada com `assertPremiumOrg`; trial nunca vê dado mascarado (`plan-masking.js` permanece) | ✅ |
| V. Segredos fora do repositório | ✅ nenhuma credencial nova; webhook de journey autenticado por token opaco por campanha (hash no banco) | ✅ |
| VI. Simplicidade incremental (YAGNI) | ⚠️ 3 dependências novas (`@dnd-kit/core`, `mjml`, `pdf-parse`+`mammoth`) — justificadas em research.md com alternativas rejeitadas; sem novo serviço Python (carga não justifica); módulo `studio/` segue padrão de módulos planos (análogo a `discovery/`) | ✅ justificativas registradas |
| VII. Deploy GitOps observável | ✅ workers novos expõem métricas prom-client (fila, ritmo, anomalias) e logs estruturados sem PII de lead | ✅ |

Nenhuma violação que exija entrada em Complexity Tracking. As dependências
novas são bibliotecas de produtuação (não frameworks), justificadas na
research com alternativas rejeitadas.

## Project Structure

### Documentation (this feature)

```text
specs/010-campaign-studio/
├── plan.md              # Este arquivo
├── research.md          # Decisões técnicas (fase 0)
├── data-model.md        # Modelos Prisma novos/alterados (fase 1)
├── quickstart.md        # Guia de validação ponta a ponta (fase 1)
├── contracts/
│   ├── rest-api.md      # Endpoints /api/studio/* (fase 1)
│   └── jobs-queues.md   # Filas BullMQ, idempotência e métricas (fase 1)
└── tasks.md             # Fase 2 ($speckit-tasks — não criado aqui)
```

### Source Code (repository root)

```text
# Backend — módulos do Studio na raiz (padrão do repo; dir análogo a discovery/)
studio/
├── router.js                 # Router Express montado em /api/studio (padrão adminRouter)
├── campaign-service.js       # Estados, aprovação, congelamento de audiência, controle de fila
├── segment-service.js        # Critérios → query de Prospect (sem SQL de usuário), contagem, snapshot
├── schedule-service.js       # Janelas, ritmo, previsão de conclusão, fusos
├── scheduler-worker.js       # BullMQ repeat job: move filas dentro da janela/ritmo (worker novo)
├── journey-engine.js         # Interprete do canvas de journeys + worker studio:journey
├── channel-bridge.js         # Compila StudioCampaign → execuções de canal (Outreach/WhatsApp)
├── experiment-service.js     # A/B: divisão, assignment determinístico, vencedor
├── compliance-service.js     # Compliance Guard: checks determinísticos + LLM
├── analytics-service.js      # Rollups diários, funil, cortes, timeline agregada
├── agent-service.js          # AI Campaign Agent: plano → itens → aprovação
├── brand-service.js          # Brand Voice/Kit + verificador de consistência
├── material-service.js       # Upload/extração (PDF/DOCX/PPTX/imagem/URL)
├── template-service.js       # Biblioteca de templates por objetivo/estágio
├── guardrails.js             # Salvaguardas da automação opt-in: anomalia, pausa, amostra
└── ai/
    ├── extract.js            # Material/URL → produto, oferta, benefícios, público, CTA
    ├── compose.js            # Pacote de campanha multicanal com variantes/tons
    ├── personalize.js        # Personalização em lote por lead (dados de enriquecimento)
    ├── classify-reply.js     # Classificação de respostas (e-mail + WhatsApp)
    ├── translate.js          # Tradução/adaptação preservando variáveis e links
    └── analyze.js            # Analista de campanha (Q&A de performance com diagnóstico)

apps/web/src/studio/          # Shell próprio em /studio (tema dark forçado)
├── StudioApp.tsx             # Shell: nav própria, layout dark, rotas internas
├── api.ts                    # Cliente da API /api/studio/* (tipado, padrão services/api.ts)
├── types.ts                  # Tipos do domínio Studio
├── components/               # Editor de e-mail (DnD), canvas de journeys, previews, dashboards
└── views/                    # Campanhas, audiência, agenda, brand, biblioteca, analytics, agent

test/
├── studio-segments.test.js       # (exemplos; tasks detalham a suíte completa)
├── studio-approval-flow.test.js
└── ...
```

**Structure Decision**: monorepo existente sem novos serviços — backend em
`studio/` na raiz (Node, módulos planos, padrão `discovery/`), router
registrado em `server-prod.js` como `app.use('/api/studio', ...)`, workers
BullMQ registrados junto aos existentes em `outreach-workers.js`/
`whatsapp-workers.js` (mesmo processo/padrão). Front em `apps/web/src/studio/`
com shell dark próprio acessado pela rota `/studio` (renderizado fora do
shell de tabs atual). Nenhum serviço Python novo — toda a carga cabe no
processo Node existente (constituição VI).

## Complexity Tracking

> Sem violações de constituição. Justificativas de dependências novas em
> [research.md](./research.md) — decisões D6, D7 e D8.
