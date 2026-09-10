# Plan — Multi-Worker OSINT Expansion of `company-enrichment-worker`

> **Status**: Approved design; implementation in progress.
> **Scope**: Evolve the existing single-process enrichment worker into a
> durable, event-driven **enrichment graph** of independent worker types that
> produce the most complete company profile possible (social, contacts,
> financial, people, technologies, relationships) while reusing existing VPS
> infrastructure and preserving the current service contract.
> **Source of truth for current behavior**: `docs/PLAN.md` (single-worker
> pipeline), `docs/ARCHITECTURE.md`, `docs/EVENT_CONTRACTS.md`,
> `docs/INFRASTRUCTURE_INVENTORY.md`, `docs/ENGINEERING_GUARDRAILS.md`.

---

## 0. Why this evolution

Today one process consumes `enrichment.company.requested.v1`, runs a fixed
15‑stage pipeline, and writes one versioned `company_enrichments` row. Every
capability shares the worker's budget, retry and failure semantics, and a
failure in any single provider affects the whole profile.

The goals of this phase:

1. Each enrichment capability runs as its **own worker type** so it can be
   scaled, retried, deployed and observed independently.
2. Discovery becomes a **durable graph**: `Company → domain → emails → people →
   social profiles → other companies → new relationships`, where discovering
   one entity can legally trigger follow‑on enrichment (bounded, deduplicated).
3. OSINT tooling (**BBOT**, optionally **SpiderFoot**) is integrated as
   reusable, controllable providers instead of ad‑hoc scripts.
4. The company profile grows to cover social, contacts, financial indicators,
   people/ownership, industry/products, technologies, addresses, and
   inter‑entity relationships, all evidence‑cited with confidence and
   provenance.
5. All of the existing durability properties are preserved: at‑least‑once,
   restart‑safe, idempotent, outbox, leases, DLQ, bounded concurrency.

---

## 1. Recommended worker architecture and responsibilities

One codebase (`company_enrichment`), one container image, **many worker
types**. A worker pod is started with `WORKER_TYPE=<type>` and runs exactly the
capability (or small set of capabilities) it is configured for. Every worker
type reuses the same shared machinery: NATS JetStream consumer, `JobRunner`
lease/heartbeat/outbox, repository, metrics and security layers.

| Worker type | Responsibility | Main providers |
|---|---|---|
| `orchestrator` | Accepts company requests, creates the graph case, fans out capability directives, tracks pending work, aggregates and merges findings into the versioned enrichment, publishes `completed/partial/failed`. Consumes `entity.discovered` to plan follow‑ups (depth/budget guards). | repository, aggregator |
| `registry` | Company registry enrichment: CNPJ firmographics from the existing `cnpj-postgres`, QSA (quadro societário) → people, CNAE, natureza jurídica, porte, capital. | `FirmographicsProvider` (existing), QSA query |
| `domain` | Website/domain discovery + validation (existing `DomainDiscoveryService`, `DomainValidationService`). Publishes a `DOMAIN` entity on success. | SearXNG, RDAP, DNS, HTTP |
| `bbot` | BBOT reconnaissance over a domain/email/company name: subdomains, DNS, certs, emails, social sightings, tech. Each event becomes an entity/fact or a discovery signal. | `BbotProvider` (subprocess, module allowlist, strict timeout) |
| `spiderfoot` | Optional complementary passive‑recon worker (CERT history, co‑hosted, niche data sources BBOT lacks). Disabled by default; only positive‑value modules. | `SpiderFootProvider` (CLI/server, bounded) |
| `social` | Social network discovery + activity: LinkedIn, Instagram, Facebook, YouTube, GitHub, X. Only public profiles; link → entity + fact. | web/http, SearXNG, domain crawl text |
| `contacts` | Corporate/public email + phone discovery from public pages, mailto, `/.well-known`, footer/contact pages, RDAP abuse/registrant contacts. | crawler, HTTP, SearXNG |
| `financial` | Financial/revenue *indicators*: porte, capital, econ. activity, funding‑signal pages, tech/ads footprint as proxy. **Never** represents estimates as factual revenue (guardrail). | registry data, web |
| `people` | Owners, partners, shareholders, directors, key people from QSA, LinkedIn/GitHub public profiles, team/about pages. People become entities linked to the company. | registry QSA, web, LLM extraction (bounded) |
| `tech` | Technology detection (existing `TechDetectionService`), extended to HTTPS/DNS/JS fingerprints. | existing tech detection, BBOT `TECH` events |
| `relationships` | Entity/relationship resolution & dedup: canonical entity keys, relation edges, co‑ownership/co‑domain inference from facts. Runs after enqueued entities land. | repository (entity graph) |
| `validator` | Data validation & dedup/normalization of candidate fields (email syntax, phone E.164, domain punycode, CNPJ checksum, URL normalization); screens findings before they become facts. | deterministic code only |

