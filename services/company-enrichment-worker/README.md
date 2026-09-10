# company-enrichment-worker

Distributed, event-driven company enrichment service. Consumes
`enrichment.company.requested.v1` events from **NATS JetStream**, runs a
discovery/analysis pipeline, persists results to **PostgreSQL**, and publishes
completion events. No business REST API.

## Highlights

- **Event-driven**: NATS JetStream in/out. Only `/healthz`, `/readyz`, `/metrics` over HTTP.
- **Durable & idempotent**: at-least-once + unique constraints; ACK only after durable persistence.
- **Restart-safe**: job leases + heartbeats; a dead worker's job is re-acquired.
- **Horizontally scalable**: shared durable pull consumer; HPA-backed.
- **Reuses VPS infra**: existing NATS, PostgreSQL, SearXNG, FlareSolverr, LiteLLM, Infisical.
- **Evidence-first**: every discovery carries `value`, `confidence`, `source`, `observed_at`.
- **Deterministic scoring**: launch velocity, operational readiness, commercial potential, buying intent.
- **LLM via gateway only**: model chain `gpt-4.1-mini` → `deepseek-v4-flash-0731` → `kimi-k2.6`.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # set names only; real values via Infisical
scripts/run_migrations.py
python -m company_enrichment
```

## Test & validate

```bash
pytest tests/            # unit + integration
ruff check src/
helm lint helm/company-enrichment-worker/
helm template helm/company-enrichment-worker/ -n company-enrichment
```

## Structure

- `src/company_enrichment/` — worker, providers, pipeline, scoring, AI, models, db
- `helm/company-enrichment-worker/` — Helm chart (deployment, HPA, netpol, Infisical)
- `migrations/` — Alembic migrations (schema `company_enrichment`)
- `scripts/` — migration + publish/verify E2E helpers
- `docs/` — architecture, guardrails, deployment, inventory, policies
- `argocd/application.yaml` — ArgoCD Application for GitOps sync

The service is deployed and verified end-to-end on the k3s VPS; see
`docs/DEPLOYMENT_RECORD.md`. General reference lives in `docs/` and `AGENTS.md`.
