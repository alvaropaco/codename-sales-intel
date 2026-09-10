# Brazilian B2B Sales Intelligence SaaS
## E2E MVP Implementation Specification

> **Purpose:** Build a production-ready, sellable B2B SaaS product on top of the company data that has already been ingested, processed, enriched, embedded, indexed, and deployed in the existing VPS cluster.
>
> **Core principle:** Do **not** build a technical data browser. Build a business product that helps users **find, understand, qualify, save, and contact Brazilian companies** for legitimate B2B sales and commercial prospecting.

---

# 1. Agent Mission

You are responsible for implementing this product **end-to-end**, from project foundation to a deployable MVP.

Work autonomously and iteratively.

Do not stop after scaffolding.

Do not implement mocks where the existing data infrastructure can be integrated.

Do not rebuild the ingestion pipeline unless an adapter is required.

The ingestion/data pipeline is already complete and the processed data is already available in the VPS cluster.

Your scope starts at the **Product / SaaS Layer**.

The final product must be:

- production-oriented;
- multi-tenant;
- secure;
- business-oriented;
- visually premium;
- usable by non-technical users;
- deployable to the existing VPS/Kubernetes environment;
- observable;
- testable;
- monetizable;
- ready for real customer onboarding.

---

# 2. Product Vision

Build a Brazilian B2B Sales Intelligence platform.

The user-facing value proposition is:

> **Find the right Brazilian companies, understand them in seconds, qualify them against your ICP, and turn them into sales opportunities.**

The product flow must be:

```text
Discover
   ↓
Research
   ↓
Qualify
   ↓
Save
   ↓
Contact
```

The user must not need to understand:

- embeddings;
- vector databases;
- Neo4j;
- crawlers;
- Receita Federal ingestion;
- ETL;
- pipelines;
- event buses;
- Kubernetes;
- data enrichment internals.

Those are implementation details.

---

# 3. Product Positioning

The UI and product language must be inspired by premium B2B SaaS products such as:

- Artisan;
- Clay;
- Attio;
- Linear;
- Stripe.

Do **not** copy any product literally.

The experience should feel like a modern revenue/sales platform.

Avoid the visual language of:

- Shodan;
- Neo4j Browser;
- Grafana;
- Maltego;
- hacker dashboards;
- infrastructure tooling;
- developer consoles.

---

# 4. Primary User

Initial target user:

- Brazilian B2B company;
- founder;
- salesperson;
- SDR;
- sales manager;
- agency;
- consultancy;
- software company;
- service provider;
- business-development team.

Primary job to be done:

> "I want to find Brazilian companies that may buy what I sell, understand them quickly, identify useful commercial information, and organize them into a prospecting workflow."

---

# 5. MVP Scope

The MVP must include:

1. Authentication;
2. business-domain signup enforcement;
3. multi-tenancy;
4. organization/workspace onboarding;
5. company discovery/search;
6. natural-language prospect search;
7. structured filtering;
8. company intelligence pages;
9. business-contact data;
10. source/confidence metadata;
11. AI company summaries;
12. ICP definition;
13. fit scoring;
14. saved prospects;
15. prospect lists;
16. notes and tags;
17. lightweight pipeline status;
18. AI-generated outreach;
19. CSV export;
20. usage metering;
21. billing-ready architecture;
22. admin/support foundation;
23. audit logs;
24. production observability;
25. deployment manifests;
26. automated testing.

---

# 6. Explicit Non-Goals for MVP

Do **not** implement these unless all MVP requirements are already complete:

- full CRM;
- email-delivery infrastructure;
- email warmup;
- autonomous email campaigns;
- LinkedIn automation;
- WhatsApp automation;
- browser agents;
- scraping infrastructure;
- 3D graph globe;
- mobile applications;
- workflow builder;
- marketing automation engine;
- large integration marketplace;
- complicated dashboards;
- predictive revenue forecasting.

The MVP should validate this question:

> **Will customers pay to find, understand, qualify, and contact Brazilian B2B prospects using our data?**

---

# 7. Existing Infrastructure

Assume the following already exists in the VPS cluster or surrounding platform:

- processed Brazilian company data;
- indexed company/search data;
- embeddings;
- vector search;
- graph relationships;
- enriched company information;
- Kubernetes/k3s cluster;
- persistent storage;
- secrets infrastructure;
- LiteLLM or equivalent LLM gateway;
- existing databases used by the ingestion/intelligence system.

Potential existing services may include:

- Neo4j;
- Qdrant;
- PostgreSQL;
- MongoDB;
- Redis;
- LiteLLM;
- Infisical;
- SearXNG;
- other internal services.

Before implementing adapters:

1. inspect the repository;
2. inspect deployment manifests;
3. inspect environment variables;
4. inspect existing schemas;
5. identify existing query interfaces;
6. identify existing service endpoints;
7. reuse what is already available.

Do not duplicate infrastructure without a strong reason.

---

# 8. Target Architecture

Use three explicit architectural layers.

```text
┌────────────────────────────────────────────┐
│               PRODUCT LAYER                │
│ UI / Workspaces / Lists / Billing / SaaS   │
├────────────────────────────────────────────┤
│            INTELLIGENCE LAYER              │
│ Search / Ranking / AI / Enrichment Access  │
├────────────────────────────────────────────┤
│                 DATA LAYER                 │
│ Existing CNPJ / Graph / Vector / Datasets  │
└────────────────────────────────────────────┘
```

