# Quickstart: B2Base Discovery Engine

## Setup

```bash
pnpm install
pnpm run db:migrate
pnpm test
```

## Profile discovery
POST /api/discovery/jobs with CNAE/location/segment → GET /api/discovery/jobs/:id → GET candidates → POST candidate import.

## Domain discovery
Create a job with seed.domain and providers crtsh, dns-rdap, projectdiscovery and http-metadata.

## Provider failure
Use a fake provider that times out; verify independent providers persist successfully and the job becomes partial/completed according to policy.

## Idempotency
Deliver the same discovery.provider.completed.v1 twice; verify no duplicate entities, relations, evidence or candidates.

## Budget
Exceed a paid provider maxRequests/dailyBudget; verify budget_exhausted and fallback to configured alternatives.