# Research: B2Base Discovery Engine

Feature: 006-discovery-engine

## Decisions

- Provider adapters + orchestrator; SpiderFoot is not the primary engine.
- Common SearchProvider: SearXNG first, optional Serper/Brave/Exa; Google Custom Search is not foundational.
- Passive infra scope: CT, DNS/RDAP, subdomain and bounded HTTP metadata.
- Existing MCP-CNPJ becomes a first-class provider; CNPJ is the strongest Brazilian dedupe key.
- Prisma/Postgres stores job/provider/entity/relationship/evidence/candidate data; no graph DB in v1.
- Versioned NATS subjects: discovery.job.requested.v1, discovery.provider.requested.v1, discovery.provider.completed.v1, discovery.provider.failed.v1, discovery.candidate.upserted.v1.
- Provider defaults: API timeout 20s; collector timeout 45s; 2 retries; concurrency 2.
- Deterministic confidence defaults: official CNPJ .98, CT .92, DNS/RDAP .90, direct site .88, search .72, inferred relation .55.
- Paid providers expose budget/request quotas; self-hosted/free providers are preferred before paid fallback.
- Provider tests use fixtures/fakes; no public API dependency.
- Existing repo seams: DISCOVERY.md, workers/search.js, identity.js, company-deep.js, NATS, Prisma/Postgres and Spec Kit.