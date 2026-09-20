# Tasks: B2Base Discovery Engine

## Phase 1: Setup
- [ ] T001 [P] Create discovery/ module and fixtures.
- [ ] T002 [P] Create provider defaults and secret references.
- [ ] T003 [P] Add job/provider metrics in metrics.js.

## Phase 2: Foundational
- [ ] T004 [P] Add Prisma models/migration for DiscoveryJob, DiscoveryProviderRun, DiscoveryEntity, DiscoveryRelationship, DiscoveryEvidence and DiscoveryCandidate.
- [ ] T005 [P] Add provider contracts and registry.
- [ ] T006 [P] Add normalization, canonical keys and confidence helpers.
- [ ] T007 [P] Add nats-discovery.js with discovery.*.v1 and idempotent consumption.
- [ ] T008 [P] Add persistence with tenant scoping and idempotent upserts.
- [ ] T009 Write foundational tests first in test/discovery-contracts.test.js, discovery-normalizer.test.js and discovery-persistence.test.js.

## Phase 3: User Story 1
- [ ] T010 [P] [US1] Implement CNPJ MCP provider.
- [ ] T011 [P] [US1] Implement SearXNG provider.
- [ ] T012 [P] [US1] Implement optional Serper provider with budgets.
- [ ] T013 [P] [US1] Implement Brave and Exa providers.
- [ ] T014 [US1] Implement discovery job API with org isolation.
- [ ] T015 [US1] Implement orchestrator fan-out/fan-in with timeout/retry/concurrency.
- [ ] T016 [US1] Test mixed-provider success/failure, dedup and progress.

## Phase 4: User Story 2
- [ ] T017 [P] [US2] crt.sh CT provider.
- [ ] T018 [P] [US2] DNS/RDAP provider.
- [ ] T019 [P] [US2] ProjectDiscovery-compatible adapter with bounded execution.
- [ ] T020 [P] [US2] HTTP metadata provider.
- [ ] T021 [US2] Persist domain/subdomain/host/IP relations and evidence.
- [ ] T022 [US2] Add seed-domain discovery and interruption/retry tests.

## Phase 5: User Story 3
- [ ] T023 [US3] Resolve rate/timeout/retry/budget policy.
- [ ] T024 [US3] Add fallback ordering preferring self-hosted/free.
- [ ] T025 [US3] Record requests/latency/estimatedCost.
- [ ] T026 [US3] Add budget_exhausted handling/tests.
- [ ] T027 [US3] Optional SpiderFoot adapter with hard timeout, isolated from request path.

## Phase 6: User Story 4
- [ ] T028 [US4] Candidate projection/dedupe by CNPJ/domain/name.
- [ ] T029 [US4] Evidence hash/idempotency.
- [ ] T030 [US4] Candidate evidence summary API.
- [ ] T031 [US4] Deterministic confidence tests.

## Phase 7: Frontend
- [ ] T032 [P] DiscoveryJobProgress.tsx.
- [ ] T033 [P] DiscoveryCandidateList.tsx.
- [ ] T034 Integrate discovery progress into existing discovery view.

## Phase 8: Polish
- [ ] T035 Update quickstart/env docs.
- [ ] T036 Run pnpm test, web build and affected service tests.
- [ ] T037 Validate NATS duplicate delivery/idempotency.
- [ ] T038 Compare native provider coverage/cost vs SpiderFoot on fixed fixtures.