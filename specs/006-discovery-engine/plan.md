# Implementation Plan: B2Base Discovery Engine

**Branch**: 006-discovery-engine | **Date**: 2026-09-20 | **Spec**: spec.md

## Summary

Construir um Discovery Engine modular. Um orquestrador cria jobs e dispara providers independentes para descoberta comercial e OSINT passivo. NATS JetStream transporta trabalho/resultados; Prisma/Postgres persiste jobs, entidades, relações e evidências. SearXNG é o provider self-hosted preferencial; Serper/Brave/Exa são opcionais. CNPJ MCP, CT, DNS/RDAP, subdomain e HTTP metadata formam a base. SpiderFoot fica somente como adapter opcional.

## Technical Context

Language: Node.js da plataforma; adapters externos podem usar workers Python quando necessário.
Dependencies: Express 5, Prisma 5/Postgres, NATS JetStream, SearXNG existente.
Storage: PostgreSQL via Prisma.
Testing: pnpm test + fixtures/fakes.
Target: servidor Node + workers + SPA existente.
Constraints: multi-tenancy, budget, secrets fora do repo, eventos versionados, Prisma migrations.

## Constitution Check

I ✅ spec/plan antes do código.
II ✅ discovery.*.v1 + idempotência.
III ✅ testes primeiro.
IV ✅ orgId e gating de providers.
V ✅ secrets via env/secret manager.
VI ✅ reutiliza NATS/Prisma/SearXNG/workers.
VII ✅ métricas e logs estruturados.

## Project Structure

```text
specs/006-discovery-engine/
├── spec.md
├── research.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md

discovery/
├── index.js
├── orchestrator.js
├── provider-registry.js
├── contracts.js
├── normalizer.js
├── confidence.js
├── persistence.js
└── providers/
    ├── cnpj-mcp.js
    ├── searxng.js
    ├── serper.js
    ├── brave.js
    ├── exa.js
    ├── crtsh.js
    ├── dns-rdap.js
    ├── projectdiscovery.js
    ├── http-metadata.js
    └── spiderfoot.js

nats-discovery.js
server-prod.js
prisma/schema.prisma
apps/web/src/components/discovery/
test/discovery-*.test.js
```

## Phases

1. Fundação: contratos, schema, registry, persistence, NATS, métricas.
2. Providers free/self-hosted: CNPJ MCP, SearXNG, CT, DNS/RDAP, ProjectDiscovery, HTTP metadata.
3. Paid providers: Serper, Brave, Exa.
4. Orchestration/API: jobs, retries, isolation, cost policy, candidate import.
5. UI: progress, provider states, candidates and evidence.
6. SpiderFoot compatibility adapter + coverage/cost comparison.

## Complexity

Nenhuma violação. O diretório discovery/ isola múltiplos adapters e evita acoplamento adicional em workers/search.js e server-prod.js.