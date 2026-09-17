# Validação — Motor de Enriquecimento Distribuído (T062/T068)

**Data**: 2026-09-16/17 · **Ambiente**: local (Docker: Postgres 16 + NATS 2 JetStream + Redis 7)

## Executado

| Item | Resultado |
|---|---|
| Migration `20260916200000_enrichment_engine` | ✅ aplicada; validação do shadow DB do Prisma confirmou o SQL escrito à mão **sem drift** (1 correção: `DEFAULT '{}'::TEXT[]` no `dependsOn`) |
| Suíte unitária (`pnpm test`) | ✅ 188/188 |
| Integração real (`test:integration`, JetStream real) | ✅ 2/2 — roundtrip publish/consume + e2e job→task→worker→result→job COMPLETED |
| **C1 (smoke `scripts/smoke-c1.js`)** | ✅ job criado em 298ms; **primeiro parcial em 2.317ms** (SC-001 — meta 60s); 4 tasks; job **PARTIAL 75%** com semântica correta; **expansão dinâmica ao vivo** (2ª `search.news` spawnada pelo fato `company.domain_active`) |
| **C3 (resiliência, real)** | ✅ BrasilAPI retornou HTTP 403 → classificado `PROVIDER_UNAVAILABLE` → retry com backoff → falha definitiva → job PARTIAL sem afetar as demais tasks |
| **T068 carga (reduzida)** | ✅ 8 leads: dispatch em 377ms, drenagem **12,67s** (baseline) vs **12,66s** com `PROVIDER_FORCE_ERROR=searxng` (falha total do provider) → **impacto no throughput ≈ 0% (SC-003 ✓ na escala local)** |
| Bugs pegos na validação real | `consumers.get` exigia API posicional `(stream, durable)` em 4 pontos (runtime, manager, qualification, testes) — teria quebrado todos os consumers em produção; `max_deliver` com referência indefinida no `ensurePullConsumer` |

## Observações de ambiente (não são bugs do motor)

- BrasilAPI responde **403** para o IP local (bloqueio de borda) — classificação e retry funcionaram como desenhado.
- `NATS_ENABLED=false` no `.env` local desliga o adapter de publicação do manager (design legado) — smoke exige `NATS_ENABLED=true`.

## Pendente para staging (fora do escopo local)

- Walkthrough formal C2 (trial vs premium com `ENRICHMENT_CATALOG_FULL=true`), C4 (dashboard de circuit breaker), C6 (reprocess) e C7 (isolamento com falha forçada) — todos cobertos por testes automatizados, resta o passeio manual.
- Meta de escala plena (SC-002: 10k tasks / 100 réplicas) — marco próprio pós-M4 (research R8).
