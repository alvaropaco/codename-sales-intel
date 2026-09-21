# Quickstart: B2Base Discovery Engine

## Setup

```bash
pnpm install
pnpm run db:migrate        # aplica 20260921120000_discovery_engine
pnpm test                  # inclui test/discovery-*.test.js
pnpm run worker:discovery  # opcional: execução via NATS (default: in-process)
```

## Providers e variáveis de ambiente

| Provider | Capabilities | Configuração | Custo |
|---|---|---|---|
| `cnpj-mcp` | corporate.identity | `CNPJ_MCP_URL` + `CNPJ_MCP_TOKEN` | free (base oficial) |
| `searxng` | web.search | `SEARXNG_URL` | free (self-hosted) |
| `serper` / `brave` / `exa` | web.search | `SERPER_API_KEY` / `BRAVE_API_KEY` / `EXA_API_KEY` | pago, budget-gated |
| `crtsh` | digital.domains | — | free |
| `dns-rdap` | digital.infrastructure | — | free |
| `projectdiscovery` | digital.domains | `PROJECTDISCOVERY_API_KEY` | free tier |
| `http-metadata` | digital.contacts | — | free |
| `jusbrasil` / `escavador` | legal.cases, legal.documents | `JUSBRASIL_TOKEN` / `ESCAVADOR_TOKEN` | pago, budget-gated |
| `cvm` | financial.profile | `CVM_BASE_URL` (mirror JSON `{cnpj, capitalSocial, situacao, cnaes}`) | free |
| `funding` | financial.funding | `FUNDING_BASE_URL` (+ `FUNDING_API_KEY`) | pago, budget-gated |
| `spiderfoot` | digital.infrastructure | `SPIDERFOOT_URL` | free (fora do caminho crítico) |

Providers sem credenciais ficam `skipped` (NOT_CONFIGURED) e o orquestrador cai
para alternativa habilitada da mesma capability (precedência self-hosted →
free → pago). Segredos são referências de env — nunca entram em payload ou
snapshot do job.

## Profile discovery (US1)

`POST /api/discovery/jobs` com `{"criteria": {"cnae": "6201-5/00", "state": "SP", "city": "Campinas"}}`
→ `GET /api/discovery/jobs/:id` (progresso por provider) → `GET /api/discovery/jobs/:id/candidates?minConfidence=0.5`
→ `POST /api/discovery/jobs/:id/candidates/:candidateId/import` (idempotente).

## Domain discovery (US2)

`POST /api/discovery/jobs` com `{"seed": {"domain": "exemplo.com.br"}}` e providers
`crtsh`, `dns-rdap`, `projectdiscovery`, `http-metadata`.

## Provider failure

Provider fake que estoura timeout: o run faz retry (2×, backoff) e termina
`failed`; os demais providers persistem normalmente e o job fica `partial`.

## Idempotency

Reentregue o mesmo `discovery.provider.completed.v1` (ou rode o job 2×):
nenhuma entidade, relação, evidência ou candidato duplica (dedup por chave
canônica / `rawHash` / `dedupeKey`).

## Budget

Provider pago com `maxRequests` esgotado → `skipped` com `BUDGET_EXHAUSTED` e
fallback para alternativa configurada; custo estimado acumula em
`estimatedCost` (centavos) do job.