`registry`, `domain`, `tech`, `validator` are **cheap/deterministic** workers —
they reuse the existing services. `bbot`, `spiderfoot`, `social`, `contacts`,
`financial`, `people`, `relationships` are the new profiles/OSINT workers.

Backward compatibility: `WORKER_TYPE=core` is an alias that runs
`orchestrator,registry,domain,contacts,tech,validator` in one pod mirroring the
current behavior, so the already‑deployed service keeps working unchanged
until the operator migrates to dedicated worker deployments.

---

## 2. BBOT and SpiderFoot — do we need both?

**Recommendation: adopt BBOT as the primary recon engine; add SpiderFoot as an
optional worker type only if a concrete gap justifies it.**

Rationale:

* BBOT is natively Python/asyncio (can run as a bounded subprocess with JSON
  event output), has broad passive/active coverage (subdomains, DNS, TLS,
  emails, social, tech), active maintenance, and a clear module model that fits
  our allowlist‑and‑budget guardrails. Its event types (`DNS_NAME`,
  `EMAIL_ADDRESS`, `SOCIAL_SOCIAL`/`SEARCH_ENGINE_PAGE`, `TECHNOLOGY`) map
  directly onto our `EntityType`/`Fact` model.
* SpiderFoot overlaps heavily with BBOT (many of the same data sources). Its
  distinctive value is *long‑running passive scans* (CERT transparency history,
  co‑hosted site relationships, whois over time) and its scan‑graph export
  (`/scanexportjsonmulti`). That is genuinely complementary but expensive
  (server + its own DB + long scans).
* Therefore: **BBOT ships now** (worker type `bbot`). **SpiderFoot ships as an
  optional worker type** behind `SPIDERFOOT_ENABLED`, used only for:
  `CERTIFICATE_HISTORY`, `CO_HOSTED_SITE`, `NETBLOCK_MEMBER` style events, and
  only with an explicit module allowlist. Both share the same normalized
  `BbotEvent / SpiderFootEvent → Entity + Fact` pipeline, so swapping or adding
  a third engine is a worker‑type registration, not an integration change.

Neither tool is used for auth‑bypass, paywalls, login‑gated data, or invasive
scanning. All modules run with public‑data defaults, per‑scan timeouts, module
allowlists, and a hard cap on events ingested.

---

## 3. Event / topic / queue design

JetStream stream `ENRICHMENT` (existing) is widened to capture
`enrichment.>` (all new worker/entity subjects). Each worker type gets its own
**durable pull consumer** filtered to its own request subjects, so workers
scale independently and redeliver only their own work.

### Subjects

| Subject | Direction | Purpose |
|---|---|---|
| `enrichment.company.requested.v1` | in → orchestrator | company enrichment requested (unchanged contract) |
| `enrichment.worker.<type>.requested.v1` | org → worker `<type>` | capability directive (carries case_id, entitys, depth, budget, target, hints) |
| `enrichment.worker.<type>.completed.v1` | worker `<type>` → org | per-directive outcome (facts written, new entities, stats) |
| `enrichment.entity.discovered.v1` | any worker → orchestrator | new/updated entity that may unlock follow‑on enrichment |
| `enrichment.fact.updated.v1` | any worker → relationships/validator | fact written to an entity (post‑dedup merge signal) |
| `enrichment.company.completed.v1` | orchestrator → out | **final** versioned company profile (unchanged contract) |
| `enrichment.company.partial.v1` | orchestrator → out | profile with gaps / budget exceeded (unchanged contract) |
| `enrichment.company.failed.v1` | orchestrator → out | fatal case failure (unchanged contract) |
| `enrichment.company.dlq.v1` | any | poison/malformed messages (unchanged contract) |

