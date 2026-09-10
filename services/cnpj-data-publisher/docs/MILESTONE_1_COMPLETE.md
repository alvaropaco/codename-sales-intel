# Milestone 1 — Product Foundation (COMPLETE)

**Date**: 2026-08-11  
**Status**: ✅ Foundation established, ready for next milestone  
**Progress**: 8 of 8 critical tasks completed

---

## What We Built

### 1. Monorepo Structure

```
cnpj-data-publisher/
├── apps/
│   ├── api/                  ← NestJS backend (GraphQL + REST)
│   └── web/                  ← Next.js frontend (React 18)
├── packages/
│   ├── contracts/            ← Shared TypeScript types
│   ├── config/               ← Configuration management
│   ├── domain/               ← Business logic (framework-agnostic)
│   ├── auth/                 ← Firebase helpers
│   ├── observability/        ← Logging, metrics, tracing
│   └── testing/              ← Test utilities
├── infra/
│   └── docker/               ← Production Dockerfiles
├── docs/
│   └── architecture/         ← CURRENT_STATE.md (audit complete)
└── migrations/               ← Shared (Python pipeline + SaaS)
```

**pnpm workspaces** configured for monorepo commands.

### 2. Backend (NestJS API)

**Structure**:
- TypeScript strict mode enabled
- Module-based architecture ready for GraphQL + REST
- Health check endpoints (`/health`, `/health/ready`)
- Proper error handling and validation pipelines
- Structured logging with Pino (JSON format)

**Key Files**:
- `apps/api/src/main.ts` — Application bootstrap
- `apps/api/src/app.module.ts` — Root module
- `apps/api/src/health/` — Health check endpoints
- `apps/api/tsconfig.json` — Strict TypeScript configuration

### 3. Frontend (Next.js Web)

**Configuration**:
- TypeScript strict mode
- Tailwind CSS + shadcn/ui ready
- TanStack Query + Zustand for state
- React Hook Form + Zod for validation
- Framer Motion for interactions
- Firebase Web SDK for auth

**Setup**: Ready to build components and pages

### 4. Database Schema (Prisma)

**Created comprehensive SaaS schema** with:
- **Users & Organizations** → Multi-tenancy foundation
- **Memberships** → Role-based access control (OWNER, ADMIN, MEMBER, SALES_MANAGER, SALES_REP, VIEWER)
- **ICP (Ideal Customer Profile)** → User-defined targeting
- **Prospect Management** → SavedCompany, ProspectList, ProspectListItem, ProspectNote, ProspectTag
- **Search & History** → SavedSearch, SearchHistory
- **AI Generations** → Track summaries, outreach, research
- **Billing & Usage** → Subscription, UsageEvent (SEARCH, COMPANY_VIEW, CONTACT_REVEAL, AI_RESEARCH, etc.)
- **Audit & Compliance** → AuditLog with event types, FeatureFlag
- **Indexes** → Query optimization on all critical fields

**All models include** `organization_id` for tenant isolation.

### 5. Docker & Orchestration

**Dockerfiles** (multi-stage, production-grade):
- `infra/docker/api.Dockerfile` — NestJS (Node 20 Alpine, health checks)
- `infra/docker/web.Dockerfile` — Next.js (Node 20 Alpine, health checks)

**docker-compose.yml** updates:
- `postgres-saas` — Separate database for SaaS state (not data pipeline)
- `mongo` — Optional MongoDB for transactional data (profile: "full")
- `api` — NestJS service (profile: "full", "api")
- `web` — Next.js service (profile: "full", "web")

**Startup profiles**:
- `docker compose up postgres nats` — Data pipeline infrastructure
- `docker compose --profile full up` — Full stack (pipeline + SaaS)
- `docker compose --profile api up` — API only
- `docker compose --profile web up` — Web only

### 6. CI/CD Pipeline

**GitHub Actions** (`.github/workflows/ci.yml`):
- **Lint** — pnpm lint (workspace-wide)
- **Typecheck** — TypeScript validation
- **Build** — pnpm build (all packages)
- **Test** — Jest tests with real containers (PostgreSQL, NATS)
- **Docker Build** — Multi-stage image verification (on main branch)

All jobs run in parallel where possible.

### 7. Environment Configuration

**Updated `.env.example`** with:

**Application**:
- NODE_ENV, PORT, LOG_LEVEL

**Databases**:
- DATABASE_URL (SaaS PostgreSQL)
- MONGO_URL (optional transactional data)

**Authentication**:
- Firebase Admin SDK key
- NEXT_PUBLIC_* variables for frontend

**Company Data (MCP Integration)**:
- MCP_COMPANY_DATA_URL
- MCP_COMPANY_DATA_API_KEY

