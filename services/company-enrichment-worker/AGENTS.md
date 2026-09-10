# AGENTS.md — Rules for working on this codebase

Guardrails for any agent working on `company-enrichment-worker`. These are
**mandatory** and mirror `docs/ENGINEERING_GUARDRAILS.md`.

## Infrastructure

- **Reuse existing VPS infrastructure.** Never provision duplicate NATS,
  PostgreSQL, Infisical, SearXNG, FlareSolverr, LiteLLM, Redis, or MinIO.
  They exist already; reference them by service name (see
  `docs/INFRASTRUCTURE_INVENTORY.md`).
- Production deploy happens **only** through Kubernetes + Helm. Never
  `docker run` / `docker compose up` / `systemd` / `pm2` for production.

## Secrets

- Secrets belong **exclusively** in existing Infisical.
- Never hardcode credentials. No credentials in `.env`, Git, `values.yaml`,
  ConfigMap, Dockerfile, source code, or CI logs.
- `.env.example` contains **names only**, never values.
- If a needed secret is missing, report `SECRET_REQUIRED: <secret>` and keep
  implementing non-blocked work. Never invent a secret or place a placeholder
  in production.

## Durability & correctness

- Workers must be **restart-safe**. NATS delivery is **at-least-once**.
- Final persistence must be **idempotent** (unique `event_id`, unique
  `company_id`+`enrichment_version`).
- **Do not ACK before durable completion.**
- All concurrency must be **bounded** (bounded semaphore, batch sizes).
- All external calls require a **timeout**.
- Respect provider **rate limits**. No **unbounded retries** and no infinite
  message redelivery (poison messages go to the DLQ).

## Scraping / web

- Use **normal HTTP before FlareSolverr**. FlareSolverr is a bounded fallback
  for **publicly accessible** resources only.
- Never use FlareSolverr to bypass authorization/login/paywalls.
- Never scrape authenticated/private pages. Never perform invasive scans.
- Enforce **SSRF** protections (block localhost, RFC1918, link-local, metadata,
  private IPv6) and re-validate after redirects.

## Evidence & honesty

- **Never fabricate enrichment results.**
- Every inferred fact requires a **confidence**; every discovered fact requires
  **evidence** (`value`, `confidence`, `source`, `observed_at`).
- Do **not** represent estimated revenue as factual revenue.

## AI

- Use the **existing AI gateway** (LiteLLM). Never call an upstream provider
  directly when a gateway exists.
- Prefer: `gpt-4.1-mini`, `deepseek-v4-flash-0731`, `kimi-k2.6`. Models are
  configurable, not hardcoded.
- **Avoid unnecessary LLM calls.** DNS, HTTP status, regex, MX, dates, hashing,
  deterministic scoring, and technology fingerprints are all deterministic code,
  not LLM.

## API shape

- **No business REST API.** Only `/healthz`, `/readyz`, `/metrics`.
- Input and output are NATS JetStream events only.
- No state critical to the local filesystem.

## Definition of Done

See `docs/DEPLOYMENT.md` and the checklist in `docs/PLAN.md` §53. All code must
pass: unit tests, integration tests, `ruff`, `helm lint`, `helm template`.