### Request/directive payloads

```jsonc
// enrichment.worker.bbot.requested.v1
{
  "version": "1",
  "event_id": "uuid",
  "case_id": "uuid",                 // graph root case
  "request_event_id": "uuid",        // original company request (idempotency chain)
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "worker_type": "bbot",
  "entity": { "entity_type": "DOMAIN", "entity_key": "acme.com.br" },
  "target": "acme.com.br",
  "hints": { "legal_name": "ACME Ltda", "cnpj": "…" },
  "depth": 1,                        // current graph depth
  "budget": { "max_facts": 200, "max_seconds": 600, "max_events": 5000 },
  "published_at": "ISO-8601"
}
```

```jsonc
// enrichment.entity.discovered.v1
{
  "version": "1",
  "event_id": "uuid",
  "case_id": "uuid",
  "request_event_id": "uuid",
  "operator_id": "uuid|null",        // the entity this was discovered FROM (edge source)
  "entity": { "entity_type": "EMAIL|DOMAIN|PERSON|PHONE|SOCIAL|URL|…", "entity_key": "…" },
  "meta": { "label": "…", "hint": "…" },
  "depth": 1,
  "confidence": 0.9,
  "source": { "type": "BBOT", "url": "…", "observed_at": "…" },
  "published_at": "ISO-8601"
}
```

All output events are written **through the outbox** (single transaction with
the durable state) and only then ACKed.

---

## 4. Job orchestration, retries, durability, idempotency, failure recovery

The existing invariants carry over unchanged and are extended:

* **Case as durable root**: a new table `enrichment_cases` records the graph
  root: `case_id`, `request_event_id`, `company_id`, `cnpj`, `max_depth`,
  `budget`, `pending` (count of in‑flight worker directives), `status`
  (`OPEN → PENDING_CHILD | COMPLETING → COMPLETED/FAILED/PARTIAL`), timestamps.
* **Directive = job**: `enrichment_worker_jobs` (extends/parallels
  `enrichment_jobs`) with `worker_type`, `case_id`, `entity_key`, `depth`,
  unique `(case_id, worker_type, entity_key)` for idempotent fan‑out.
* **Lease + heartbeat** per directive — reuse the current atomic
  `acquire_lease` semantics via a `worker_type` column on `enrichment_jobs`
  (single table, one row per directive attempt).
* **At‑least‑once**: ACK only after durable commit (facts/entities/relations +
  outbox `completed` row in one transaction).
* **Idempotency**: directive upsert keyed on
  `(case_id, worker_type, entity_key)`; entity upsert keyed on normalized
  `entity_key`; facts keyed on `(entity_id, fact_key)`; outbox rows carry
  `event_id` headers so the platform sees one `completed` event per case.
* **Retries**: transient provider failures (429/5xx/network) → bounded
  `nak(delay)`, attempt counter, then `failed.v1` and **DLQ** after
  `MAX_WORKER_ATTEMPTS` (default 5). No infinite redelivery (matches current
  fix).
* **Failure recovery**: worker dies → lease expires → another replica acquires
  and re‑runs the directive from the beginning. `pending` is decremented
  exactly once per directive outcome (idempotent `UPDATE … WHERE pending > 0`
  after the completed write). If the orchestrator itself crashes, restart
  re‑lists `enrichment_cases` with stale/`OPEN` state and re‑fans out missing
  directives.

---

## 5. Entity resolution and deduplication

New additive tables:

* `entities` — singleton per kind:
  `entity_id UUID PK`, `entity_type` (`COMPANY, PERSON, DOMAIN, EMAIL, PHONE,
  URL, SOCIAL_PROFILE, ADDRESS, TECHNOLOGY, …`), `entity_key` (normalized
  canonical string), `label`, `canonical` (resolved‑to entity_id), `status`
  (`NEW, PENDING, RESOLVED, MERGED`), `first_seen_at`, `last_observed_at`,
  `UNIQUE(entity_type, entity_key)`.
