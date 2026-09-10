# Security

## Secrets

- Only existing Infisical. Names in `.env.example`, never values.
- No credentials in git, `.env`, ConfigMap, Dockerfile, or Helm values.
- Missing secret → `SECRET_REQUIRED: <name>` and continue non-blocked work.

## Network

- Outbound only; no ingress except `/healthz`, `/readyz`, `/metrics`.
- NetworkPolicy restricts egress to the service namespaces of NATS, Postgres,
  LiteLLM, SearXNG, FlareSolverr, Infisical, DNS.
- TLS for external calls; internal service DNS in-cluster.

## SSRF

- All fetches pass the SSRF guard: block localhost, RFC1918, link-local,
  metadata endpoints, private IPv6; re-validate after redirects.
- FlareSolverr is used only for publicly accessible pages.

## Scraping ethics

- Public resources only; robots.txt respected where applicable; bounded rate,
  depth, bytes.
- Never bypass authentication, login, or paywalls.
- Never scrape authenticated/private pages or perform invasive scans.

## Data integrity

- No fabricated enrichment results; every fact carries evidence
  (value, confidence, source, observed_at).
- Inferred values are confidence-gated, never presented as fact.
- Estimated revenue is never represented as factual revenue.

## Delivery guarantees

- at-least-once; ACK only after durable completion (DB commit + outbox row).
- Idempotent persistence on unique event_id and company_id+enrichment_version.
- Poison messages terminate to DLQ, not infinite redelivery.