Recommended runtime architecture:

```text
                         ┌─────────────────┐
                         │     Next.js     │
                         │   SaaS Web UI   │
                         └────────┬────────┘
                                  │
                          Firebase Auth
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   Product API   │
                         │ GraphQL + HTTP  │
                         └────────┬────────┘
                                  │
             ┌────────────────────┼─────────────────────┐
             │                    │                     │
             ▼                    ▼                     ▼
       SaaS PostgreSQL      Search Adapter         AI Service
             │                    │                     │
             │             Existing indexes        LiteLLM
             │                    │                     │
             └────────────┬───────┴──────────┬──────────┘
                          ▼                  ▼
                       Neo4j              Qdrant
                          \                /
                           Existing Data Platform
```

---

# 9. Recommended Technology Stack

Use existing project conventions if equivalent technologies already exist.

Otherwise use:

## Frontend

- Next.js;
- React;
- TypeScript;
- Tailwind CSS;
- shadcn/ui;
- TanStack Query;
- React Hook Form;
- Zod;
- Firebase Web SDK;
- Framer Motion only for subtle interactions;
- Recharts only where charts add business value.

## Backend

Preferred:

- Node.js;
- TypeScript;
- NestJS;
- GraphQL;
- REST only where appropriate;
- Zod and/or class-validator for validation;
- PostgreSQL for SaaS state;
- Prisma or existing preferred ORM.

## Authentication

- Firebase Authentication;
- Firebase Admin SDK on backend.

## AI

- existing LiteLLM gateway;
- structured outputs;
- provider/model configuration through environment/config;
- no model vendor hardcoded into business logic.

## Infrastructure

- Docker;
- Helm charts;
- Kubernetes/k3s;
- Infisical or existing secret manager;
- existing ingress and TLS solution.

---

# 10. Repository Structure

Prefer a monorepo unless the existing repository architecture strongly suggests otherwise.

Suggested structure:

```text
apps/
  web/
  api/

packages/
  ui/
  contracts/
  auth/
  config/
  domain/
  observability/
  testing/

infra/
  docker/
  helm/
  scripts/

docs/
  architecture/
  product/
  api/
  runbooks/
```

Keep boundaries explicit.

---

# 11. Authentication Requirements

Use Firebase Authentication.

Users must only be allowed to register using a **business-owned email domain**.

Examples:

```text
john@gmail.com          -> REJECT
john@hotmail.com        -> REJECT
john@outlook.com        -> REJECT
john@yahoo.com          -> REJECT
john@icloud.com         -> REJECT

john@acme.com.br        -> ACCEPT
john@0x-ai.com          -> ACCEPT
john@company.com        -> ACCEPT
```

Important:

A company may use Google Workspace or Microsoft 365.

Do **not** reject business domains because their MX records point to Google or Microsoft.

We validate the actual email domain, not the hosting provider.

---

# 12. Domain Policy Service

Implement a reusable:

```text
DomainPolicyService
```

Responsibilities:

- normalize email;
- extract registrable domain;
- handle public suffixes correctly;
- reject generic/public email domains;
- reject known disposable email domains;
- maintain an allow/deny strategy;
- expose reason codes;
- log policy decisions;
- support future organization-domain verification.

Do not parse domains with naive string splitting.

Use a Public Suffix List-compatible library.

Suggested result:

```ts
type DomainPolicyResult = {
  allowed: boolean;
  emailDomain: string;
  registrableDomain: string;
  reason:
    | "BUSINESS_DOMAIN"
    | "PUBLIC_EMAIL_PROVIDER"
    | "DISPOSABLE_EMAIL_PROVIDER"
    | "INVALID_DOMAIN"
    | "BLOCKED_DOMAIN";
};
```

---

# 13. Firebase Enforcement

Do not enforce the restriction only in the frontend.

Server-side/back-end enforcement is mandatory.

Use Firebase-supported blocking/auth hooks where available in the chosen Firebase configuration.

At minimum enforce:

```text
email exists
domain is valid
domain is allowed
account is active
```

Backend requests must:

1. receive Firebase ID token;
2. validate with Firebase Admin SDK;
3. resolve internal user;
4. resolve organization membership;
5. enforce tenant permissions;
6. continue request only if authorized.

Never trust client-supplied:

```text
user_id
organization_id
role
```

without deriving/validating them server-side.

---

# 14. Organization / Workspace Model

The SaaS is organization-centric.

Core relationship:

```text
User
  ↓
Membership
  ↓
Organization
```

Initial roles:

```text
OWNER
ADMIN
MEMBER
```

Architecture must allow later roles:

```text
SALES_MANAGER
SALES_REP
VIEWER
```

All customer-owned entities must include:

```text
organization_id
```

Tenant isolation must be enforced in backend repositories/services.

---

# 15. Signup / Workspace Flow

## New Domain

```text
signup
  ↓
business-domain validation
  ↓
Firebase account
  ↓
email verification
  ↓
lookup organization by registrable domain
  ↓
organization not found
  ↓
create organization
  ↓
create OWNER membership
  ↓
onboarding
```

## Existing Domain

```text
signup
  ↓
domain validation
  ↓
Firebase account
  ↓
email verification
  ↓
organization exists
  ↓
create pending access request
  ↓
OWNER/ADMIN approval
```

