# CNPJ Data Publisher → Postgres+pgvector on k3s: Delivery & Runbook

Two ready-to-apply patch bundles plus the exact deploy steps. Nothing here has
been pushed or applied to your cluster.

## Contents
- `app-repo/*.patch` — 6 commits for `github.com/alvaropaco/cnpj-data-publisher`
  (analytical sink, embedder, chart wiring, e2e test, observability + readonly
  deploy fixes). Verified to apply cleanly via `git am` on a fresh `main`.
- `infra-repo/*.patch` — 1 commit for `github.com/alvaropaco/k8s-infra`
  (cnpj-postgres chart, 3 ArgoCD apps, Grafana dashboard). Base branch: `master`.

## Apply the patches

```bash
# App repo
git clone git@github.com:alvaropaco/cnpj-data-publisher.git && cd cnpj-data-publisher
git checkout -b feat/postgres-sink
git am /path/to/app-repo/*.patch
git push -u origin feat/postgres-sink      # open a PR

# Infra repo
git clone git@github.com:alvaropaco/k8s-infra.git && cd k8s-infra
git checkout -b feat/cnpj-data-publisher
git am /path/to/infra-repo/*.patch
git push -u origin feat/cnpj-data-publisher # open a PR
```

## Before ArgoCD syncs — build & push the image

The chart references `ghcr.io/alvaropaco/cnpj-data-publisher:latest`. Build and push
it (the image now pre-installs the DuckDB postgres extension for the read-only
pod):

```bash
docker build -t ghcr.io/alvaropaco/cnpj-data-publisher:latest .
docker push ghcr.io/alvaropaco/cnpj-data-publisher:latest
```

## Prerequisite secrets (hold passwords — never in git)

```bash
kubectl create namespace cnpj-data

# pgvector password + a ready DSN for the sink and the app state DB
kubectl -n cnpj-data create secret generic cnpj-postgres-secrets \
  --from-literal=POSTGRES_PASSWORD='CHANGE_ME' \
  --from-literal=database-url='postgresql+psycopg://cnpj:CHANGE_ME@cnpj-postgres.cnpj-data.svc.cluster.local:5432/cnpj'

kubectl -n cnpj-data create secret generic cnpj-data-publisher-postgresql \
  --from-literal=database-url='postgresql+psycopg://cnpj:CHANGE_ME@cnpj-postgres.cnpj-data.svc.cluster.local:5432/cnpj'

kubectl -n cnpj-data create secret generic cnpj-data-publisher-nats \
  --from-literal=url='nats://nats.YOUR-NS.svc.cluster.local:4222' \
  --from-literal=credentials=''

kubectl -n cnpj-data create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=USER --docker-password=TOKEN
```

## ⚠️ Decide before sync

1. **Disk.** The node was at 79% (73Gi free). cnpj-postgres asks for a 40Gi
   PVC and the app snapshot PVC is 60Gi. Confirm headroom or attach a volume,
   or these PVCs will fail to bind / fill the disk shared with mailcow+Supabase.
2. **ArgoCD selfHeal.** Both apps use `automated: {prune: true, selfHeal: true}`.
   If you want to gate the first rollout, sync manually first (set `automated`
   to `{}` in the Application, or `argocd app sync cnpj-postgres` by hand).

## Order of operations

1. Merge infra PR → ArgoCD creates `cnpj-postgres` (wait: pod Ready).
2. ArgoCD runs the app's `migrate` Job, then the `cnpj-data-publisher` apps.
3. First ingest is monthly (schedule `0 4 15 * *`) — to run now:
   `kubectl -n cnpj-data create job --from=cronjob/cnpj-data-publisher-ingestor cnpj-first`

## Verify after deploy

```bash
kubectl -n cnpj-data get pods,pvc
# ingest ran and populated the sink:
kubectl -n cnpj-data exec deploy/cnpj-postgres -- \
  psql -U cnpj -d cnpj -c "SELECT count(*) FROM companies;"
# search_text present, embeddings still NULL until the embed job runs:
kubectl -n cnpj-data exec deploy/cnpj-postgres -- \
  psql -U cnpj -d cnpj -c "SELECT count(*) FILTER (WHERE embedding IS NULL) AS todo FROM companies;"
```

Then enable the embedder (`embedder.enabled=true` in the app values / ArgoCD
inline values), pointing `EMBEDDING_BASE_URL` at the LiteLLM gateway. Grafana
shows the "CNPJ Data Publisher" dashboard automatically (uid `cnpj-data-publisher`).

## What was validated locally (evidence)

- 112 unit + 4 integration (pgvector) + 4 e2e green; ruff + mypy clean.
- Sink ran inside the real image with `--read-only` rootfs + non-root user 10001
  against pgvector (row loaded) — proves the readOnlyRootFilesystem fix.
- Migrations generate valid DDL offline and match the e2e-applied schema.
- Both charts `helm lint` + render from the exact ArgoCD inline values.
- Every dashboard PromQL metric exists in the app's metrics module.