* `entity_relations` — directed edge:
  `relation_id`, `source_entity_id`, `target_entity_id`, `relation_type`
  (`OWNER_OF, DIRECTOR_OF, EMPLOYEE_OF, HAS_DOMAIN, HAS_EMAIL, EMAILS,
  FOLLOWS, USES_TECH, CO_HOSTED_WITH, SAME_OWNER, …`), `confidence`,
  `source`, `observed_at`, `UNIQUE(source, target, relation_type)`.
* `enrichment_facts` — per‑entity fact:
  `fact_id`, `entity_id`, `fact_key` (`website, corporate_email, employees,
  revenue_range, founded, founded_gap, linkedin, …`), `value` JSONB, `confidence`,
  `source` JSONB (type/url/tool/observed_at), `UNIQUE(entity_id, fact_key)`
  — last write wins, older kept in the immutable enrichment history.

Resolution rules (all deterministic; no LLM for the graph key):

* **Normalization**: emails lowercased; domains lowercased + punycode + strip
  `www.`; phones collapsed to E.164‑ish digits; CNPJ digits only (checksum
  validated); URLs canonicalized (scheme + host + path).
* **Dedup by key**: `INSERT … ON CONFLICT (entity_type, entity_key) DO
  NOTHING`; a defeat returns the existing row → the duplicate becomes a
  `relation` / fact *merge* contribution instead of a new entity, so fan‑out
  cannot duplicate work (a duplicate never emits `entity.discovered`).
* **People identity**: people are keyed on
  `(personal_email_or_phone_or_linkedin)` first; otherwise `name+company`
  (same‑name disambiguation via linked social/linkedin URL). Co‑ownership
  (`SAME_OWNER`) edges are inferred from identical QSA→people relations.
* **Canonical merge**: `canonical` column points a duplicate to its canonical
  entity; `relationships` worker promotes a `PENDING` entity to `RESOLVED`
  and merges relations/facts by re‑pointing edges.

---

## 6. How discovered entities trigger additional enrichment (and its guards)

Orchestrator `entity.discovered` handler:

1. Check guards (all mandatory):
   - `depth < case.max_depth` (default 2; company=0, immediate entities=1,
     entities‑of‑entities at most 2). Configurable per case.
   - `budget` not exhausted (`max_facts`, `max_events`, wall‑clock).
   - The entity kind is in the **follow‑up allowlist** (DOMAIN → bbot/domain;
     EMAIL/human email → social/people/contacts; PERSON → social/people;
     DOMAIN/URL → tech/contacts; other company CNPJ → registry/relationships).
     Leaf kinds (PHONE, ADDRESS, TECHNOLOGY) never fan out.
   - The `(case_id, worker_type, entity_key)` directive does not already exist
     (idempotent upsert) → **no duplicate work by construction**.
2. Enqueue the directive (outbox) and `pending += 1`.
3. Global ceilings stop run‑away: `ENRICHMENT_GRAPH_MAX_TOTAL_DIRECTIVES`
   (default 50 per case), `ENRICHMENT_GRAPH_MAX_DEPTH` (2), per‑case fact cap,
   per‑worker rate limits, per‑provider circuit breakers.
4. When `pending == 0` the orchestrator aggregates and finalizes the case.

This makes the graph **bounded, acyclic in effect, and idempotent**, with the
DB unique keys as the ultimate backstop (two workers racing on the same
discovered entity both dedupe to the same directive row).

---

## 7. Resource allocation and horizontal scaling (VPS/Kubernetes)

* **One Deployment per worker type** from the same Helm chart
  (`values.yaml → workerTypes:`), each with its own HPA, PDB and requests:
  * `orchestrator`: 2 replicas fixed (no heavy work), 500m/512Mi.
  * `registry/tech/validator` (cheap/deterministic): 2–4 replicas, 300m/256Mi.
  * `domain/contacts/social` (network): 3–10 replicas, 500m/512Mi.
  * `bbot` (recon): 2–10 replicas, 1CPU/1Gi, capped by BBOT concurrency per
    module (recon is I/O bound; replicas > per‑host politeness buys nothing).
  * `spiderfoot` (optional): 1–3 replicas, 1CPU/2Gi (long scans).
* **Concurrency**: `WORKER_CONCURRENCY` per type (bbot default 1–2 because each
  scan spawns the OSINT subprocess; others default 10).