Do not automatically expose workspace data to anyone who happens to have the same corporate domain.

---

# 16. Onboarding Experience

The onboarding must immediately demonstrate value.

## Step 1 — Detect User Company

After signup, attempt to identify the user's organization using the email domain.

Show:

```text
We found your company

ACME Tecnologia Ltda
CNPJ: xx.xxx.xxx/xxxx-xx
São Paulo, SP

[This is my company]
[Search another company]
```

## Step 2 — What do you sell?

Ask:

> Describe your product or service.

Example:

```text
We develop custom AI systems for medium-sized Brazilian companies.
```

## Step 3 — Ideal Customer Profile

Ask:

> Describe your ideal customer.

Convert free text into structured ICP attributes.

Example:

```json
{
  "industries": ["logistics", "retail", "financial services"],
  "states": ["SP", "MG", "PR"],
  "companySize": ["small", "medium"],
  "keywords": ["automation", "software", "technology"],
  "exclusions": []
}
```

## Step 4 — Immediate Value

Show:

```text
We found 2,418 companies that match your ICP.
```

Then show recommended prospects.

The first session must not lead to an empty dashboard.

---

# 17. Core Navigation

MVP navigation:

```text
Home
Discover
Companies
Lists
Assistant
```

Bottom-level navigation:

```text
Workspace
Billing
Settings
```

Do not add unnecessary modules.

---

# 18. Dashboard / Home

Purpose:

- orient user;
- make discovery immediately accessible;
- show actionable recommendations.

Suggested structure:

```text
Good morning, <name>

Find your next customer
┌──────────────────────────────────────────────┐
│ Describe the companies you're looking for   │
└──────────────────────────────────────────────┘

ICP matches                  2,418
High-fit prospects             237
Saved prospects                183
New matches this week           42

Recommended prospects
...
```

Avoid meaningless vanity charts.

Every dashboard element must support a sales action.

---

# 19. Discover

Discover is the highest-priority screen.

Support:

- natural-language search;
- structured filters;
- filter chips;
- sorting;
- pagination/infinite loading;
- saved searches;
- bulk selection;
- fit score;
- company preview;
- list insertion;
- CSV export where allowed.

Search examples:

```text
Software companies in São Paulo

Coffee exporters in Minas Gerais

Logistics companies in Campinas

Companies founded in the last three years in construction

Accounting firms around São José dos Campos
```

---

# 20. Search Architecture

Use deterministic structured filtering whenever possible.

Natural language must first be interpreted into a structured query.

Example:

```json
{
  "status": "ACTIVE",
  "state": "SP",
  "industry": ["software"],
  "foundedAfter": "2023-01-01"
}
```

Then execute using existing indexes/databases.

Recommended pipeline:

```text
User prompt
  ↓
Query Interpreter
  ↓
Validated Search DSL
  ↓
Structured filters
  +
Semantic search where useful
  +
Graph relationships where useful
  ↓
Ranking
  ↓
Results
```

The LLM must not directly generate arbitrary database queries.

Create an internal Search DSL.

Example:

```ts
type CompanySearchInput = {
  text?: string;
  industries?: string[];
  cnaes?: string[];
  states?: string[];
  cities?: string[];
  status?: string[];
  foundedAfter?: string;
  foundedBefore?: string;
  companySize?: string[];
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  minFitScore?: number;
  page?: number;
  pageSize?: number;
  sort?: CompanySort;
};
```

---

# 21. Search Results

Do not present results as raw Receita Federal records.

Each company should look like a sales prospect.

Example:

```text
ACME Tecnologia

Software • São Paulo, SP
Active since 2018

Company size      Medium
Primary industry  Software
Website           acme.com.br
Phone             Available
Email             Available

92 Fit

Why it matches
✓ Correct industry
✓ Preferred region
✓ Strong digital presence

[View] [Save] [Add to list]
```

Support bulk actions:

```text
Add to list
Export
Generate outreach
```

---

# 22. Company Intelligence Page

The company page is the centerpiece of the product.

Suggested top section:

```text
ACME Tecnologia Ltda                           92 Fit
acme.com.br • São Paulo • Software

[Save] [Add to List] [Generate Message] [Export]
```

Required sections:

## Executive Summary

Short AI-generated business summary.

## Company

- CNPJ;
- legal name;
- trade name;
- active status;
- opening date;
- legal nature;
- share capital;
- CNAEs;
- address;
- estimated company-size classification where supported.

## Contact

- website;
- domain;
- emails;
- phones;
- LinkedIn;
- other business social profiles.

## People / Decision Makers

Only where legitimate data exists.

- name;
- business role;
- partner/administrator relationship;
- professional contact metadata;
- LinkedIn where available.

## Business Connections

Expose relevant graph relationships in business language.

Avoid the name "Graph Explorer".

Examples:

- partners;
- related organizations;
- shared administrators;
- ownership relationships.

## Intelligence

- fit score;
- why it matches;
- opportunities;
- talking points;
- suggested approach;
- AI research summary.

## Sources

Show provenance and freshness where possible.

---

# 23. Data Provenance

Trust is essential.

For material fields, maintain:

```text
source
source_url
collected_at
verified_at
confidence
pipeline_version
```

UI example:

