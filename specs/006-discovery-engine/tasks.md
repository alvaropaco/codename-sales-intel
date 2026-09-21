# Tasks: B2Base Discovery Engine

## Phase 1: Setup
- [ ] T001 [P] Create discovery/ module and fixtures.
- [ ] T002 [P] Create provider defaults, capability taxonomy and secret references.
- [ ] T003 [P] Add job/provider/enrichment metrics.
## Phase 2: Foundational
- [ ] T004 [P] Add Prisma models/migration for DiscoveryJob, DiscoveryProviderRun, DiscoveryEntity, DiscoveryRelationship, DiscoveryEvidence, DiscoveryCandidate and DiscoverySignal.
- [ ] T005 [P] Add provider contracts and registry for discovery + enrichment capabilities.
- [ ] T006 [P] Add normalization, canonical keys, identifiers and confidence helpers.
- [ ] T007 [P] Add NATS discovery.*.v1 events and idempotent consumption.
- [ ] T008 [P] Add tenant-scoped persistence, temporal observations and idempotent upserts.
- [ ] T009 Write foundational contract/normalizer/persistence tests first.
## Phase 3: User Story 1 — Commercial Discovery
- [ ] T010 [P] Implement CNPJ MCP provider.
- [ ] T011 [P] Implement SearXNG provider.
- [ ] T012 [P] Implement optional Serper provider with budgets.
- [ ] T013 [P] Implement Brave and Exa providers.
- [ ] T014 Implement discovery job API with org isolation.
- [ ] T015 Implement orchestrator fan-out/fan-in with timeout/retry/concurrency.
- [ ] T016 Test mixed-provider success/failure, dedup and progress.
## Phase 4: User Story 2 — Digital Discovery
- [ ] T017 [P] crt.sh CT provider.
- [ ] T018 [P] DNS/RDAP provider.
- [ ] T019 [P] ProjectDiscovery-compatible bounded adapter.
- [ ] T020 [P] HTTP metadata provider.
- [ ] T021 Persist domain/subdomain/host/IP/ASN/technology relations and evidence.
- [ ] T022 Add seed-domain and interruption/retry tests.
## Phase 5: User Story 4 — Corporate Enrichment
- [ ] T023 [P] Define CorporateProfile normalization and source-independent identifiers.
- [ ] T024 [P] Implement CNPJ identity/classification: legal name, trade name, status, opening date, legal nature, size and CNAEs.
- [ ] T025 [P] Implement address/establishment/branch enrichment.
- [ ] T026 [P] Implement ownership normalization for partners, directors and representatives.
- [ ] T027 Add conflicting-observation and temporal corporate fact tests.
## Phase 6: User Story 4 — Financial Enrichment
- [ ] T028 [P] Define FinancialProfile and financial evidence types.
- [ ] T029 [P] Implement capital social and public financial observation normalization.
- [ ] T030 [P] Implement funding round/investor entities and RAISED/INVESTED_BY.
- [ ] T031 Add estimated-vs-reported financial evidence tests.
## Phase 7: User Story 4 — Legal Enrichment
- [ ] T032 [P] Define LegalProfile and legal entity/relationship taxonomy.
- [ ] T033 [P] Implement legal provider contract and Jusbrasil/Escavador-compatible adapters.
- [ ] T034 [P] Normalize cases, courts, parties, documents, events and case identifiers.
- [ ] T035 Add legal deduplication/provenance tests across providers.
## Phase 8: User Story 4 — Ownership + Intelligence
- [ ] T036 [P] Normalize people and company ownership/control relationships.
- [ ] T037 [P] Add DiscoverySignal derived projection with evidence references.
- [ ] T038 Add company intelligence aggregation API without replacing source evidence.
## Phase 9: User Story 3 — Routing and Cost
- [ ] T039 Resolve rate/timeout/retry/budget policy.
- [ ] T040 Add fallback ordering preferring self-hosted/free providers.
- [ ] T041 Record requests/latency/estimatedCost.
- [ ] T042 Add budget_exhausted handling/tests.
- [ ] T043 Optional SpiderFoot adapter with hard timeout outside request path.
## Phase 10: Evidence and Candidate Projection
- [ ] T044 [P] Candidate projection/dedupe by CNPJ/domain/name.
- [ ] T045 [P] Evidence hash/idempotency.
- [ ] T046 [P] Candidate/company evidence summary API.
- [ ] T047 [P] Deterministic confidence tests.
- [ ] T048 Validate conflicting facts remain auditable.
## Phase 11: Frontend
- [ ] T049 [P] DiscoveryJobProgress.tsx.
- [ ] T050 [P] DiscoveryCandidateList.tsx.
- [ ] T051 [P] Company intelligence overview with corporate/financial/legal/ownership/digital sections.
- [ ] T052 Integrate discovery progress and evidence into existing views.
## Phase 12: Polish
- [ ] T053 Update quickstart/env/provider configuration docs.
- [ ] T054 Run pnpm test, web build and affected service tests.
- [ ] T055 Validate NATS duplicate delivery/idempotency.
- [ ] T056 Compare native provider coverage/cost vs SpiderFoot on fixed fixtures.