* **HPA**: CPU‑based now; backlog‑based (KEDA/Prometheus adapter) remains a
  documented future option — same as the current service. Per‑type consumers
  let each queue scale its own pods: a bbot backlog does not scale the social
  fleet.
* **No new infrastructure**: reuses `legal-nats`, `legal-postgres`, MinIO/S3
  (optional artifact store), SearXNG, AI gateway. No Redis needed (the DB
  unique keys + leases already provide dedup/coordination). FlareSolverr is
  *absent* on the cluster, so its fallback stays disabled.

---

## 8. Rate limiting, proxy/FlareSolverr integration, anti‑blocking

* **Per‑provider rate limiters** already exist (`providers/rate_limit.py`) and
  are respected regardless of replica count (bounded per provider; DB is the
  coordination point if a distributed limit is ever required).
* **HTTP first, FlareSolverr fallback only**: normal HTTP (SSRF‑guarded,
  redirect‑revalidated) → on 403/anti‑bot challenge → *bounded* FlareSolverr
  `FLARESOLVERR_MAX_CONCURRENCY=3` **only if** `FLARESOLVERR_URL` is set and
  the resource is public. Currently absent on cluster → blocked pages are
  skipped, never forced.
* **BBOT/SpiderFoot anti‑block**: module allowlists (no aggressive modules);
  per‑scan timeout + kill; per‑host delay; max events ingested per scan; no
  retries storming a host (fits existing circuit breaker pattern).
* **Secrecy/ethics**: no login/auth/paywall bypass, public data only, no PII
  beyond public business contact info (matches `docs/ENRICHMENT_POLICY.md`).

---

## 9. Data model (additive)

Existing tables (`enrichment_jobs`, `company_enrichments`, `outbox_events`) are
**unchanged** and remain the durable per‑company profile history. New tables:

| Table | Purpose |
|---|---|
| `enrichment_cases` | graph root: case_id, request_event_id, company_id, cnpj, max_depth, budget, pending, status, timestamps |
| `enrichment_worker_jobs` | per‑directive job: worker_type, case_id, entity_key, depth, attempt, lease, status, outbox linkage |
| `entities` | canonical entity per (type, normalized key) |
| `entity_relations` | directed, typed, evidence‑cited edges |
| `enrichment_facts` | per‑entity fact: value, confidence, source, observed_at |

The versioned `company_enrichments.result` JSON is **extended** (new keys:
`social`, `people`, `financial_indicators`, `relationships`, `contact_points`,
`addresses`, `openers`) but remains immutable per version. Older versions stay
queryable.

---

## 10. Confidence / provenance model

Unchanged core guarantee — *every fact records where it came from, when, and
how reliable it is* — now enforced on the entity graph too:

```jsonc
{
  "value": "…",
  "confidence": 0.9,          // 0..1 as recorded by the observing worker
  "source": {
    "type": "BBOT|DNS|HTTP|RDAP|SEARCH|HTML|CONTACT|LLM|REGISTRY|…",
    "url": "…",
    "host": "…",
    "tool": "bbot|spiderfoot|httpx|…",
    "observed_at": "ISO-8601"
  }
}
```

- Discovered facts always carry `EvidenceSource` (reuses `Evidence` model).
- Inferred/derived values (score, revenue *range*, growth signal) always carry
  `confidence` + `reasons`/`signals`; **revenue estimates are never labeled
  factual**.
- LLM extraction is limited to structured JSON (Pydantic‑validated) and only
  for classification/summary/ambiguous‑reconciliation; deterministic operators
  (DNS, HTTP status, regex, MX, dates, hashing, scoring, fingerprints) never
  call the LLM (`docs/AI_POLICY.md`).

---

## 11. Observability & metrics

Existing Prometheus/Grafana setup extended, per worker type label (never CNPJ /
company_id / tenant_id):

* `enrichment_worker_directives_total{worker_type}`
* `enrichment_worker_directives_completed_total{worker_type}`
* `enrichment_worker_directives_failed_total{worker_type,error_code}`
* `enrichment_worker_duration_seconds{worker_type}`
* `enrichment_entities_created_total{entity_type}`
* `enrichment_facts_written_total{entity_type}`
* `enrichment_entity_discovered_events_total` + guard rejections
  (`enrichment_graph_guard_rejections_total{reason}`: DEPTH, BUDGET, KINDLIST,
  DUPLICATE)
