# Live Deployment Record

Confirmed against the live k3s cluster on `157.173.121.7` (`mail.0xcloud.net`,
k3s v1.35.5). Deployed via Helm to namespace `company-enrichment`.

## Confirmed existing services (reused, never duplicated)

| Capability | Service (in-cluster DNS) | Notes |
|---|---|---|
| NATS JetStream | `legal-nats.laweragent.svc.cluster.local:4222` | no auth; streams LEGAL, SCRAPING, BRAZIL_COMPANY_EVENTS, ENRICHMENT |
| Worker Postgres | `legal-postgres.laweragent.svc.cluster.local:5432` | pgvector/pg16, DB `legal_mcp` |
| CNPJ warehouse | `cnpj-postgres.cnpj-data.svc.cluster.local:5432` | DB `cnpj`, `companies` table (~2.9M rows) for firmographics |
| AI Gateway | `litellm-gateway.ai-gateway.svc.cluster.local:4000` | LiteLLM; key `LITELLM_PROXY_KEY` |
| SearXNG | `searxng.monitoring.svc.cluster.local:8080` | public web search |
| FlareSolverr | (absent) | not deployed; fallback disabled |
| Infisical | `infisical-...infisical.svc.cluster.local:8080/api` | operator `secrets.infisical.com/v1alpha1` |
| Redis | `redis-master.redis.svc.cluster.local:6379` | not required by this worker |
| Local registry | `172.17.0.1:5000` (HTTP) | images imported into k3s containerd |

## Secrets (Infisical)

- Project **Lawyer Agent** (`eec0ce55-fcce-47b7-9f7d-f0e11cc5cc61`), env `prod`,
  folder `/company-enrichment`.
- Keys: `DATABASE_URL`, `CNPJ_DATABASE_URL`, `AI_GATEWAY_API_KEY`.
- Synced by the operator into K8s secret `company-enrichment-secrets` using the
  existing `infisical-universal-auth-credentials` machine identity (namespace
  `laweragent`).

## Deploy steps (reproducible)

```bash
# 1. build + push + import into k3s containerd
docker build -t 127.0.0.1:5000/company-enrichment-worker:<tag> .
docker push 127.0.0.1:5000/company-enrichment-worker:<tag>
docker tag  127.0.0.1:5000/company-enrichment-worker:<tag> 172.17.0.1:5000/company-enrichment-worker:<tag>
docker save 172.17.0.1:5000/company-enrichment-worker:<tag> -o /tmp/cew.tar
k3s ctr -n k8s.io images import /tmp/cew.tar

# 2. deploy (migration runs as a PreSync/Helm job -> alembic upgrade head)
helm upgrade --install company-enrichment-worker helm/company-enrichment-worker \
  -n company-enrichment --create-namespace
```

Note: the migration Job's pod template is immutable across upgrades; delete it
first (`kubectl delete job company-enrichment-worker-migrate -n company-enrichment`)
or rely on ArgoCD hook delete policy.

## Verified end-to-end (2026-08-13)

- Migration Job `Complete` (schema `company_enrichment` created).
- 2 worker pods `Running`, connected to NATS, consumer `enrichment-worker`.
- Published `enrichment.company.requested.v1` for a real CNPJ.
- Firmographics enriched from `cnpj-postgres` (legal_name, CNAE, porte populated).
- `enrichment.company.completed.v1` emitted via the transactional outbox.
- Postgres: `enrichment_jobs` COMPLETED, `company_enrichments` row written,
  `outbox_events` fully published (0 pending).

## Image

`172.17.0.1:5000/company-enrichment-worker:0.1.2`
