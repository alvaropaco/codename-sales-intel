#!/usr/bin/env bash
# Live cluster inventory verification for company-enrichment-worker.
# Requires a working kubectl context pointing at the production cluster.
set -euo pipefail

NS="${NS:-}"
echo "== context =="
kubectl config current-context

echo "== NATS =="
kubectl get svc,endpoints -A | grep -i nats || true

echo "== PostgreSQL =="
kubectl get svc,endpoints -A | grep -i postgres || true

echo "== SearXNG =="
kubectl get svc,endpoints -A | grep -i searx || true

echo "== FlareSolverr =="
kubectl get svc,endpoints -A | grep -i flaresolverr || true

echo "== LiteLLM =="
kubectl get svc,endpoints -A | grep -i litellm || true

echo "== Infisical =="
kubectl get crd secrets.infisical.com 2>/dev/null || true
kubectl get secret -A -l 'app.kubernetes.io/managed-by=infisical' 2>/dev/null | head -50 || true

echo "== Redis =="
kubectl get svc,endpoints -A | grep -i redis || true

if [[ -n "$NS" ]]; then
  echo "== namespace $NS resources =="
  kubectl get all -n "$NS" || true
fi