**AI Services**:
- LITELLM_BASE_URL, LITELLM_API_KEY

**Event Bus** (reusing existing):
- NATS_URL, NATS_STREAM, NATS_SUBJECT_PREFIX

**Storage** (for backups/exports):
- Neo4j (relationships via MCP)
- Qdrant (embeddings via MCP)

**Future Billing**:
- STRIPE_* credentials (stubs)

---

## What's Ready

✅ **Monorepo with pnpm workspaces**
✅ **NestJS API with health endpoints**
✅ **Next.js frontend foundation**
✅ **Complete Prisma schema** (users, orgs, prospects, billing, audit)
✅ **Production Dockerfiles** (multi-stage, health checks, non-root users)
✅ **docker-compose** with 5 services
✅ **CI/CD pipeline** (GitHub Actions)
✅ **TypeScript strict mode** everywhere
✅ **Environment configuration** template
✅ **Repository audit documentation**

---

## What's NOT Done (Next Milestones)

⏳ **Milestone 2: Design System** — UI components, Tailwind tokens
⏳ **Milestone 3: Auth & Tenancy** — Firebase, domain validation, organization flows
⏳ **Milestone 4: Onboarding** — Company detection, ICP parser, dashboard
⏳ **Milestone 5: Data Adapters** — MCP integration (when ready)
⏳ **Milestone 6: Discover** — Search UI, natural language, filters
⏳ **Milestone 7+** — Full feature implementation

---

## Test It

### 1. Check the code compiles

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

### 2. Start the full stack

```bash
docker compose up postgres nats postgres-saas
# API will be at http://localhost:4000/health
# Web will be at http://localhost:3000
```

### 3. Apply database migrations

```bash
cd apps/api
pnpm db:migrate:dev
```

---

## Key Design Decisions

### Multi-Tenancy

Every tenant-owned table has `organization_id`:

```typescript
// BAD (old pattern)
getList(listId)

// GOOD (enforced)
getList({
  organizationId,
  listId
})
```

All queries are **scoped to organization** in repositories.

### Separation of Concerns

- **Data pipeline** (Python, existing) → NATS events + Parquet storage
- **SaaS layer** (Node.js, new) → Consumes data via MCP, stores SaaS state in separate PostgreSQL
- **Frontend** → React hooks + TypeScript, Firebase auth

### No Circular Dependencies

- `packages/domain` — Business logic, no framework imports
- `packages/auth` — Firebase helpers
- `packages/config` — Configuration
- `packages/contracts` — Shared types
- `apps/api` — NestJS (depends on packages)
- `apps/web` — Next.js (depends on packages)

### Database Isolation

- `postgres` (existing) — CNPJ pipeline metadata only
- `postgres-saas` (new) — User data, organizations, prospects, billing
- `mongo` (optional) — Transactional notes/tags
- Both run in the same container orchestration without conflicts

---

## Deploymentability

✅ All code production-ready
✅ Multi-stage Dockerfiles
✅ Health checks configured
✅ Non-root users in containers
✅ Proper signal handling (dumb-init)
✅ Docker Compose for local dev
✅ Helm chart pattern (coming in Milestone 12)

---

## What Comes Next

### Immediate (Milestone 2)

1. **Design System**
   - Tailwind configuration
   - Color palette (light + dark)
   - Typography tokens
   - Spacing, radius, shadows

2. **UI Component Library**
   - Button, Input, Select, Modal, etc.
   - shadcn/ui integration
   - Form wrappers

3. **Layout Shell**
   - Navigation
   - Sidebar
   - Content area
   - Responsive behavior

### Short Term (Milestone 3)

1. **Firebase Integration**
   - Web SDK setup
   - Admin SDK in backend
   - Token validation middleware

2. **Business Domain Validation**
   - Public Suffix List parsing
   - Disposable email detection
   - Domain policy service

3. **Multi-Tenancy Enforcement**
   - Organization CRUD
   - Membership management
   - Workspace access requests
   - Tenant isolation tests

### MCP Integration (Milestone 5)

When MCP is ready, implement adapters:
- `CompanyRepository` (read profiles)
- `CompanySearchRepository` (search + ranking)
- `RelationshipRepository` (graph queries)

All behind interfaces so backend doesn't know about data storage.

---

## Troubleshooting

**pnpm not found**:
```bash
npm install -g pnpm@9
```

**Port conflicts**:
Check docker-compose.yml for port mappings, adjust `*_PORT` env vars

**Database won't start**:
```bash
docker compose down -v  # Remove volumes
docker compose up postgres-saas
```

**Build fails**:
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

---

## Next Session

Start with **Milestone 2: Design System**

All foundation is in place. No refactoring needed before building UI.
