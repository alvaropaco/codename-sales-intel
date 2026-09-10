# Deployment

Production deploy is Kubernetes + Helm only, referencing **existing** VPS
cluster infrastructure. Never provision duplicate services.

## Prerequisites (live, on the VPS)

The service is already deployed and verified; `docs/DEPLOYMENT_RECORD.md` has the
confirmed values. For a fresh deploy or another cluster:

1. Access the k3s node (`ssh -i ~/.ssh/id_ed25519 root@157.173.121.7`) and run
   `scripts/inventory_live.sh` to confirm the service map.
2. Ensure the `company-enrichment` namespace exists (Helm `--create-namespace`).
3. Store secrets in Infisical under the project/folder used by the chart
   (`DATABASE_URL`, `CNPJ_DATABASE_URL`, `AI_GATEWAY_API_KEY`). The operator
   syncs them into `company-enrichment-secrets`. Report any missing secret as
   `SECRET_REQUIRED: <secret>`.
4. Build the image, push it to the in-cluster registry, and import it into k3s
   containerd (see "Image build"); set `values.yaml` `image.tag`.

## Image build

The cluster uses an in-cluster HTTP registry (`172.17.0.1:5000`). Because
containerd rejects plain HTTP over HTTPS, images are also imported directly into
k3s containerd. See `docs/DEPLOYMENT_RECORD.md` for the exact live procedure.

```bash
# Legacy/core worker (no OSINT engines):
docker build -t 127.0.0.1:5000/company-enrichment-worker:<tag> .
# OSINT worker (BBOT installed; required for the `bbot` worker type):
docker build --build-arg BUILD_WITH_OSINT=true \
  -t 127.0.0.1:5000/company-enrichment-worker-osint:<tag> .
docker push 127.0.0.1:5000/company-enrichment-worker:<tag>
docker tag  127.0.0.1:5000/company-enrichment-worker:<tag> 172.17.0.1:5000/company-enrichment-worker:<tag>
docker save 172.17.0.1:5000/company-enrichment-worker:<tag> -o /tmp/cew.tar
k3s ctr -n k8s.io images import /tmp/cew.tar
```

(Dev/test only: `docker compose up` for a local stack.)

## Helm deploy

Legacy mode (default, `WORKER_TYPES=core`):

```bash
helm lint helm/company-enrichment-worker/
helm template helm/company-enrichment-worker/ -n company-enrichment

helm upgrade --install company-enrichment-worker helm/company-enrichment-worker/ \
  -n company-enrichment \
  --set image.tag=<tag> \
  --set infisical.projectId=<project-uuid>

kubectl -n company-enrichment rollout status deployment/company-enrichment-worker
kubectl -n company-enrichment get svc,deploy,hpa,pod
```

Multi-worker (graph) mode: populate `workerTypes` to render one Deployment per
worker type (each with its own HPA and `WORKER_TYPES` env). The `bbot` and
`spiderfoot` types should point at the OSINT image:

```bash
helm upgrade --install company-enrichment-worker helm/company-enrichment-worker/ \
  -n company-enrichment \
  --set-json 'workerTypes={
    "orchestrator": {"replicas": 1, "concurrency": 10},
    "registry":    {"replicas": 2, "concurrency": 10},
    "domain":      {"replicas": 3, "concurrency": 10},
    "contacts":    {"replicas": 3, "concurrency": 8},
    "people":      {"replicas": 2, "concurrency": 8},
    "relationships":{"replicas": 1, "concurrency": 10},
    "financial":   {"replicas": 1, "concurrency": 10},
    "bbot":        {"replicas": 3, "concurrency": 2,
                    "autoscaling": {"enabled": true, "minReplicas": 1, "maxReplicas": 10}}
  }'
```

Migration is a Helm pre-sync Job and is applied by either mode (runs before the
workloads; additive tables only).

Optionally register the chart as an ArgoCD Application (app-of-apps pattern in
the `k8s-infra` repo), which also runs the PreSync migration Job hook.

## Post-deploy checks

```bash
# readiness / metrics
kubectl -n company-enrichment port-forward svc/company-enrichment-worker 8080:8080
curl -s localhost:8080/healthz
curl -s localhost:8080/readyz
curl -s localhost:8080/metrics

# synthetic smoke test (from a client pod with network access to NATS)
python scripts/publish_request.py --count 1
python scripts/verify_completion.py --expect 1

# multi-replica durability (crash/redelivery, plan §47/§48)
python scripts/verify_durability.py --count 12
```

## Rollback

```bash
helm history company-enrichment-worker -n company-enrichment
helm rollback company-enrichment-worker <revision> -n company-enrichment
```

Migrations are backward-compatible; no destructive migration runs automatically.

## Definition of Done checklist

Local tests, Docker build, unit tests, integration tests, E2E tests,
`ruff`, `helm lint`, `helm template`, cluster dependency inspection, Infisical
verification, Helm deploy, rollout, readiness, synthetic smoke test, metrics/log
verification. See `docs/PLAN.md` §53.
