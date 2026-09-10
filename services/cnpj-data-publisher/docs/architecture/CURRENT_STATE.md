# Brazilian B2B Sales Intelligence MVP — Current State Audit

**Date**: 2026-08-11  
**Status**: Milestone 0 — Repository Audit Complete

---

## 1. Existing Infrastructure Overview

### 1.1 Data Ingestion Layer (Complete)

The repository contains a **production-grade CNPJ data ingestion pipeline** that:

- **Source**: Brazilian Receita Federal open data (monthly snapshots)
- **Transport**: NATS JetStream event bus
- **Processing**: Python-based pipeline using DuckDB, Parquet, SQLAlchemy
- **Storage Backends**: Local, S3, GCS
- **Schema Version**: 1 (immutable contracts defined in `contracts/`)

#### Key Components

| Component | Type | Purpose |
|-----------|------|---------|
| `ingest` | Job/CronJob | Monthly full snapshot ingestion |
| `publish-outbox` | Deployment | Continuous NATS event publisher (outbox pattern) |
| `backfill` | Job | Resumable backfill of active companies with rate limiting |
| `migrate` | Job | Alembic database migrations |
| `cleanup` | Job | Retention policy enforcement |

#### NATS Events Available

**Stream**: `BRAZIL_COMPANY_EVENTS`  
**Subjects**: `company.br.cnpj.*`

```
company.br.cnpj.discovered.v1        → New company detected
company.br.cnpj.updated.v1           → Company data changed
company.br.cnpj.reactivated.v1       → Inactive company reactivated
company.br.cnpj.inactivated.v1       → Active company became inactive
company.br.cnpj.snapshot.ready.v1    → Snapshot processing complete
company.br.cnpj.ingest.completed.v1  → Ingest job completed
company.br.cnpj.ingest.failed.v1     → Ingest job failed
```

**Delivery Guarantee**: At-least-once (24h duplicate window)  
**Schema**: JSON Schema in `contracts/company-*.schema.json`

#### Event Example Payload

```json
{
  "event_id": "uuid-v4",
  "event_version": 1,
  "timestamp": "2026-08-11T22:00:00Z",
  "aggregate_id": "CNPJ (base/branch)",
  "company": {
    "cnpj": "xx.xxx.xxx/xxxx-xx",
    "legal_name": "...",
    "trade_name": "...",
    "status": "ACTIVE",
    "opening_date": "2020-01-01",
    "main_cnae": "6201501",
    "state": "SP",
    "city": "São Paulo"
  }
}
```

### 1.2 PostgreSQL Infrastructure (Existing)

#### Current Schema

**Tables** (6 tables, used for ingestion pipeline metadata only):

1. `source_snapshots` — snapshot versions and status
2. `ingest_runs` — job execution history
3. `event_outbox` — NATS event staging (outbox pattern)
4. `backfill_runs` — backfill job tracking
5. `rejected_rows` — validation failures
6. `system_locks` — advisory locks for job coordination

**Note**: These tables contain **only pipeline metadata**, not business data.

#### Available Capacity

- Database: `cnpj` (PostgreSQL 16)
- User: `cnpj` (use same credentials for now)
- Empty namespace ready for **new SaaS schema** (users, organizations, prospects, etc.)

### 1.3 NATS JetStream (Available)

- **Endpoint**: `nats://nats:4222` (local docker-compose)
- **Stream**: `BRAZIL_COMPANY_EVENTS` (created, configured)
- **Duplicate Window**: 24 hours
- **Max Age**: 30 days (configurable)
- **All events**: Immediately available for subscription

### 1.4 Development Infrastructure

#### Docker Compose Services

```yaml
postgres:16      # Shared PostgreSQL instance
nats:2.10        # NATS JetStream (configured)
minio:latest     # Optional S3-compatible storage
```

All services are **health-checked** and production-configured.

#### Package Manager & Build Tools

- **Runtime**: Python 3.12 (existing)
- **Package Manager**: pip + hatchling (existing)
- **Linting**: ruff (strict, configured)
- **Type Checking**: mypy (strict mode, configured)
- **Testing**: pytest with markers (unit, integration, e2e, performance)
- **Formatting**: ruff format (automated)

#### Test Framework

```
tests/
├── unit/          → Fast, no external deps
├── integration/   → Requires PostgreSQL + NATS
├── e2e/           → Full pipeline tests
└── performance/   → Benchmarks
```

Existing CI/GitHub Actions already configured for:
- Linting (ruff check)
- Type checking (mypy)
- Unit tests
- Container build

### 1.5 Kubernetes Deployment (Helm)

**Chart Location**: `helm/cnpj-data-publisher`

Available Helm profiles:
- **values.yaml** — Generic Kubernetes
- **values-k3s.yaml** — k3s with embedded PostgreSQL/NATS

Can be reused for new service deployment.

---

## 2. What Is Missing (Product Layer)

The following **do not exist** and must be built:

### Frontend

- [ ] Next.js application
- [ ] React components
- [ ] Design system
- [ ] Landing page
- [ ] Auth UI (signup, login)
- [ ] Onboarding flow
- [ ] Discovery/search interface
- [ ] Company intelligence page
- [ ] List management UI
- [ ] Settings/billing UI

