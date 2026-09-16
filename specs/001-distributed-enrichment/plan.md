# Implementation Plan: Plataforma Distribuída de Enriquecimento de Leads

**Branch**: `001-distributed-enrichment` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-distributed-enrichment/spec.md`

## Summary

Substituir as esteiras de enriquecimento ad-hoc de hoje (roteador `dispatchEnrichmentForPlan` em `server-prod.js`, fila in-process em `lead-enrichment.js`, worker Python monolítico, fallback BrasilAPI) por um **motor distribuído orientado a eventos** dentro do monorepo atual:

- **`enrichment-manager.js`** (módulo Node na plataforma) cria um `EnrichmentJob` por lead, planeja `EnrichmentTask`s (entidade × capability elegível pelo plano), publica no stream JetStream `ENRICHMENT` (`enrichment.task.<capability>.v1`), consome `enrichment.result.v1`, aplica resultados ao Prospect, resolve dependências (DAG mínimo), executa expansão dinâmica limitada e conclui o job (COMPLETED/PARTIAL/FAILED).
- **Workers independentes** (novos processos Node em `workers/`, mesma imagem da plataforma, entrypoints distintos) consomem tasks por família de capability, executam **providers** (SearXNG, BrasilAPI, RFB, PDL, Clearbit — todos já usados hoje), persistem resultado + evidência + bruto de forma independente e publicam o resultado, com **ack só após persistência**.
- **Resiliência de provider** (rate limit distribuído e circuit breaker em Redis via ioredis — primeira utilização direta da dependência já declarada) e **qualificação desacoplada** (`qualification.js` consumindo resultados e recalculando `opportunityScore` com debounce).
- **Coexistência total** com os contratos legados `enrichment.company.*.v1` (worker Python continua intacto; na transição ele é tratado como *provider* da capability `company.deepgraph` via os contratos que já existem).

Rollout gradual por feature flag (`ENRICHMENT_ENGINE_V2`), testes primeiro (`node --test` com DI + integração opt-in), migrations exclusivamente via Prisma.

## Technical Context

**Language/Version**: JavaScript, Node.js 22 (padrão dos módulos planos na raiz). Python 3.12 **apenas** no serviço existente `services/company-enrichment-worker` — nenhum serviço novo.

**Primary Dependencies**: nenhuma dependência nova de runtime. Reuso: express 5, @prisma/client 5, nats 2.29 (JetStream — novo uso: consumers duráveis por família de capability), ioredis 6 (rate limit/circuit breaker — primeira utilização direta), prom-client 15 (métricas no registry existente da porta 9090), bull 4 apenas se necessário para debounce de score. Sem TypeScript, MongoDB, Qdrant ou KEDA nesta feature (ver Constitution Check).

**Storage**: PostgreSQL (Prisma; migrations só via `pnpm run db:migrate`/`db:deploy`) para job/task/result/evidence/raw. Redis para rate limit distribuído, estado de circuit breaker e marcadores de idempotência quentes. Dado bruto: tabela `RawRecord` atrás da abstração `raw-store.js` (backend S3/MinIO ativável depois — a plataforma Node não tem bucket hoje, decisão R5).

**Testing**: `pnpm test` (`node --test test/*.test.js`), no estilo DI dos testes existentes (bus falso em memória, Prisma fake) — testes **antes** da implementação em cada tarefa; integração opt-in contra NATS/Redis reais quando `NATS_URL`/`REDIS_URL` estiverem no ambiente (skip automático caso contrário); pytest no lado Python apenas se a ponte exigir ajuste.

**Target Platform**: Linux (containers node:22-alpine do build existente); workers rodam como processos separados por entrypoint (`node workers/<família>.js`) da **mesma imagem**; deploy GitOps atual (GHCR → `alvaropaco/k8s-infra` → ArgoCD), com Deployments por worker seguindo o padrão `workertype-deployment.yaml` do worker Python.

**Project Type**: monorepo web-service + workers de background (módulos planos na raiz, constituição VI).

**Performance Goals**: primeiro resultado parcial visível ≤ 60s (SC-001); fila sempre em avanço contínuo; target de referência do usuário: 10.000+ tasks simultâneas e 100+ instâncias (validação em escala real é marco próprio — R8; quickstart valida em escala reduzida).

**Constraints**: nenhum segredo em mensagens de task; ack somente após persistência; nenhuma task cross-tenant; capability premium nunca gerada para org trial; concorrência de provider respeitada entre todas as instâncias; restart de worker sem perda de task (consumer durável + lease por ack_wait).

**Scale/Scope**: 4 marcos — (1) motor mínimo com 2–3 capabilities reais reaproveitando providers atuais, (2) proteção de providers, (3) grafo (dependências + expansão dinâmica) e porte das esteiras legadas, (4) qualificação desacoplada + observabilidade + cotas. Catálogo previsto de ~8 famílias de capability.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Evidência / Decisão |
|---|---|---|
| I. Especificação antes de código | PASS | spec.md validada (checklist 16/16); este plan e os artefatos derivam dela |
| II. Persistência idempotente orientada a eventos | PASS | novos contratos todos `*.v1` ([contracts/nats-enrichment-engine-v1.md](./contracts/nats-enrichment-engine-v1.md)); dedup server-side via `Nats-Msg-Id` = chave determinística; unique constraints em Prisma espelham o padrão `CnpjEnrichment @@unique([companyId, enrichmentVersion])`; poison message → `term()` + DLQ; contratos legados `enrichment.company.*.v1` intocados (coexistência, evolução futura `.v2`) |
| III. Testes como porta de entrada | PASS | planejados testes-first por tarefa (unidades com DI no estilo `test/lead-enrichment.test.js`; integração opt-in); tasks.md deve preservar ordem teste→implementação |
| IV. Multi-tenancy e gating por plano | PASS | `orgId` em todos os models novos e headers de correlação; catálogo de capabilities com tier `basic`/`premium` filtrado por `plan.js`; leitura de fatos passa por `plan-masking.js`; cota mensal por org na criação de job |
| V. Segredos fora do repositório | PASS | credenciais de providers via env (worker Python já usa Infisical); payload de task carrega somente referência de provider, nunca credencial |
| VI. Simplicidade incremental (YAGNI) | PASS* | módulos planos na raiz, sem framework novo, sem serviço novo; uuidv5 implementado localmente (evita dep `uuid`); concorrência por semáforo próprio (padrão já usado em `lead-enrichment.js`); KEDA/autoscaling por fila e backend S3 ficam para depois com gancho pronto. Duas justificativas registradas em Complexity Tracking |
| VII. Deploy GitOps observável | PASS | mesma imagem por commit, entrypoints distintos por worker; métricas novas no registry prom-client existente; logs estruturados JSON novos (`logger.js`); write-back de tag inalterado (paths da plataforma já disparam o build) |

**Re-check pós-design (fase 1 concluída)**: PASS — nenhum gate aberto; as duas justificativas (raw em Postgres com abstração S3; pasta `workers/` com SDK de 3 módulos) estão em Complexity Tracking abaixo e não violam princípio, apenas registram decisões que precisam de aprovação em review.

## Project Structure

### Documentation (this feature)

```text
specs/001-distributed-enrichment/
├── plan.md              # Este arquivo
├── research.md          # Decisões R1–R12 (Phase 0)
├── data-model.md        # Modelos Prisma + máquinas de estado (Phase 1)
├── quickstart.md        # Guia de validação ponta a ponta (Phase 1)
├── contracts/           # Phase 1
│   ├── nats-enrichment-engine-v1.md   # subjects, payloads JSON Schema, semântica de entrega
│   ├── worker-sdk.md                  # interface do runtime de worker e de capability
│   └── http-api.md                    # endpoints novos/alterados
└── tasks.md             # Phase 2 ($speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
b2base-platform/
├── enrichment-manager.js            # NOVO — ciclo de vida do job: planeja, publica, consome results,
│                                    #   desbloqueia DAG, expande (limitado), conclui job, aplica fatos no Prospect
├── enrichment-capabilities.js       # NOVO — catálogo declarativo: capability → tier (basic/premium),
│                                    #   timeout, maxAttempts, providers elegíveis, regras de expansão, validação de input
├── enrichment-provider-registry.js  # NOVO — registro operacional de providers: rate limit + concorrência
│                                    #   + circuit breaker + health (estado em Redis, métricas em prom-client)
├── enrichment-contracts.js          # NOVO — serialização/validação dos payloads v1 e headers de correlação
├── raw-store.js                     # NOVO — abstração de retenção de bruto (backend postgres | s3)
├── logger.js                        # NOVO — logs estruturados JSON com correlação (job/task/org)
├── qualification.js                 # NOVO — consumidor separado de enrichment.result.v1 → recalcLeadScore
├── workers/
│   ├── sdk/
│   │   ├── runtime.js               # loop JetStream: fetch batch, validate, timeout/abort, concorrência,
│   │   │                            #   persist→publish→ack, nak(delay) com backoff, term→DLQ, graceful drain
│   │   ├── idempotency.js           # taskKey determinística (uuidv5 local) + upsert idempotente de resultado
│   │   └── result-publisher.js      # publica enrichment.result.v1 com headers de correlação
│   ├── identity.js                  # identity.domain.verify · identity.cnpj.resolve (SearXNG+RFB) ·
│   │                                #   identity.cnpj.basic (BrasilAPI) · identity.email.verify
│   ├── search.js                    # search.news · search.legal (SearXNG)
│   └── company-deep.js              # company.profile.deep (PDL) · company.logo (Clearbit) ·
│                                    #   company.deepgraph (ponte p/ worker Python via contratos legados)
├── prisma/schema.prisma             # +EnrichmentJob, EnrichmentTask, EnrichmentResult, EnrichmentEvidence, RawRecord
├── server-prod.js                   # dispatchEnrichmentForPlan → manager (por flag); endpoints de status (contracts/http-api.md)
├── nats-enrichment.js               # preservado; extração de helpers de conexão/stream compartilhados
├── metrics.js                       # +b2base_enrichment_tasks{capability,state}, duração, provider errors, circuit state
├── docker-compose.yml               # +serviços nats (jetstream) e redis para dev local
└── Dockerfile                       # COPY workers/ e novos módulos; ENTRYPOINTs de worker documentados
```

**Structure Decision**: monorepo existente com módulos planos na raiz (constituição VI). O scheduler é um módulo da plataforma (não um deployment novo): o ciclo de vida do job é escrito pela mesma process que recebe requests, e o isolamento de falha vem do design consumer/produtor NATS — ele pode ser extraído para deployment próprio depois sem mudar contratos. Workers novos vivem em `workers/` (um processo por família, mesma imagem, entrypoints distintos), espelhando o padrão já validado de `workertype-deployment.yaml` no chart do worker Python. O worker Python existente não muda nesta feature: é consumido como **provider** da capability `company.deepgraph` pelos contratos `enrichment.company.*.v1` que já rodam em produção.

## Complexity Tracking

> Justificativas registradas (não são violações de princípio; exigem aprovação em review):

| Desvio | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dado bruto em Postgres (tabela `RawRecord`) em vez de S3 na fase 1 | A plataforma Node não tem bucket/credenciais de objeto hoje; MinIO só existe no stack Helm do publisher | Criar MinIO/bucket agora adicionaria peça de infraestrutura sem consumidor real (YAGNI). A abstração `raw-store.js` permite ativar o backend S3 depois sem tocar em nenhum worker; threshold de tamanho + flag `storageBackend` registram a migração |
| Pasta `workers/sdk/` com 3 módulos em vez de 1 arquivo | Runtime de worker tem 3 responsabilidades coesas (loop de entrega, idempotência, publicação) que são testadas isoladamente | Arquivo único ficaria grande demais para testar o loop sem carregar publicação; mais granularidade que isso (pacote npm separado, monorepo interno) é over-engineering nesta fase |

## Marcos de entrega (insumo para $speckit-tasks)

1. **M1 — Motor mínimo (US1, US2, US3)**: schema Prisma + migrations; `enrichment-contracts.js`; `enrichment-capabilities.js` (tiers); `enrichment-manager.js` (planejar→publicar→consumir→aplicar→concluir); `workers/sdk/*`; workers `identity` (domain.verify, cnpj.basic) e `search` (news); flag `ENRICHMENT_ENGINE_V2`; endpoints de status; testes DI primeiro.
2. **M2 — Proteção de providers (US4)**: `enrichment-provider-registry.js` (Redis), circuit breaker, health, métricas; injeção de falha em teste.
3. **M3 — Grafo e porte das esteiras (US5, US6)**: dependências (`dependsOn`/BLOCKED), expansão dinâmica com limites, `raw-store.js` + evidência completa, porte de `lead-enrichment.js` (resolve CNPJ) e das capacidades premium (PDL/legal/logo) para tasks; ponte `company.deepgraph` via contratos legados; desligar fila in-process.
4. **M4 — Qualificação e operação (US7, US8)**: `qualification.js` consumidor separado com debounce; cotas por org; `logger.js` + correlação em headers; endpoints admin de provider; validação do quickstart completa.

Fora do escopo desta feature (registrado na spec): KEDA/autoscaling por fila, backend S3 ativo, OTel SDK no Node, orçamento de enriquecimento por custo/valor.
