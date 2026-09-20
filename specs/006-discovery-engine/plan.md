# Implementation Plan: B2Base Discovery Engine

**Branch**: 006-discovery-engine | **Date**: 2026-09-20 | **Spec**: spec.md

## Summary
Construir um Discovery Engine modular para descoberta comercial e OSINT passivo e, depois da identificação, enrichment corporativo, financeiro, jurídico, ownership e digital. NATS JetStream transporta trabalho/resultados; Prisma/Postgres persiste entidades canônicas, relações e evidências. SearXNG é o provider self-hosted preferencial; Serper/Brave/Exa são opcionais. CNPJ MCP, CT, DNS/RDAP, subdomain e HTTP metadata formam a base. Providers jurídicos/financeiros são adapters opcionais. SpiderFoot fica somente como adapter opcional.
## Technical Context
Language: Node.js da plataforma; adapters externos podem usar workers Python. Dependencies: Express 5, Prisma 5/Postgres, NATS JetStream, SearXNG. Storage: PostgreSQL via Prisma. Testing: pnpm test + fixtures/fakes. Constraints: multi-tenancy, budget, secrets fora do repo, eventos versionados, Prisma migrations.
## Provider / Enrichment Boundary
Every adapter implements: input seed → provider request → normalized observations → entities/relationships/evidence → persistence. Providers never write vendor-specific records directly into the application domain.
Capability taxonomy: corporate.identity, corporate.registration, corporate.classification, corporate.ownership, financial.profile, financial.funding, financial.events, legal.cases, legal.documents, digital.domains, digital.infrastructure, digital.contacts, web.search.
## Enrichment Flow
Commercial Criteria / Domain Seed → Discovery Job → Canonical Company Entity → Corporate + Financial + Legal + Ownership + Digital → Evidence + Relationships → Intelligence Signals.
Enrichment stages are independently retryable. A legal provider failure must not block corporate or digital enrichment.
## Project Structure
discovery/index.js; orchestrator.js; provider-registry.js; contracts.js; normalizer.js; confidence.js; persistence.js; enrichers/corporate.js; enrichers/financial.js; enrichers/legal.js; enrichers/ownership.js; providers/cnpj-mcp.js; searxng.js; serper.js; brave.js; exa.js; crtsh.js; dns-rdap.js; projectdiscovery.js; http-metadata.js; jusbrasil.js; escavador.js; cvm.js; funding.js; spiderfoot.js.
## Phases
1. Foundation: contracts, expanded schema, registry, persistence, NATS, metrics.
2. Free/self-hosted: CNPJ MCP, SearXNG, CT, DNS/RDAP, ProjectDiscovery, HTTP metadata.
3. Corporate enrichment: CNPJ identity/classification/address/ownership normalization.
4. Financial/legal enrichment: provider adapters, evidence preservation, funding and case normalization.
5. Paid providers: Serper, Brave, Exa and optional legal/financial providers.
6. Orchestration/API: jobs, retries, isolation, cost policy, candidate import.
7. UI: progress, provider states, company profile, evidence and relationship views.
8. SpiderFoot compatibility adapter + coverage/cost comparison.
## Data Integrity Rules
CNPJ is the strongest company identity key when present. Domains are normalized before matching. Names are supporting identity signals. Every mutable fact has observation/source metadata. Conflicting facts remain separate evidence; reconciliation is derived. Estimated financial values carry explicit evidence type. Legal cases retain source references and identifiers when available. Ownership relations are temporal when source data provides effective dates. Derived intelligence signals reference supporting evidence.
## Complexity
Nenhuma violação. discovery/ isolates adapters/enrichers and avoids coupling to search.js and server-prod.js.