```text
contato@empresa.com.br

Source: Company website
Confidence: High
Verified: 3 days ago
```

Create a reusable `SourceBadge`.

---

# 24. ICP Model

Each organization should have one initial default ICP.

Suggested schema:

```text
ICP
- id
- organization_id
- name
- description
- industries
- cnaes
- states
- cities
- company_sizes
- keywords
- exclusions
- created_at
- updated_at
```

Allow user to edit it after onboarding.

---

# 25. Fit Score

Implement a deterministic fit score.

Do not let the LLM invent the number.

Example weighting:

```text
industry match            30%
geography                 20%
company profile           20%
ICP keywords              15%
digital presence          10%
additional signals         5%
```

Normalize into:

```text
0-100
```

Suggested labels:

```text
90-100  Excellent Fit
75-89   Strong Fit
60-74   Potential Fit
0-59    Low Fit
```

LLM may explain the score, but the numerical calculation must remain deterministic and inspectable.

Store scoring version.

---

# 26. Lists

Users must be able to create prospect lists.

Example:

```text
São Paulo SaaS Leads
Coffee Exporters
Q4 AI Prospects
Follow Up
```

Required capabilities:

- create;
- rename;
- delete/archive;
- add company;
- remove company;
- bulk add;
- filter;
- sort;
- export;
- tags;
- notes;
- status.

Suggested prospect statuses:

```text
NEW
RESEARCHING
CONTACTED
INTERESTED
MEETING
WON
LOST
```

This is a lightweight sales workflow, not a full CRM.

---

# 27. Notes and Tags

Users must be able to attach organization-private metadata to a company/prospect.

Examples:

```text
"Met CEO at event."
"Potential customer for AI automation."
"Call next month."
```

Tags:

```text
priority
AI
São Paulo
follow-up
event-lead
```

All notes/tags are tenant-private.

---

# 28. AI Capabilities

Use narrow, explicit AI capabilities.

Do not create one giant autonomous agent for all operations.

Implement:

## Query Interpreter

```text
natural language -> validated Search DSL
```

## Company Summarizer

```text
company context -> executive business summary
```

## Fit Explanation

```text
deterministic score + company + ICP -> human explanation
```

## Research Assistant

```text
company context -> sales insights
```

## Outreach Generator

```text
user company + ICP + target company -> personalized outreach
```

## Sales Assistant

Conversational layer that orchestrates safe product actions.

Example:

```text
Find logistics companies in Campinas and save the 20 best matches.
```

The assistant should:

1. parse intent;
2. execute search;
3. show preview;
4. request confirmation for consequential bulk actions when needed;
5. save to list.

---

# 29. Outreach Generator

For MVP, only generate content.

Do not automatically send messages.

Support:

- email;
- LinkedIn;
- WhatsApp;
- call script.

Inputs should include:

- user's organization;
- user's product/service;
- ICP;
- target company;
- known signals;
- target contact where applicable;
- selected tone.

Outputs should be editable.

Avoid fabricated claims.

Never claim the target has a fact unless it exists in provided intelligence.

---

# 30. SaaS Database

Use PostgreSQL for customer/SaaS state.

Suggested tables:

```text
users
organizations
organization_domains
memberships
workspace_access_requests

icps

saved_companies
prospect_lists
prospect_list_items
prospect_notes
prospect_tags

saved_searches
search_history

ai_generations

subscriptions
plans
usage_events
credit_balances

audit_logs
feature_flags
```

Do not copy the complete global intelligence dataset into the SaaS database.

Store references to global company IDs where possible.

---

# 31. Multi-Tenancy Guardrails

Every tenant-owned table must contain:

```text
organization_id
```

Repository/service methods should require tenant context.

Bad:

```ts
getList(listId)
```

Good:

```ts
getList({
  organizationId,
  listId
})
```

Every update/delete must include tenant scoping.

Add integration tests specifically attempting cross-tenant access.

Cross-tenant data leakage is a release blocker.

---

# 32. Product API

Prefer GraphQL for application data aggregation.

Use REST for:

- health checks;
- webhooks;
- file exports;
- provider callbacks;
- operational endpoints where REST is simpler.

Suggested GraphQL domains:

```text
viewer
organization
company
companies
searchCompanies
lists
prospects
icp
usage
subscription
assistant
```

Example:

```graphql
query Company($id: ID!) {
  company(id: $id) {
    id
    name
    legalName
    cnpj
    domain

    profile {
      industry
      location
      description
    }

    contacts {
      emails {
        value
        confidence
        source
      }
      phones {
        value
        confidence
        source
      }
    }

    people {
      name
      role
    }

    relationships {
      type
      entityName
    }

    intelligence {
      summary
      fitScore
      fitLabel
      fitReasons
      talkingPoints
    }
  }
}
```

---

# 33. Data Adapter Layer

The Product API must not directly scatter Neo4j/Qdrant/database-specific queries throughout business services.

Create adapters/interfaces such as:

```text
CompanyRepository
CompanySearchRepository
RelationshipRepository
SemanticSearchRepository
CompanyIntelligenceRepository
```

Example:

```ts
interface CompanySearchRepository {
  search(
    input: CompanySearchInput
  ): Promise<CompanySearchResult>;
}
```

Adapters can internally use:

- Neo4j;
- Qdrant;
- PostgreSQL;
- MongoDB;
- internal services;
- other existing indexes.

