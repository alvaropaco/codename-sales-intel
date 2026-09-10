# b2base-platform (monorepo)

Monorepo da plataforma B2B de inteligência de CNPJs e prospecção. Absorveu os
antigos repos standalone `alvaropaco/cnpj-data-publisher` e
`alvaropaco/service-cnpj-enrichment` (sem histórico — cópia limpa de código).

## Serviços

| Diretório | Linguagem | Papel |
| --- | --- | --- |
| raiz (`server-prod.js` + módulos) | Node.js | Plataforma: API Express, SPA em `apps/web/`, outreach (e-mail/WhatsApp), campanhas, billing (Prisma/Postgres, NATS, Stripe, Firebase) |
| `services/cnpj-data-publisher/` | Python 3.12 | Ingestão mensal dos Dados Abertos do CNPJ (Receita Federal): download → Parquet (DuckDB) → diff → eventos no NATS JetStream |
| `services/company-enrichment-worker/` | Python 3.12 | Worker de enriquecimento event-driven: descoberta de domínio, OSINT (BBOT/SpiderFoot), análise IA, graph |

## Fluxo de dados

```
Receita Federal ──> cnpj-data-publisher ──> NATS (BRAZIL_COMPANY_EVENTS,
                                            company.br.cnpj.{discovered,updated,...}.v1)
                        │
                        └── Postgres analítico (pgvector) ──> embedder (TEI)

b2base-platform ──> NATS (enrichment.company.requested.v1)
                        │
                        ▼
              company-enrichment-worker ──> enrichment.company.completed.v1
                        │
                        ▼
              b2base-platform (persistência idempotente — nats-enrichment.js)
```

## Desenvolvimento

```bash
# Plataforma (Node)
pnpm install
pnpm run dev            # web (Vite) + server (node --watch)
pnpm test               # node --test test/*.test.js
docker compose up -d    # Postgres local

# cnpj-data-publisher
cd services/cnpj-data-publisher
make setup              # venv + deps
make lint typecheck test
docker compose up -d    # postgres + nats (+ minio)

# company-enrichment-worker
cd services/company-enrichment-worker
python -m venv .venv && pip install -e ".[dev]"
pytest tests/unit -q
docker compose up -d    # pgvector + nats + worker em mock mode
```

## Build & deploy (GitOps)

Imagens publicadas por CI no GHCR; ArgoCD sincroniza a partir de
`alvaropaco/k8s-infra`:

| Serviço | Workflow | Imagem | Gatilho de publicação |
| --- | --- | --- | --- |
| plataforma | `build.yml` | `ghcr.io/alvaropaco/b2base-platform` | push em `main` (paths da plataforma) → tag `sha-<sha>` + bump automático do `k8s-infra/apps/b2base/values.yaml` |
| cnpj-data-publisher | `cnpj-data-publisher.yml` | `ghcr.io/alvaropaco/cnpj-data-publisher` | tags `v*` (consumido por `k8s-infra/argocd/apps/cnpj-data-publisher.yaml`, hoje `v0.1.5`) |
| company-enrichment-worker | `company-enrichment-worker.yml` | `ghcr.io/alvaropaco/company-enrichment-worker` | tags `enrichment-v*` ou `workflow_dispatch` (variantes `default` e `-osint`) |

Cada workflow tem filtro de `paths`/`paths-ignore`: mudanças em um serviço não
rebuildam os outros.

Deploy do enrichment worker usa o chart que vive em
`services/company-enrichment-worker/helm/company-enrichment-worker` (fonte da
verdade; a antiga cópia em `k8s-infra/apps/` é removida após o primeiro sync).

## Histórico da migração

- `alvaropaco/cnpj-data-publisher` → `services/cnpj-data-publisher/`
  (camada SaaS TypeScript embutida — NestJS/Next.js — foi descartada; docs de
  sessão arquivados em `services/cnpj-data-publisher/docs/history/`)
- `alvaropaco/service-cnpj-enrichment` → `services/company-enrichment-worker/`
  (chart de produção migrou de `k8s-infra/apps/`; imagem migrou do registry
  local `172.17.0.1:5000` para o GHCR)

Os dois repos antigos devem ser arquivados no GitHub após o cutover.
