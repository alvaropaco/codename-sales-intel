# Engineering Guardrails

Mandatory engineering constraints for `company-enrichment-worker`. These mirror
`AGENTS.md` and are enforced through review.

## Infrastructure & deploy

- Reuse the existing VPS cluster. Never duplicate NATS, PostgreSQL, Infisical,
  SearXNG, FlareSolverr, LiteLLM, Redis, MinIO, or Prometheus.
- Production deploy is Kubernetes + Helm only. `docker compose` is dev/test only.
- No new infrastructure is provisioned before `docs/INFRASTRUCTURE_INVENTORY.md`
  is updated and live access confirmed.

## Secrets

- Secrets live only in Infisical, synced via the `InfisicalSecret` CRD.
- `.env.example` holds names only. Nothing committed, no placeholders in prod.
- Report missing secrets as `SECRET_REQUIRED: <secret>`; continue non-blocked work.

## Durability and correctness

- at-least-once everywhere. Do not assume exactly-once.
- Idempotent persistence: unique `event_id` (jobs), unique
  `company_id`+`enrichment_version` (enrichment history).
- ACK only after durable completion (DB commit + outbox row).
- Bounded concurrency (worker semaphore, fetch batch size).
- Timeouts on all external calls.
- Provider rate limits respected; circuit breakers per provider; DLQ for poison.
- No unbounded retries, no infinite redelivery.

## Web and scraping

- Normal HTTP first; FlareSolverr as a bounded, eligible fallback only.
- FlareSolverr only for public, non-authenticated pages.
- SSRF guard on every fetch and after every redirect.

## Evidence and honesty

- No fabricated results. Inferred facts have confidence; discovered facts have
  evidence (`value`, `confidence`, `source`, `observed_at`).
- Estimated/commercial potential is never represented as factual revenue.

## AI

- Only via the existing LiteLLM gateway. Configurable model chain.
- Prefer `gpt-4.1-mini` → `deepseek-v4-flash-0731` → `kimi-k2.6`.
- Deterministic work (DNS, HTTP, regex, MX, dates, scoring, fingerprints) is
  never routed to an LLM.

## API and state

- No business REST API. Only `/healthz`, `/readyz`, `/metrics`.
- No critical state on the local filesystem.
