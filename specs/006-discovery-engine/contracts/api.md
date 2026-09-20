# API Contracts: B2Base Discovery Engine

All endpoints authenticate and use requireRequestOrgId. Responses follow { success, data | error, code? }.

## POST /api/discovery/jobs
Request contains trigger, criteria, optional seed, providers and limits. Response 202 with jobId/status.

## GET /api/discovery/jobs/:id
Returns job status plus provider states, items, latency and estimated cost.

## GET /api/discovery/jobs/:id/candidates
Paginated candidates; supports page, pageSize, minConfidence and status.

## POST /api/discovery/jobs/:id/candidates/:candidateId/import
Idempotently imports a Prospect and returns candidateId/prospectId/status.

## POST /api/prospects/:id/discovery
Starts discovery from a Prospect/domain seed. Response 202 with jobId.

## GET /api/prospects/:id/discovery
Returns latest discovery scoped to the Prospect organization.

## Errors
DISCOVERY_NOT_FOUND, PROVIDER_NOT_CONFIGURED, PROVIDER_BUDGET_EXHAUSTED, DISCOVERY_JOB_RUNNING, DISCOVERY_INVALID_INPUT.

## Async
HTTP never waits for providers. Provider execution and persistence are asynchronous and idempotent.