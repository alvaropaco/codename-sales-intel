# Architecture

`company-enrichment-worker` is a standalone, event-driven, horizontally
scalable system for company enrichment. It supports **two operating modes**
from one codebase/container:

1. **Legacy single-process mode** (`WORKER_TYPES=core`, the default): a worker
   pod consumes `enrichment.company.requested.v1` and runs the classic 15-stage
   pipeline in one process. This is the currently deployed behavior.
2. **Multi-worker graph mode** (any other `WORKER_TYPES`): independent worker
   types (each its own Deployment/pod type) build a durable **enrichment
   graph** — capabilities run separately, scale/retry/deploy independently, and
   discovered entities can legally trigger follow-on enrichment.

See `docs/PLAN_OSINT_EXPANSION.md` for the full design.

## System context

```
Main Platform
     │  (publishes)
     ▼
NATS JetStream  (existing `legal-nats`)
     │  enrichment.company.requested.v1
     ▼
┌───────────────────────────────────────────────────────────────┐
│  Multi-worker (graph) mode:                                  │
│  orchestrator → company cases → seed directives               │
│       │ enrichment.worker.<type>.requested.v1                 │
│       ▼                                                       │
│  registry / domain / bbot / spiderfoot / social / contacts /  │
│  financial / people / tech / relationships / validator        │
│       │  entities/facts/relations                             │
│       ▼                                                       │
│  entity.discovered → guardrails → follow-up directives        │
│  (bounded depth + budget + kind allowlist)                    │
│       │  when pending == 0                                   │
│       ▼  aggregate → versioned profile                       │
└───────────────────────────────────────────────────────────────┘
     │
     ▼
Existing PostgreSQL (schema `company_enrichment`, + graph tables)
     │  transactional outbox (legacy mode) / idempotent graph writes
     ▼
NATS JetStream
     │  enrichment.company.completed.v1 / partial / failed / dlq
     ▼
Main Platform  (subscribes)
```

## Components

| Module | Responsibility |
|---|---|
| `workers.registry` | `WorkerType` registry, `core` alias expansion, per-type NATS subjects, concurrency defaults |
| `worker.GraphModeWorker` | Per-worker-type drain loop; orchestrator also consumes company requests + entity discoveries |
| `services.GraphDirector` | Case creation, seed fan-out, guard-checked follow-up scheduling, directive execution (lease + heartbeat), persistence, finalization |
| `services.GraphPlanner` | Pure guardrail logic: depth budget, directive budget, kind allowlist, leaf-kinds terminal |
| `services.GraphAggregator` | Composes the final company profile from entities/facts/relations |
| `services.EntityResolution` | Deterministic canonical keys (namespace normalization, CNPJ/email/phone/domain) |
| `db.GraphRepository` | Idempotent upserts for cases, worker jobs, entities, relations, facts; leases + pending counters |
| `db.graph_models` | `enrichment_cases`, `enrichment_worker_jobs`, `entities`, `entity_relations`, `enrichment_facts` |
| `workers.capabilities.*` | Per-worker-type enrichment logic (registry QSA→people, domain, tech, contacts, financial, bbot, spiderfoot, social, people, relationships) |
| `providers.bbot` / `spiderfoot` | Bounded subprocess wrappers (module allowlist, timeout, event cap) |
| Legacy modules (`worker.Worker`, `JobRunner`, `Pipeline`, `services.*`) | Classic single-process mode (unchanged) |

## Worker types and responsibilities

| Type | Responsibility |
|---|---|
| `orchestrator` | Company requests → cases → seed directives; entity discoveries → guard-checked follow-ups; pending==0 → aggregate + complete |
| `registry` | CNPJ firmographics + QSA → people/owners/directors (`OWNER_OF`/`DIRECTOR_OF`) |
| `domain` | Website/domain discovery + validation (reuses existing services) |
| `bbot` | BBOT recon: subdomains/DNS/emails/social/tech → entities + facts |
| `spiderfoot` | Optional complementary passive recon (cert history / co-hosted) |
| `social` | Public social profiles (LinkedIn/Instagram/Facebook) |
| `contacts` | Corporate email + phone discovery from public pages |
| `financial` | Revenue/financial *indicators* from registry data (never factual revenue) |
| `people` | People from QSA + page/email links |
| `tech` | Technology fingerprints (reuses existing TechDetectionService) |
| `relationships` | Entity relation/dedup inference (co-ownership/SAME_OWNER) |
| `validator` | Deterministic candidate validation/dedup (planned) |

`core` = `orchestrator,registry,domain,contacts,tech,validator` in one pod,
mirroring the legacy pipeline.

## Durability model (graph mode)

Same invariants as legacy mode, extended to the graph:

- **at-least-once**: directive ACK only after durable graph writes.
- **idempotent fan-out**: `enrichment_worker_jobs` unique
  `(case_id, worker_type, entity_key)` → a rediscovered entity never creates a
  duplicate directive.
- **entity dedup**: `entities` unique `(entity_type, entity_key)`; a duplicate
  becomes a merge contribution, not a new discovery event.
- **leases + heartbeat** per directive (reuses existing semantics).
- **recursion guards**: depth budget, directive budget, kind allowlist, leaf
  kinds terminal. Guards are enforced both in the planner and by the DB unique
  keys as the cross-replica backstop.
- **PENDING countdown**: `enrichment_cases.pending` decremented exactly once per
  directive outcome (`WHERE pending > 0`); when it hits 0 the case is finalized
  (COMPLETED unless any directive FAILED → PARTIAL).

## Scaling

- Each worker type has its own NATS durable pull consumer
  (`enrichment-<type>`), so queues scale independently. A bbot backlog does not
  scale the social fleet.
- `WORKER_CONCURRENCY` bounds per-pod parallelism (bbot default 2 because each
  scan spawns a subprocess; others 10).
- Helm renders one Deployment (with optional HPA) per configured `workerTypes`
  entry; the legacy deployment stays `WORKER_TYPES=core`.
- Provider limits (FlareSolverr concurrency, per-provider rate limits, circuit
  breakers, BBOT/SpiderFoot per-scan timeouts) honored regardless of pod count.

## Observability

- `/metrics`, `/healthz`, `/readyz` on ClusterIP only (legacy + every worker
  type pod).
- JSON structured logs; OpenTelemetry when `OTEL_EXPORTER_OTLP_ENDPOINT` set.
- New metrics: OSINT scans/events, entity/fact/relations counters, worker
  directive counters + duration, graph guard rejections, case status.
- Metrics never use CNPJ/company_id/tenant_id as labels.