Business logic must depend on interfaces, not storage implementation.

---

# 34. Search Result Ranking

Use a composite ranking approach.

Possible components:

```text
structured relevance
semantic similarity
ICP fit
data completeness
contact availability
freshness
business signals
```

Keep scoring inspectable.

Avoid opaque LLM-only ranking.

---

# 35. Usage Metering

Instrument billable actions from day one.

Potential usage events:

```text
SEARCH
COMPANY_VIEW
CONTACT_REVEAL
AI_RESEARCH
AI_OUTREACH
EXPORT
API_REQUEST
```

Store:

```text
organization_id
user_id
event_type
quantity
metadata
timestamp
```

Billing can initially operate in shadow mode.

Usage should still be measured before payment launch.

---

# 36. Plans / Billing Model

Architecture should support:

## Starter

- low seat count;
- limited views/reveals;
- AI research;
- lists.

## Growth

- more users;
- higher limits;
- exports;
- advanced filters;
- AI outreach.

## Business

- larger teams;
- API access;
- larger exports;
- integrations;
- enterprise controls.

Do not block product launch on perfect pricing.

Make plans configurable in database/config.

Do not hardcode entitlements throughout UI.

Implement a central entitlement service.

Example:

```ts
entitlements.can("EXPORT")
entitlements.limit("CONTACT_REVEAL_MONTHLY")
```

---

# 37. Privacy / LGPD Product Requirements

Treat privacy as architecture, not a legal page added later.

Implement foundations for:

- purpose limitation;
- provenance;
- correction requests;
- deletion/removal requests;
- suppression list;
- audit logs;
- access control;
- retention policies;
- abuse prevention;
- rate limiting;
- export limits;
- contact reveal tracking;
- privacy policy;
- terms of service.

Keep MVP focused on legitimate B2B/company intelligence.

Do not turn the product into unrestricted person search.

Create internal documentation describing:

- what data is exposed;
- source;
- purpose;
- retention;
- correction/removal process.

---

# 38. Security Requirements

Mandatory:

- Firebase token verification;
- server-side authorization;
- tenant isolation;
- input validation;
- GraphQL query depth/complexity limits;
- rate limiting;
- secure headers;
- CSRF strategy where applicable;
- SSRF protection;
- output escaping;
- parameterized database access;
- secrets never committed;
- audit logging;
- PII-safe application logs;
- export limits;
- brute-force protection;
- admin endpoint protection;
- least-privilege database credentials.

Never expose internal cluster endpoints to the browser.

---

# 39. Design System

Design quality is a release requirement.

Create a reusable design system before duplicating components across pages.

Suggested primitives:

```text
Button
IconButton
Input
Textarea
Select
Combobox
SearchInput
FilterChip
Badge
ScoreBadge
SourceBadge
StatCard
CompanyCard
PersonCard
DataTable
Drawer
Modal
CommandPalette
EmptyState
Skeleton
Tooltip
Tabs
Toast
Pagination
```

Define tokens:

```text
colors
typography
spacing
radius
elevation
motion
breakpoints
```

---

# 40. Visual Direction

Use a premium B2B SaaS aesthetic.

Characteristics:

- light theme first;
- optional premium dark theme;
- generous whitespace;
- restrained colors;
- clean borders;
- low visual noise;
- strong typography;
- dense information only where useful;
- polished tables;
- excellent filtering UX;
- subtle motion;
- professional iconography;
- responsive layouts;
- clear hierarchy.

Avoid:

- excessive gradients;
- hacker visuals;
- terminal UI;
- glowing neon;
- excessive glassmorphism;
- random AI sparkle icons;
- infrastructure diagrams in product UI;
- huge decorative graphs;
- excessive cards.

The product should communicate:

```text
trust
clarity
business value
speed
professionalism
```

---

# 41. Responsive Requirements

Primary usage is desktop.

Still support:

- laptop;
- tablet;
- mobile for basic viewing.

Data-heavy discovery/list screens may use responsive horizontal scrolling where appropriate.

Do not degrade desktop UX to optimize for small screens.

---

# 42. Required Routes

Initial frontend routes:

```text
/

/login
/signup
/verify-email

/onboarding
/onboarding/company
/onboarding/icp

/app
/app/discover
/app/companies
/app/company/[id]
/app/lists
/app/lists/[id]
/app/assistant

/app/settings
/app/settings/workspace
/app/settings/team
/app/settings/billing
```

---

# 43. Landing Page

The public landing page should explain business value, not infrastructure.

Hero example:

```text
Find your next Brazilian B2B customer.

Search millions of companies, understand the businesses behind them,
and turn company intelligence into qualified sales opportunities.
```

Suggested sections:

1. hero;
2. prospect discovery;
3. company intelligence;
4. AI qualification;
5. lists/workflow;
6. trusted data/provenance;
7. CTA;
8. pricing placeholder or early access.

Do not mention:

```text
Neo4j
Qdrant
embeddings
ETL
NATS
Kubernetes
```

on the marketing page.

---

# 44. Empty States

Every major empty state must contain a useful action.

Bad:

```text
No lists found.
```

Good:

```text
You haven't created a prospect list yet.

Create a list to organize companies you want to contact.

[Create list]
```

Use onboarding guidance without becoming intrusive.

---

# 45. Error Handling