### Backend (Product API)

- [ ] Node.js/NestJS API skeleton
- [ ] GraphQL schema and resolvers
- [ ] Firebase authentication middleware
- [ ] Business-domain validation service
- [ ] Multi-tenancy enforcement
- [ ] Organization/workspace management
- [ ] Company search & ranking service
- [ ] ICP (Ideal Customer Profile) management
- [ ] Prospect list management
- [ ] AI integration (summaries, outreach, scoring)
- [ ] CSV export service
- [ ] Usage metering/events
- [ ] Billing/entitlements

### Databases

- [ ] PostgreSQL schema for SaaS state (users, orgs, prospects, etc.)
- [ ] MongoDB schema for transactional data (notes, tags, etc.) — optional, can use PostgreSQL instead

### Data Adapters

- [ ] Company intelligence adapter (will consume from MCP once available)
- [ ] Search adapter (will consume from MCP)
- [ ] Relationship adapter (Neo4j/graph queries via MCP)

### Infrastructure

- [ ] Docker images for web + API
- [ ] Helm charts for new services
- [ ] .env.example with SaaS secrets
- [ ] CI/CD pipeline extension

### Documentation

- [ ] Architecture decisions
- [ ] Tenancy model
- [ ] Security model
- [ ] AI guidelines
- [ ] Deployment runbook

---

## 3. Integration Points (Data Access)

### 3.1 What We Can Consume (When MCP Ready)

**Coming from MCP** (waiting for setup):

1. **Business Data** (read-only via MCP):
   - Company profiles (CNPJ, legal name, trade name, etc.)
   - Contact information (emails, phones, websites)
   - Company classification (industry, CNAE, size, etc.)
   - People/decision makers
   - Graph relationships
   - Embeddings/vector search results

2. **Smart Search** (via MCP):
   - Natural language query → structured results
   - Semantic search (vector-based)
   - Faceted filtering
   - Ranking signals

### 3.2 Real-Time Company Events (NATS)

Every new/updated/reactivated company is immediately available on NATS:

```python
# Pseudocode for consuming events
async def listen_for_company_updates():
    sub = await nats.subscribe("company.br.cnpj.*.v1")
    async for msg in sub.messages:
        event = json.loads(msg.data)
        # React to new company discovery
        # Update search indexes
        # Trigger recommendations
```

**Use Case**: Real-time prospect notifications, fresh search results.

### 3.3 PostgreSQL (Shared)

**Existing pipeline uses** for metadata only.  
**New SaaS layer will use** for customer data:

```sql
-- New tables (to be created in next milestone)
users
organizations
memberships
icps
saved_companies
prospect_lists
prospect_list_items
prospect_notes
prospect_tags
subscriptions
usage_events
audit_logs
```

**Important**: Both layers use the same PostgreSQL instance but **isolated schemas/tables**. No data mixing.

---

## 4. Technology Stack Decisions

### Confirmed (From Existing Code)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Ingestion Pipeline | Python 3.12 | Mature, tested, keep as-is |
| Database | PostgreSQL 16 | Shared instance, separate schemas |
| Events | NATS JetStream | Immutable contracts |
| Testing | pytest + testcontainers | Strong foundation |
| CI | GitHub Actions | Existing workflow |
| Deployment | Helm + Kubernetes | k3s support via values-k3s.yaml |
| Linting | ruff | Very fast |
| Type Checking | mypy (strict) | Production grade |

### Recommended (For New Product Layer)

| Layer | Technology | Rationale |
|-------|-----------|----------|
| Frontend | Next.js 14 + React 18 | Premium B2B SaaS standard |
| Styling | Tailwind CSS | Fast, composable |
| UI Components | shadcn/ui | Accessible, typesafe, customizable |
| State | TanStack Query + Zustand | Proven in enterprise products |
| Forms | React Hook Form + Zod | Minimal bundle, excellent DX |
| Backend | NestJS | TypeScript, modular, testable |
| GraphQL | Apollo Server | Type-safe, well-integrated |
| ORM | Prisma | Strong for multi-tenant SaaS |
| Auth | Firebase Authentication | Business domain enforcement, secure |
| AI | LiteLLM (existing gateway) | Model-agnostic, rate limiting |
| Observability | Structured logs + Prometheus | Match existing pipeline metrics |

---

## 5. Reusable Patterns from Existing Code

### From Python Pipeline

✅ **Structured Logging Pattern**
```python
# Use existing structlog setup in new backend
logger.info("event", event_type="PROSPECT_SAVED", org_id=org_id)
```

✅ **Configuration Management**
```python
# Use Pydantic Settings pattern for backend config
class AppSettings(BaseSettings):
    database_url: str
    firebase_key: str
```

✅ **Observability (Prometheus metrics)**
```python
# Track business events alongside system metrics
companies_discovered = Counter(...)
prospects_saved = Counter(...)
```

✅ **Alembic Migrations**
```python
# Reuse Alembic for new SaaS schema
# Create migrations alongside existing ones
```

