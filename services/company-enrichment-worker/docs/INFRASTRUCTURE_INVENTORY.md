# Infrastructure Inventory

Reuse-first inventory of the existing VPS infrastructure for the `company-enrichment-worker` service.

> Source of truth: the GitOps repo `alvaropaco/k8s-infra` (ArgoCD app-of-apps on the K3s cluster) and the `cloud-stack` manifests. Live cluster confirmation must be performed before provisioning (see "Access notes" below). **No duplicate infrastructure is created.**

---

## 1. Cluster

| Resource | Value |
|---|---|
| Cluster | K3s on Oracle Cloud VPS (Oracle VCN / OCI) |
| API server | 6443, kubeconfig `/etc/rancher/k3s/k3s.yaml` on the node |
| GitOps | ArgoCD (app-of-apps, `argocd/` in `k8s-infra`) |
| Ingress controller | Traefik (k3s `helm.cattle.io` chart), HTTPS via cert-manager (Let's Encrypt) |
| Load balancer | MetalLB, single IP pool `157.173.121.7/32` |
| Storage class | `local-path` (default) |
| Registry | In-cluster HTTP registry `172.17.0.1:5000` (docker bridge). Images are also imported directly into k3s containerd (`k3s ctr images import`) since containerd rejects the plain-HTTP registry over HTTPS. |

### Access notes

**Live-confirmed (2026-08-13).** The cluster is reachable via
`ssh -i ~/.ssh/id_ed25519 root@157.173.121.7`; `kubectl` runs on the node
(k3s v1.35.5, node `mail.0xcloud.net`). The service is deployed and verified
end-to-end. See `docs/DEPLOYMENT_RECORD.md` for the confirmed service map,
Infisical layout, and the reproducible deploy steps. The tables below are
reconciled with the live cluster; where an earlier planning guess differed, the
live value is used and the discrepancy is noted inline.

---

## 2. Namespaces and services

### NATS JetStream (reuse)

| Field | Value |
|---|---|
| Namespace | `laweragent` |
| Service | `legal-nats.laweragent.svc.cluster.local` |
| Client port | 4222 |
| Monitor port | 8222 |
| Image | `nats:2.10-alpine` |
| Purpose | Async messaging. Provides JetStream for the enrichment pipeline (in + out events). |
| Reuse | Consume `enrichment.company.requested.v1`, publish completed/failed/partial/discarded and DLQ. |

### PostgreSQL (reuse)

| Field | Value |
|---|---|
| Namespace | `laweragent` |
| Service | `legal-postgres.laweragent.svc.cluster.local` |
| Port | 5432 |
| Image | `pgvector/pgvector:pg16` |
| Purpose | Durable relational store. |
| Reuse | New dedicated database/schema `company_enrichment` (`enrichment_jobs`, `company_enrichments`, `outbox_events`). Never shares product tables. |

### MinIO / S3 (reuse)

| Field | Value |
|---|---|
| Namespace | `laweragent` |
| Service | `legal-minio.laweragent.svc.cluster.local` |
| API port | 9000 |
| Console port | 9001 |
| Existing buckets | `legal-raw`, `legal-artifacts` |
| Purpose | Object storage. |
| Reuse | Optional: persist crawled artifacts/screenshots to an enrichment bucket. |

### FlareSolverr (NOT present)

| Field | Value |
|---|---|
| Status | **Absent on this cluster** (live-confirmed 2026-08-13). No FlareSolverr Service/Deployment exists. |
| Effect | The worker's FlareSolverr fallback is **disabled** (`FLARESOLVERR_URL` empty). Normal HTTP is used; blocked public pages are simply skipped, never forced. |
| If added later | Set `existingServices.flaresolverrUrl` + the `flaresolverr` egress namespace in the chart. Public pages only; never to bypass auth/paywalls. |

### Redis (available; not required by this worker)

| Field | Value |
|---|---|
| Namespace | `redis` |
| Service | `redis-master.redis.svc.cluster.local` (also `redis-replicas`, `redis-headless`) |
| Port | 6379 |
| Purpose | Distributed coordination / rate limiting. |
| Reuse | Not used currently: FlareSolverr is absent and provider rate limits are in-process (bounded per pod). Wire `REDIS_URL` only if cross-pod coordination becomes necessary. |

### LiteLLM / AI Gateway (reuse)

| Field | Value |
|---|---|
| Namespace | `ai-gateway` |
| Service | `litellm-gateway.ai-gateway.svc.cluster.local` |
| Port | 4000 |
| Protocol | OpenAI-compatible |
| Purpose | LLM routing (cost / latency / availability). |
| Reuse | All LLM calls. Never call an upstream provider directly. Existing apps reference it as `LITELLM_PROXY_URL`. |

### Infisical (reuse — secrets)

| Field | Value |
|---|---|
| Namespace | `infisical` |
| API service | `infisical-infisical-standalone-infisical.infisical.svc.cluster.local` |
| API port | 8080 (/api) |
| Operator CRD | `secrets.infisical.com/v1alpha1` `InfisicalSecret` |
| Pattern | Universal Auth via `infisical-universal-auth-credentials` secret; projects keyed by UUID; envSlug e.g. `prod`; managed K8s secret via `managedKubeSecretReferences`. |
| Purpose | All secrets. |
| Reuse | Secrets live under folder `/company-enrichment` in the existing **Lawyer Agent** project (`eec0ce55-fcce-47b7-9f7d-f0e11cc5cc61`, env `prod`), synced by the operator into K8s secret `company-enrichment-secrets` in namespace `company-enrichment`, authenticated by the existing `infisical-universal-auth-credentials` machine identity in `laweragent`. |

### SearXNG (reuse — live-confirmed)

| Field | Value |
|---|---|
| Namespace | `monitoring` |
| Service | `searxng.monitoring.svc.cluster.local` |
| Port | 8080 |
| Status | Confirmed reachable; returns JSON search results (verified in the live smoke test). |
| Reuse | Primary web-search provider for domain discovery. |

### CNPJ warehouse (reuse — firmographics source)

| Field | Value |
|---|---|
| Namespace | `cnpj-data` |
| Service | `cnpj-postgres.cnpj-data.svc.cluster.local` |
| Port | 5432 (DB `cnpj`) |
| Data | `companies` table, ~2.9M Brazilian companies with firmographics + `vector(768)` embeddings, maintained by `cnpj-data-publisher`. |
| Reuse | Deterministic firmographics lookup by CNPJ (`FirmographicsProvider`, `CNPJ_DATABASE_URL`). Read-only; never mutated. |

---

## 3. Observability

| Resource | Status |
|---|---|
| Prometheus | Present in cluster namespace `monitoring` / `monitoring-new` |
| Prometheus Operator CRDs (`monitoring.coreos.com`) | **Not installed** — no ServiceMonitor/PodMonitor available. Plain `/metrics` scrape path only. |
| Grafana | Present (dashboards) |
| Uptime Kuma | `kuma.0xcloud.net` |
| Logging | JSON structured logs (stdout) collected by cluster log stack |

The worker exports Prometheus text metrics on `/metrics` and emits JSON logs via structlog plus OpenTelemetry spans.

---

## 4. Networking / policy baseline

- No ingress for the worker. Health/metrics are `ClusterIP` only.
- NATS Postgres, Infisical, SearXNG, FlareSolverr, LiteLLM are reachable in-cluster via ClusterIP services.
- Public internet egress is required (DNS, RDAP, direct web, SearXNG upstream).
- SSRF protections are mandatory in the crawler/domain-validation code (block RFC1918, link-local, metadata, localhost, private IPv6).

---

## 5. Deploy model

| Aspect | Decision |
|---|---|
| Namespace | `company-enrichment` (dedicated, subject to live review) |
| Deploy | Helm chart `helm/company-enrichment-worker/`, applied via ArgoCD or `helm install` |
| Infisical integration | `InfisicalSecret` CRD → managed K8s secret → `envFrom`/`env` in Deployment |
| Secrets | Only in Infisical; nothing hardcoded, no `.env`/values/ConfigMap credentials |
| Autoscaling | Kubernetes HPA (CPU) initially; metric-server based. KEDA not installed — backlog-based autoscaling documented but requires approval before installing. |

### Confirmed at deploy time (live)

All previously-open items are resolved:

- **SearXNG**: `searxng.monitoring.svc.cluster.local:8080` (confirmed).
- **Infisical project UUID**: `eec0ce55-fcce-47b7-9f7d-f0e11cc5cc61`, env `prod`, folder `/company-enrichment`.
- **NATS**: JetStream enabled on `legal-nats` (streams present); no auth on this
  cluster, so `NATS_CREDS` is empty. Stream `ENRICHMENT` captures
  `enrichment.company.>`.

Any secret that cannot be set in Infisical is reported as `SECRET_REQUIRED`
(none outstanding).

---

## 6. How each piece is reused (summary)

| Need | Reused from | Instead of creating |
|---|---|---|
| Messaging | NATS JetStream (`legal-nats`) | New NATS/RabbitMQ/Kafka/Celery |
| Relational store | PostgreSQL (`legal-postgres`) | New Postgres |
| Secrets | Infisical + operator | Env files / plaintext K8s secrets |
| Web search | SearXNG (`searxng.monitoring`) | New search engine |
| Firmographics | CNPJ warehouse (`cnpj-postgres.cnpj-data`) | Re-scraping Receita data |
| Anti-bot fallback | FlareSolverr (absent — fallback disabled) | New headless-browser farm |
| LLM | LiteLLM gateway (`litellm-gateway`) | Direct provider calls |
| Object storage | MinIO (`legal-minio`) | New object store |
| Coordination/rate-limit | Redis (`redis-master.redis`) — not currently used | New cache/queue |
| Metrics | Prometheus + Grafana | New metrics infra |
| Delivery | ArgoCD + Helm | Manual kubectl/`docker run` |