Create typed application errors.

Examples:

```text
AUTH_REQUIRED
BUSINESS_EMAIL_REQUIRED
DOMAIN_NOT_ALLOWED
ORGANIZATION_ACCESS_PENDING
FORBIDDEN
NOT_FOUND
SEARCH_INVALID
SEARCH_UNAVAILABLE
AI_UNAVAILABLE
USAGE_LIMIT_EXCEEDED
EXPORT_LIMIT_EXCEEDED
```

Frontend must display business-readable messages.

Never expose raw stack traces or database errors.

---

# 46. Observability

Implement:

- structured logs;
- request IDs;
- user ID where safe;
- organization ID where safe;
- latency metrics;
- error rates;
- AI call metrics;
- model/provider;
- token usage;
- cost;
- search latency;
- database latency;
- export metrics;
- auth failures;
- rate-limit events.

Provide:

```text
/health
/ready
```

for deployment probes.

---

# 47. AI Observability

For every AI request log/store where appropriate:

```text
feature
organization_id
user_id
model alias
provider
latency
input token count
output token count
estimated cost
success/failure
prompt/version identifier
```

Do not store sensitive prompt content unnecessarily.

Use stable prompt IDs/versioning.

---

# 48. Performance Targets

Target:

- normal authenticated page response: fast enough to feel instant;
- search UI should render loading state immediately;
- paginated search should avoid blocking the entire interface;
- company profile should progressively load secondary intelligence if necessary;
- expensive graph/AI data may be lazy-loaded;
- cache stable global company intelligence where appropriate.

Avoid premature optimization, but design APIs to prevent obvious N+1 issues.

---

# 49. Caching

Potential cache targets:

- company summary data;
- static company metadata;
- search facets;
- frequently accessed company profiles;
- generated AI company summaries by data version;
- fit explanations by ICP/scoring version.

Cache keys must include required context.

Never share tenant-private AI/user content between organizations.

---

# 50. Exports

MVP must support CSV export for entitled users.

Export must:

- respect organization;
- respect plan limits;
- record usage;
- include only authorized fields;
- support async generation if result is large;
- provide clear status;
- avoid memory-heavy all-at-once generation.

Do not expose raw internal database dumps.

---

# 51. Admin Foundation

Create a protected internal admin area or internal API that allows support staff to:

- inspect organizations;
- inspect users;
- view organization status;
- inspect usage;
- inspect subscription state;
- disable abusive accounts;
- view audit records;
- inspect failed jobs.

Do not overbuild an admin UI.

---

# 52. Testing Strategy

Testing is mandatory.

## Unit Tests

Cover:

- domain policy;
- registrable-domain extraction;
- fit scoring;
- entitlement logic;
- search DSL validation;
- organization authorization;
- usage calculations.

## Integration Tests

Cover:

- Firebase token handling;
- membership access;
- tenant repository scoping;
- company adapters;
- search adapters;
- AI gateway;
- PostgreSQL persistence.

## E2E Tests

Use Playwright.

Critical flows:

```text
business signup
generic-email rejection
email verification flow
workspace creation
existing workspace access request
onboarding
ICP creation
search
company detail
save prospect
create list
add/remove list item
generate outreach
export
tenant isolation
logout/login
```

---

# 53. Critical Tenant Isolation Tests

Create at least two organizations:

```text
ORG_A
ORG_B
```

Verify that a user from ORG_A cannot:

- open ORG_B lists;
- update ORG_B notes;
- export ORG_B prospects;
- read ORG_B saved searches;
- read ORG_B AI generations;
- mutate ORG_B workspace settings.

Test both API and browser-level attack attempts.

A tenant-isolation failure is a release blocker.

---

# 54. Seed / Demo Data

Provide a local development seed.

Seed:

- demo organization;
- owner;
- member;
- ICP;
- example saved lists;
- local adapters or fixture mode only where real data services are unavailable locally.

Production must use real adapters.

Do not ship fake intelligence to production.

---

# 55. Local Development

Provide one-command or minimal-command development setup.

Expected developer experience:

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

or equivalent.

Document dependencies clearly.

The application must fail fast when required configuration is missing.

---

# 56. Secrets

Never commit secrets.

Create `.env.example` containing required variable names only.

Potential variables:

```text
DATABASE_URL

FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
NEXT_PUBLIC_FIREBASE_*

LITELLM_BASE_URL
LITELLM_API_KEY

NEO4J_URI
NEO4J_USERNAME
NEO4J_PASSWORD

QDRANT_URL
QDRANT_API_KEY

REDIS_URL
```

Use existing Infisical integration in cluster if available.

When a secret is required and not available, clearly list it.

Do not invent credentials.

---

# 57. Docker

Create production-grade Dockerfiles.

Requirements:

- multi-stage builds;
- small runtime image;
- non-root user where possible;
- health checks as appropriate;
- deterministic installs;
- no source secrets baked into images.

---

# 58. Helm / Kubernetes

Provide Helm deployment for new services.

Expected resources:

```text
Deployment
Service
Ingress
ConfigMap
Secret references
HorizontalPodAutoscaler where justified
PodDisruptionBudget where justified
NetworkPolicy where supported
ServiceAccount
```

Reuse existing cluster primitives.

Do not deploy duplicate databases without explicit need.

---

# 59. CI/CD