✅ **Health/Readiness Endpoints**
```python
# Existing pattern: /healthz and /readyz
# Apply to new API services
```

✅ **Docker Multi-Stage Builds**
```dockerfile
# Existing Dockerfile shows best practices
# Reuse pattern for web + API images
```

---

## 6. No Breaking Changes Required

**Critical**: The existing ingestion pipeline is **production data**. Do NOT:

- ✗ Modify existing tables (source_snapshots, ingest_runs, etc.)
- ✗ Change NATS contracts
- ✗ Refactor pipeline code unless absolutely necessary
- ✗ Duplicate PostgreSQL/NATS without strong reason

**Approach**: Add new schema/tables, consume NATS events read-only.

---

## 7. Architecture Diagram (Target)

```
┌─────────────────────────────────────────────────────────────┐
│                    PRODUCT LAYER (NEW)                      │
│  ┌──────────────────┐          ┌──────────────────┐         │
│  │   Next.js Web    │ ◄──────► │   NestJS API     │         │
│  │  (React + TS)    │ (GraphQL)│  (Product Layer) │         │
│  └──────────────────┘          └──────────────────┘         │
│                                        │                     │
│              ┌──────────────────────────┼──────────────────┐ │
│              │                          │                  │ │
│              ▼                          ▼                  ▼ │
│   ┌──────────────────┐      ┌──────────────────┐  ┌─────────┐│
│   │  Org/Users/     │      │  SaaS Config     │  │ Audit   ││
│   │  Prospects      │      │  Billing/Usage   │  │ Logs    ││
│   │  (PostgreSQL)   │      │  (PostgreSQL)    │  │(PG/Mongo)││
│   └──────────────────┘      └──────────────────┘  └─────────┘│
└─────────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
┌──────────────────┐  ┌─────────────┐  ┌──────────────────┐
│  Company Data    │  │ NATS Events │  │  LiteLLM Gateway │
│  (via MCP) ◄────┤  │  (Subscribe)│  │  (AI Services)   │
└──────────────────┘  └─────────────┘  └──────────────────┘
         ▲                   ▲                  ▲
         │                   │                  │
    ┌────────────────────────────────────────────────┐
    │      INTELLIGENCE LAYER (Existing Pipeline)   │
    ├────────────────────────────────────────────────┤
    │  Ingestion, Enrichment, Embeddings, Search    │
    └────────────────────────────────────────────────┘
```

---

## 8. Immediate Next Steps (Milestone 1)

### 8.1 Project Structure

Create new monorepo:
```
cnpj-data-publisher/
├── src/cnpj_data_publisher/     ← Keep existing pipeline
├── apps/
│   ├── web/                      ← New: Next.js SaaS frontend
│   └── api/                      ← New: NestJS backend
├── packages/
│   ├── contracts/                ← Shared types + API contracts
│   ├── config/                   ← Shared configuration
│   ├── domain/                   ← Business logic, no framework
│   └── auth/                     ← Firebase helpers
├── infra/
│   ├── docker/                   ← New Dockerfiles
│   └── helm/                     ← New Helm values
├── docs/
│   ├── architecture/
│   ├── security/
│   ├── ai/
│   └── product/
└── docker-compose.yml            ← Add MongoDB, extend PostgreSQL
```

### 8.2 Technology Setup

```bash
# Frontend (Next.js)
pnpm create next-app@latest apps/web --ts --tailwind --eslint

# Backend (NestJS)
npm i -g @nestjs/cli
nest new apps/api --package-manager pnpm

# Shared packages
mkdir -p packages/{contracts,config,domain,auth}
```

### 8.3 Database Migrations

New migration file:
```
migrations/versions/0002_saas_schema.py
```

Will create:
- users
- organizations
- memberships
- icps
- etc.

---

## 9. Known Secrets & Configuration

**To Collect Before Milestone 1**:

```env
# Firebase (for Auth)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
FIREBASE_ADMIN_KEY=

# LiteLLM (existing gateway, used by pipeline)
LITELLM_BASE_URL=
LITELLM_API_KEY=

# Neo4j (for relationship queries via MCP)
NEO4J_URI=
NEO4J_USER=
NEO4J_PASSWORD=

# Qdrant (for semantic search via MCP)
QDRANT_URL=
QDRANT_API_KEY=

# MongoDB (optional, for transactional data)
MONGODB_URL=

# Billing (when ready)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
```

---

## 10. Success Criteria for Milestone 0

- [x] Existing pipeline infrastructure mapped
- [x] NATS event contracts understood
- [x] PostgreSQL schema boundaries identified
- [x] No integration gaps blocking product development
- [x] Monorepo structure planned
- [x] Technology stack validated against existing conventions
- [x] Document created for team reference

---

## Conclusion

**The foundation is solid.** The ingestion pipeline is production-grade and the infrastructure (NATS, PostgreSQL, Kubernetes, Docker) is mature.

The product layer is built cleanly on top without any breaking changes. All data access flows through defined interfaces (MCP for business data, NATS for events, PostgreSQL for SaaS state).

**Ready to proceed to Milestone 1: Product Foundation.**
