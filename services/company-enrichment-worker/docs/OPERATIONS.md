# Operations

## Endpoints

- `GET /healthz` — liveness: process up.
- `GET /readyz` — readiness: NATS + DB reachable, consumer subscribed.
- `GET /metrics` — Prometheus (OpenTelemetry metrics + provider/LLM meters).

No business REST API.

## Runbook

### Deploy

Production via Helm only.

```bash
helm upgrade --install company-enrichment-worker \
  ./helm/company-enrichment-worker \
  -n company-enrichment --create-namespace \
  -f helm/company-enrichment-worker/values.yaml
```

Then run migrations:

```bash
kubectl create job --from=cronjob/company-enrichment-worker-migration \
  company-enrichment-worker-migration-manual -n company-enrichment
```

### Rollout / rollback

- `kubectl rollout status deploy/company-enrichment-worker -n company-enrichment`
- Rollback: `helm rollback company-enrichment-worker <rev> -n company-enrichment`

### Smoke test

```bash
python scripts/publish_request.py --cnpj 00.000.000/0001-00
python scripts/verify_completion.py
```

### Poison messages / DLQ

- Malformed events are terminated after redelivery cap and published to the
  `...dlq.v1` subject; inspect with NATS CLI or an ephemeral consumer.

### Scaling

- HPA on CPU + consumer pending message depth; bounded NATS `MaxAckPending`.
- Horizontal lease takeover ensures no duplicate in-flight work across pods.

## Observability

- structlog JSON to stdout; OpenTelemetry traces to the existing collector.
- Key metrics: jobs claimed/completed/failed, provider success/latency,
  breaker state, LLM tokens, outbox pending.

### Prometheus + Grafana

The chart ships a `ServiceMonitor` (label `release=monitoring-stack`) so the
existing kube-prometheus-stack scrapes `/metrics` on port 8080, and a Grafana
dashboard `ConfigMap` (label `grafana_dashboard=1`) that the Grafana sidecar
auto-imports (folder "company-enrichment", dashboard UID
`company-enrichment-worker`).

- Dashboard source: `helm/company-enrichment-worker/dashboards/company-enrichment-worker.json`.
- Panels: job throughput/latency (p50/p90/p99), active vs free capacity, NATS
  pending backlog, provider request/failure/latency, AI requests/tokens/failures,
  domains found vs websites validated, FlareSolverr fallback, success ratio.
- Toggle via `monitoring.serviceMonitor.enabled` / `monitoring.dashboard.enabled`.
- Verified live: Prometheus `up=1` on both worker pods; metrics such as
  `enrichment_jobs_completed_total` and `enrichment_provider_requests_total`
  are queryable; the dashboard is registered in Grafana.

## Known operational constraints

- Deployed live on k3s (`157.173.121.7`); see `docs/DEPLOYMENT_RECORD.md`.
- The migration Job pod template is immutable across Helm upgrades: delete the
  Job first, or rely on the ArgoCD hook delete policy.
- The in-cluster registry is plain HTTP; images are imported into k3s containerd
  (`k3s ctr images import`) because containerd rejects HTTP over HTTPS.