Create CI pipeline for:

```text
lint
typecheck
unit tests
integration tests
build
container build
security/dependency scan
```

Deployment pipeline should be compatible with the existing cluster workflow.

Do not automatically deploy to production from unreviewed branches unless that is already the repository convention.

---

# 60. Engineering Guardrails

Create documentation files such as:

```text
docs/architecture/ARCHITECTURE.md
docs/architecture/TENANCY.md
docs/architecture/AUTH.md
docs/product/DESIGN_SYSTEM.md
docs/product/PRODUCT_RULES.md
docs/security/SECURITY.md
docs/ai/AI_GUARDRAILS.md
```

Important rules:

1. no raw DB access from frontend;
2. no tenant ID trusted from browser;
3. no direct LLM-generated database queries;
4. no business logic in React components;
5. no provider-specific AI logic spread throughout code;
6. no hardcoded plan limits;
7. no hidden cross-tenant caches;
8. no secrets in source;
9. no fake production data;
10. no infrastructure jargon in customer-facing UI.

---

# 61. AI Guardrails

AI outputs must:

- distinguish known facts from generated suggestions;
- never fabricate contact details;
- never fabricate company facts;
- avoid unsupported claims;
- use structured outputs where possible;
- be resilient to prompt injection contained in crawled company data;
- treat external company text as untrusted data;
- never allow retrieved text to override system/developer instructions;
- never expose internal prompts/secrets;
- preserve tenant isolation.

Sanitize and delimit retrieved context before AI calls.

---

# 62. Search Guardrails

Natural-language search must produce a typed intermediate representation.

Flow:

```text
User language
  ↓
LLM
  ↓
Search DSL JSON
  ↓
Zod validation
  ↓
Normalization
  ↓
Repository query
```

If DSL validation fails:

- retry once with validation feedback if appropriate;
- otherwise return a user-readable error.

Never execute raw generated Cypher/SQL directly.

---

# 63. Product Analytics

Track product events such as:

```text
signup_started
signup_completed
onboarding_completed
icp_created
search_executed
company_viewed
company_saved
list_created
contact_revealed
outreach_generated
export_created
upgrade_clicked
```

Avoid storing sensitive values unnecessarily.

Design analytics so we can measure:

```text
activation
search-to-company-view
company-view-to-save
save-to-outreach
retention
usage by organization
```

---

# 64. Activation Metric

Define MVP activation as something similar to:

> User completes onboarding, executes at least one search, opens at least one company, and saves at least one prospect.

Instrument it.

---

# 65. UX Success Scenario

A new customer should be able to complete this flow quickly:

```text
signup with alvaro@0x-ai.com
        ↓
company identified
        ↓
describe product/service
        ↓
define ICP
        ↓
see matching Brazilian companies
        ↓
open prospect
        ↓
read sales brief
        ↓
view business contact
        ↓
generate personalized outreach
        ↓
save company to list
```

This is the primary golden path.

Optimize the entire product around it.

---

# 66. Implementation Milestones

Implement in the following order.

---

## Milestone 0 — Repository Audit

Before coding:

- inspect existing repo;
- map services;
- map schemas;
- locate data sources;
- locate existing APIs;
- identify cluster deployment conventions;
- identify package manager;
- identify coding standards;
- identify existing test frameworks;
- identify secrets/config patterns.

Create:

```text
docs/architecture/CURRENT_STATE.md
```

Document what already exists and what will be reused.

Do not refactor working ingestion components unnecessarily.

### Acceptance Criteria

- existing architecture mapped;
- reusable services identified;
- integration plan documented;
- no duplicated infrastructure planned without explanation.

---

## Milestone 1 — Product Foundation

Implement:

- monorepo/product project structure;
- frontend shell;
- backend shell;
- PostgreSQL SaaS database;
- migrations;
- shared config;
- observability;
- health/readiness endpoints;
- base CI.

### Acceptance Criteria

- web and API run locally;
- database migrations execute;
- health endpoints work;
- lint/typecheck/test/build pass.

---

## Milestone 2 — Design System

Implement:

- design tokens;
- layout shell;
- typography;
- navigation;
- components;
- loading states;
- empty states;
- error states;
- responsive behavior.

Create representative pages using fixtures before wiring all data.

### Acceptance Criteria

- UI is visually coherent;
- no duplicated random styling;
- core primitives documented;
- light theme polished;
- product looks business-oriented.

---

## Milestone 3 — Authentication and Tenancy

Implement:

- Firebase;
- business-domain validation;
- public/disposable domain blocking;
- email verification;
- internal users;
- organizations;
- memberships;
- workspace access requests;
- roles;
- tenant authorization;
- tenant isolation tests.

### Acceptance Criteria

- Gmail/Outlook/etc. signup rejected;
- business domain signup accepted;
- first domain user becomes owner;
- subsequent same-domain user does not automatically gain access;
- cross-tenant tests pass.

---

## Milestone 4 — Onboarding / ICP

Implement:

- company detection by email domain;
- company confirmation;
- product/service description;
- ICP free-text capture;
- AI structured ICP parser;
- ICP editor;
- recommended companies.

### Acceptance Criteria

- onboarding ends with real company recommendations;
- ICP stored and editable;
- user never lands on empty initial dashboard.

---

## Milestone 5 — Data Adapter Layer

Implement adapters for existing company intelligence.

