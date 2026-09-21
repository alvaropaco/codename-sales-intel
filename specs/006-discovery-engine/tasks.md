# Tasks: B2Base Discovery Engine

## Phase 1: Setup
- [x] T001 [P] Create discovery/ module and fixtures.
- [x] T002 [P] Create provider defaults, capability taxonomy and secret references.
- [x] T003 [P] Add job/provider/enrichment metrics.
## Phase 2: Foundational
- [x] T004 [P] Add Prisma models/migration for DiscoveryJob, DiscoveryProviderRun, DiscoveryEntity, DiscoveryRelationship, DiscoveryEvidence, DiscoveryCandidate and DiscoverySignal.
- [x] T005 [P] Add provider contracts and registry for discovery + enrichment capabilities.
- [x] T006 [P] Add normalization, canonical keys, identifiers and confidence helpers.
- [x] T007 [P] Add NATS discovery.*.v1 events and idempotent consumption.
- [x] T008 [P] Add tenant-scoped persistence, temporal observations and idempotent upserts.
- [x] T009 Write foundational contract/normalizer/persistence tests first.
## Phase 3: User Story 1 — Commercial Discovery
- [x] T010 [P] Implement CNPJ MCP provider.
- [x] T011 [P] Implement SearXNG provider.
- [x] T012 [P] Implement optional Serper provider with budgets.
- [x] T013 [P] Implement Brave and Exa providers.
- [x] T014 Implement discovery job API with org isolation.
- [x] T015 Implement orchestrator fan-out/fan-in with timeout/retry/concurrency.
- [x] T016 Test mixed-provider success/failure, dedup and progress.
## Phase 4: User Story 2 — Digital Discovery
- [x] T017 [P] crt.sh CT provider.
- [x] T018 [P] DNS/RDAP provider.
- [x] T019 [P] ProjectDiscovery-compatible bounded adapter.
- [x] T020 [P] HTTP metadata provider.
- [x] T021 Persist domain/subdomain/host/IP/ASN/technology relations and evidence.
- [x] T022 Add seed-domain and interruption/retry tests.
## Phase 5: User Story 4 — Corporate Enrichment
- [x] T023 [P] Define CorporateProfile normalization and source-independent identifiers.
- [x] T024 [P] Implement CNPJ identity/classification: legal name, trade name, status, opening date, legal nature, size and CNAEs.
- [x] T025 [P] Implement address/establishment/branch enrichment.
- [x] T026 [P] Implement ownership normalization for partners, directors and representatives.
- [x] T027 Add conflicting-observation and temporal corporate fact tests.
## Phase 6: User Story 4 — Financial Enrichment
- [x] T028 [P] Define FinancialProfile and financial evidence types.
- [x] T029 [P] Implement capital social and public financial observation normalization.
- [x] T030 [P] Implement funding round/investor entities and RAISED/INVESTED_BY.
- [x] T031 Add estimated-vs-reported financial evidence tests.
## Phase 7: User Story 4 — Legal Enrichment
- [x] T032 [P] Define LegalProfile and legal entity/relationship taxonomy.
- [x] T033 [P] Implement legal provider contract and Jusbrasil/Escavador-compatible adapters.
- [x] T034 [P] Normalize cases, courts, parties, documents, events and case identifiers.
- [x] T035 Add legal deduplication/provenance tests across providers.
## Phase 8: User Story 4 — Ownership + Intelligence
- [x] T036 [P] Normalize people and company ownership/control relationships.
- [x] T037 [P] Add DiscoverySignal derived projection with evidence references.
- [x] T038 Add company intelligence aggregation API without replacing source evidence.
## Phase 9: User Story 3 — Routing and Cost
- [x] T039 Resolve rate/timeout/retry/budget policy.
- [x] T040 Add fallback ordering preferring self-hosted/free providers.
- [x] T041 Record requests/latency/estimatedCost.
- [x] T042 Add budget_exhausted handling/tests.
- [x] T043 Optional SpiderFoot adapter with hard timeout outside request path.
## Phase 10: Evidence and Candidate Projection
- [x] T044 [P] Candidate projection/dedupe by CNPJ/domain/name.
- [x] T045 [P] Evidence hash/idempotency.
- [x] T046 [P] Candidate/company evidence summary API.
- [x] T047 [P] Deterministic confidence tests.
- [x] T048 Validate conflicting facts remain auditable.
## Phase 11: Frontend
- [x] T049 [P] DiscoveryJobProgress.tsx.
- [x] T050 [P] DiscoveryCandidateList.tsx.
- [x] T051 [P] Company intelligence overview with corporate/financial/legal/ownership/digital sections.
- [x] T052 Integrate discovery progress and evidence into existing views.
## Phase 12: Polish
- [x] T053 Update quickstart/env/provider configuration docs.
- [x] T054 Run pnpm test, web build and affected service tests.
- [x] T055 Validate NATS duplicate delivery/idempotency.
- [x] T056 Compare native provider coverage/cost vs SpiderFoot on fixed fixtures.
## Phase 13: Convergence
- [x] T057 Aplicar gating por plano nos endpoints de discovery: trial = apenas providers self-hosted/free (searxng, crtsh, dns-rdap, http-metadata); premium = catálogo completo — validar contra plan.js/getOrgPlan em discovery/api.js e filtrar providerConfig do job (Constitution IV) (contradicts)
- [ ] T058 Ingerir ownership no motor: extrair sócios/diretores/representantes do CNPJ MCP (ou enrichment legado) e emitir observações via enrichers/ownership.js — hoje ownershipObservations não tem chamador em produção per FR-024 / US4 (partial)
- [ ] T059 Capturar legal documents/events nos adapters jusbrasil/escavador: mapear movimentações e documentos do processo como evidências/entidades legais dedicadas per FR-023 / US4 (partial)
- [ ] T060 Adicionar filtro/pontuação de candidatos pelo ICP da org (criteria do onboarding: CNAE/segmento/localização) em listCandidates e na projeção de candidatos per US1 / Edge Cases "resultados fora do ICP" (partial)
