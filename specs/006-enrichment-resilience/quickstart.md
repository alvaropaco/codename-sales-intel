# Quickstart: Validação ponta a ponta — Resiliência e Observabilidade do Enriquecimento

**Feature**: 006-enrichment-resilience | **Date**: 2026-09-20

Cenários executáveis que provam a feature funcionando de ponta a ponta.
Referências: [contracts/api.md](./contracts/api.md) · [data-model.md](./data-model.md) · [spec.md](./spec.md)

## Pré-requisitos

- Postgres + `.env` da plataforma (incluindo `NATS_URL`, `REDIS_URL`,
  `LITELLM_URL`, `SLACK_WEBHOOK_URL`, `ALERT_EMAIL_TO`).
- Dependências instaladas (`pnpm install`) e serviço Python com venv
  (`services/company-enrichment-worker` — `pytest` disponível).
- Prometheus/Grafana do monitoring-stack no cluster (scrape por anotação).

## Setup

```bash
pnpm install
pnpm run db:migrate        # PARKED/DEGRADED + EnrichmentTaskRetryEvent + OpsNotification
pnpm test                  # portas de entrada (constituição III)
pytest services/company-enrichment-worker/tests/unit -q   # deadline/fallback
```

## Cenários de validação

### C1 — Task transiente nunca fica FAILED (US1/FR-001)

1. Force um provedor a falhar com erro transiente até esgotar as tentativas
   imediatas (ex.: circuito aberto simulado).
2. **Esperado**: task termina em `PARKED` com `nextAttemptAt` agendado e um
   `EnrichmentTaskRetryEvent` (cycle 1) — e **não** em `FAILED`.
3. `b2base_enrichment_tasks_parked` cresce no `/metrics`.

### C2 — Recuperação automática (US1/FR-004)

1. Com a task parked, restaure o provedor.
2. **Esperado**: no ciclo do sweeper (≤ 60s + taxa do provedor), a task é
   re-publicada, conclui com sucesso e o job recalcula de `DEGRADED` para
   `COMPLETED` sem intervenção.

### C3 — Taxa por provedor (FR-003)

1. Com centenas de tasks parked do mesmo provedor, dispare o sweeper.
2. **Esperado**: re-publicações limitadas a
   `ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN` por minuto (log/métrica
   `republished_total` cresce no máximo na taxa).

### C4 — Backlog reenfileirado (US2/FR-008)

1. Rode `node scripts/backfill-requeue-failed.js --dry` → conferir contagem
   (somente FAILED transientes; não-transientes ficam de fora).
2. Rode sem `--dry`.
3. **Esperado**: tasks voltam via sweeper em lotes; jobs `PARTIAL` recalculam
   para `COMPLETED` conforme as tasks concluem; rodar o script de novo não
   duplica nada (idempotente).

### C5 — Deadline do OSINT com sucesso parcial (US3/FR-010)

1. Com um scan de bbot lento (acima de `OSINT_BBOT_DEADLINE_S`), observe a task.
2. **Esperado**: task **conclui com sucesso** marcada como parcial, com os
   eventos coletados; métrica `enrichment_osint_scans_total{outcome="partial"}`.
3. Com um bbot que retornou menos de `OSINT_SPIDERFOOT_MIN_EVENTS`, verifique
   que o spiderfoot roda como fallback; caso contrário, não roda.

### C6 — Dashboard Grafana (US4/FR-012/013)

1. Abra o Grafana → dashboard de enriquecimento.
2. **Esperado**: painéis de sucesso/falhas reais/travadas com dados < 1 min,
   filtros por organização e capability, estado dos circuitos e filas.

### C7 — Notificações (US5/FR-014–017)

1. Force uma falha não-transiente (entrada inválida).
   **Esperado**: alerta no Slack em até 5 min com org/lead/capability/erro;
   registro em `OpsNotification` com dedupKey único; repetir a mesma falha
   NÃO gera segundo alerta.
2. Circuito aberto por > 1h → alerta único por hora.
3. No ciclo do digest → e-mail consolidado (concluídas, falhas por motivo,
   parked mais antigas, taxa de sucesso).

### C8 — Disparo manual SRE (R2)

1. `POST /api/system/enrichment-sweeper/run` com `X-Internal-Token`.
2. **Esperado**: `{ scanned, republished }` coerentes com o estado parked.

## Checklist de aceite rápido

- [ ] C1–C8 executam com os resultados esperados
- [ ] `pnpm test` verde (sweeper, estados, notifier) e `pytest` do worker verde
- [ ] Build do web e do worker Python sem erros
- [ ] Dashboard visível no Grafana com filtros por org/capability
- [ ] Alerta Slack recebido em cenário controlado; digest por e-mail recebido