Required interfaces:

```text
CompanyRepository
CompanySearchRepository
RelationshipRepository
SemanticSearchRepository
```

### Acceptance Criteria

- product API retrieves real company data;
- storage-specific code isolated;
- integration tests pass;
- existing intelligence infrastructure reused.

---

## Milestone 6 — Discover

Implement:

- search box;
- natural-language search;
- structured filters;
- Search DSL;
- result ranking;
- pagination;
- cards/table;
- fit scores;
- bulk selection.

### Acceptance Criteria

- common searches return useful results;
- filter state encoded cleanly;
- LLM cannot issue raw DB query;
- page feels like a sales product, not CNPJ search.

---

## Milestone 7 — Company Intelligence

Implement:

- company page;
- executive summary;
- business data;
- contacts;
- people;
- relationships;
- sources;
- confidence;
- freshness;
- fit explanation;
- talking points.

### Acceptance Criteria

- core profile uses real data;
- sources shown where available;
- AI output grounded in supplied data;
- page renders gracefully with missing fields.

---

## Milestone 8 — Prospect Workspace

Implement:

- save company;
- create list;
- list detail;
- add/remove prospects;
- status;
- tags;
- notes;
- bulk actions;
- saved searches.

### Acceptance Criteria

- workflows persist;
- all state tenant-scoped;
- list operations have E2E coverage.

---

## Milestone 9 — AI Outreach

Implement:

- email draft;
- LinkedIn draft;
- WhatsApp draft;
- call script;
- editable output;
- copy action;
- generation history.

### Acceptance Criteria

- generated messages use target context;
- no invented company facts;
- output is editable;
- usage events recorded.

---

## Milestone 10 — Usage / Billing Foundation

Implement:

- plans;
- entitlements;
- usage events;
- usage dashboard;
- limits;
- upgrade UI;
- billing provider abstraction.

Actual payment integration may use the chosen provider once credentials/business configuration are available.

### Acceptance Criteria

- limits centralized;
- usage visible;
- plan-specific features can be controlled without code duplication.

---

## Milestone 11 — Export / Admin / Privacy

Implement:

- CSV export;
- export limits;
- admin foundation;
- audit log;
- suppression/removal model;
- privacy request workflow foundations.

### Acceptance Criteria

- exports tenant-scoped;
- usage recorded;
- admin actions protected;
- privacy requests can be tracked.

---

## Milestone 12 — Production Hardening

Complete:

- security review;
- performance pass;
- caching;
- rate limits;
- GraphQL complexity limits;
- dependency scan;
- E2E suite;
- observability dashboards/hooks;
- Docker;
- Helm;
- runbooks;
- deployment;
- smoke tests.

### Acceptance Criteria

- all critical tests green;
- no known tenant isolation vulnerability;
- secrets externalized;
- production deployment reproducible;
- health/readiness probes pass.

---

# 67. Definition of Done

The MVP is complete only when:

- a real business-domain user can register;
- generic-email signup is blocked;
- workspace is created securely;
- onboarding identifies or allows selecting the user's company;
- user can define an ICP;
- system returns real Brazilian company prospects;
- natural-language search works through validated Search DSL;
- user can open a company intelligence page;
- company data is presented in sales language;
- fit score is deterministic;
- user can save companies;
- user can create/manage lists;
- user can add notes/tags/status;
- user can generate personalized outreach;
- user can export entitled data;
- tenant isolation tests pass;
- usage is metered;
- billing architecture exists;
- audit logs exist;
- privacy foundations exist;
- application is observable;
- Docker images build;
- Helm deployment works;
- CI passes;
- E2E golden path passes;
- visual design is polished enough to demo to paying customers.

---

# 68. Final Deliverables

Produce:

```text
working source code
database migrations
GraphQL schema
REST operational endpoints
Firebase integration
domain validation
design system
production frontend
production API
AI service integration
data adapters
tests
Dockerfiles
Helm charts
CI config
.env.example
architecture docs
security docs
deployment runbook
local-development README
```

Also produce:

```text
docs/IMPLEMENTATION_STATUS.md
```

It must contain:

- completed milestones;
- incomplete items;
- known limitations;
- required secrets;
- deployment notes;
- follow-up recommendations.

---

# 69. Agent Execution Rules

Work milestone by milestone.

For each milestone:

1. inspect existing implementation first;
2. reuse existing abstractions where good;
3. implement smallest complete vertical slice;
4. run lint;
5. run typecheck;
6. run unit tests;
7. run integration tests where relevant;
8. run E2E tests where relevant;
9. fix failures;
10. update documentation;
11. proceed to next milestone.

Do not leave the repository in a knowingly broken state.

Do not mark a task complete because code compiles.

Verify behavior.

---

# 70. Quality Bar

Prefer:

```text
simple
explicit
typed
testable
secure
observable
maintainable
business-oriented
```

over:

```text
clever
overabstracted
agentic everywhere
microservice-heavy
framework-heavy
prematurely optimized
```

This is an MVP, but it must be a **sellable MVP**, not a throwaway prototype.

---

# 71. Final Product Principle

Every customer-facing decision should answer:

> **Does this help the user find, understand, qualify, or contact a potential customer?**

If the answer is no, it is probably not part of the MVP.

The data platform is the engine.

The product is the sales workflow built on top of it.