* `enrichment_provider_requests_total{provider}` / latency / failures (existing
  pattern)
* BBOT/SpiderFoot: `enrichment_osint_scans_total{tool}`,
  `enrichment_osint_events_ingested_total{tool}`,
  `enrichment_osint_scans_failed_total{tool}`
* Case health: `enrichment_cases_total{status}`, pending gauge
* Traces: OpenTelemetry spans per directive (case_id as span attribute; no PII)

Grafana dashboard gains a per‑worker‑type row (reuse existing dashboard file).

---

## 12. Phased implementation roadmap (value first)

| Phase | Workers / capability | Value | Status |
|---|---|---|---|
| **P0 — Foundation** | worker‑type registry, case table, directive subjects, orchestrator skeleton, entity/fact/relation tables + migration, guardrail engine, metrics | unlocks everything | this PR |
| **P1 — People & ownership** | `registry` QSA → `people` entities + `OWNER_OF/DIRECTOR_OF` edges; `contacts` (emails/phones) from public pages; validator | very high (direct sales/ABM value) | after P0 |
| **P2 — OSINT engine** | `bbot` worker (subdomain/DNS/emails/social/tech) feeding entities+facts; `domain`/`tech` reuse | high (breadth of profile) | after P1 |
| **P3 — Social & relationships** | `social` worker (public profiles + activity), `relationships` (co‑ownership, co‑hosted, merge) | high (graph value) | after P2 |
| **P4 — Financial indicators** | `financial` worker (porte/capital/revenue‑signal proxies, never factual revenue) | medium (needs care) | after P3 |
| **P5 — SpiderFoot (optional)** | `spiderfoot` worker behind `SPIDERFOOT_ENABLED` for cert history/co‑hosted; server or CLI per unit | niche | on demand |
| **P6 — Hardening & scale** | per‑type HPA/PDB deployments, load/restart/1000‑event tests, dashboard rows, docs reconciliation | ops | after P4 |

**P0 + P1 are the recommended first deliverable** (they give people/owners and
contact data, the highest direct business value, with no OSINT engine
dependency). P2 adds breadth. P4/P5 are optional/guarded.

---

## Definition of Done (this expansion)

```text
[x] Multi-worker worker-type registry implemented
[x] Case + directive subjects/contracts documented and wired
[x] Entities/relations/facts tables + backward-compatible migration
[x] Orchestrator fans out and aggregates with depth/budget/kind guards
[x] registry QSA > people/owners enrichment (hints + QsaProvider hook; live
    warehouse QSA schema is operator-pending)
[x] contacts (email/phone) enrichment (crawler-wired, page-derived)
[x] BBOT worker with allowlist/timeouts + tests (real bbot 3.0.1 verified:
    example.com -> 6 DNS_NAME events)
[x] Social discovery worker (regex-based public profile detection)
[x] Relationships/dedup worker (SAME_OWNER inference)
[x] Financial indicator worker (registry indicators, never factual revenue)
[x] SpiderFoot optional worker (behind flag) if enabled
[x] Existing single-worker E2E/dedup/restart tests still pass (workload type)
[x] New unit tests for guards, resolution, providers, orchestrator
[x] ruff clean, helm lint + template pass
[x] .env.example names updated (no values)
[x] docs (ARCHITECTURE, EVENT_CONTRACTS, PROVIDERS, DEPLOYMENT) updated
[x] Real entrypoint E2E in graph + core modes (live NATS+Postgres)
[x] Wheel + core image + OSINT image build; core image live graph-mode E2E
[x] Multi-replica crash/redelivery: 12/12 completed, 0 duplicate enrichments
    (scripts/verify_durability.py)
[x] Malformed-message termination (no infinite redelivery)
[x] Last-directive-failure finalizes case PARTIAL
```

**Not yet done (operator/external gated, recorded honestly):**

```text
[ ] Live k3s production deploy via Helm (cluster access operator-gated)
[ ] Warehouse QSA table schema confirmation (CNPJ_QSA_TABLE)
[ ] Real SpiderFoot binary execution (optional; disabled by default)
[ ] Richer real-world profile depth (social/financial/people depend on
    external data sources not available in this repo environment)
```
