# Quickstart: Validação ponta a ponta — Análise Profunda de Lead

**Feature**: 005-deep-lead-analysis | **Date**: 2026-09-18

Cenários executáveis que provam a feature funcionando de ponta a ponta.
Referências: [contracts/api.md](./contracts/api.md) · [data-model.md](./data-model.md) · [spec.md](./spec.md)

## Pré-requisitos

- Postgres + `.env` da plataforma configurados (`DATABASE_URL`, `LITELLM_URL`,
  `LITELLM_MODEL` — sem segredos novos, ver R12).
- Dependências instaladas (`pnpm install`).
- Duas organizações de teste: uma **premium** (com `CommercialSettings`
  preenchido: produto, modelo de negócio, diferenciais, ICP) e uma **trial**.
- Gateway LiteLLM acessível (ou stub local para desenvolvimento).

## Setup

```bash
pnpm install
pnpm run db:migrate          # cria DeepAnalysis + campos em Prospect
node scripts/backfill-lead-status.js   # idempotente: lead → prospect (FR-003)
pnpm test                    # porta de entrada (constituição III)
```

## Cenários de validação

### C1 — Novo formato do kanban (US1)

1. Autentique-se na org premium e abra o pipeline.
2. **Esperado**: colunas `Em Qualificação`, `Análise profunda`, `Prontas para
   contato`, `Clientes ganhos`, `Descartados`; nenhuma "Novas oportunidades".
3. Crie um lead (POST `/api/prospects` ou UI).
   **Esperado**: lead aparece em **Em Qualificação**; enriquecimento dispara
   (badge "Enriquecendo dados…" no padrão atual).

### C2 — Fluxo premium: análise automática e veredito (US2)

1. Na org premium, aguarde a conclusão do enriquecimento de um lead.
2. **Esperado**: card avança sozinho para **Análise profunda** e mostra
   "Analisando…" (avanço manual indisponível — FR-012).
3. Em até ~5 min (p95), o card mostra o **score final** e o selo de
   **aprovado**; o lead avança sozinho para **Prontas para contato**.
4. `GET /api/prospects/:id/deep-analysis` retorna `state:"completed"` com
   `finalScore`, `verdict`, `summary`, `factorsPro/Con`,
   `orgContextConsidered:true`.

### C3 — Veredito negativo → Descartados (US2/FR-010)

1. Force/obtenha um lead com veredito `no_contact` (ex.: lead sem canais de
   contato e fora do ICP da org).
2. **Esperado**: card move sozinho para **Descartados**; a página de detalhes
   mantém veredito negativo + resumo visíveis.
3. Restaure o lead pela coluna (ou `PUT status=deep_analysis`).
   **Esperado**: lead volta para Análise profunda e `state` vira `running`
   (reanálise substitui a vigente — FR-011/FR-014).

### C4 — Override humano (US3/FR-010)

1. Com um lead reprovado ainda em Análise profunda, avance manualmente para
   Prontas para contato.
2. **Esperado**: avanço permitido; a seção de detalhes continua exibindo o
   veredito negativo da IA (transparência; `override` visível).
3. Durante `state:"running"`, tente avançar.
   **Esperado**: 422 `ANALYSIS_RUNNING` (UI mostra o motivo).

### C5 — Página de detalhes (US3)

1. Abra a página de detalhes de um lead analisado.
2. **Esperado**: nova seção de análise com resumo completo, impressões,
   veredito, score final, fatores e data — em PT-BR.
3. Abra a de um lead recém-criado.
   **Esperado**: seção mostra estado (não analisada) sem quebrar as demais
   seções (fontes independentes).

### C6 — Gating por plano (FR-018/SC-007)

1. Autentique-se na org **trial** e abra o pipeline.
2. **Esperado**: coluna Análise profunda visível com indicação de recurso
   premium; lead enriquecido avança **direto** para Prontas para contato
   (fluxo atual preservado); score = determinístico.
3. `GET /api/prospects/:id/deep-analysis` na org trial.
   **Esperado**: 403 `PREMIUM_FEATURE`, sem dados de análise no corpo.
4. Payload do kanban (`GET /api/prospects`) na org trial.
   **Esperado**: `analysisStatus`/`verdict` ausentes/nulos (masking).

### C7 — Migração e resiliência

1. Antes do deploy, crie um lead `status='lead'`. Rode o backfill.
   **Esperado**: lead vira `prospect`; rodar o backfill de novo não altera
   nada (idempotente). Nenhum lead permanece em `lead` (SC-003).
2. Derrube o serviço com uma análise `running` e reinicie.
   **Esperado**: reconciliação no boot re-despacha a análise (padrão
   `resumePendingEnrichments`); nenhum lead preso em running.
3. Com o gateway LLM indisponível, dispare uma análise.
   **Esperado**: card fica com estado de erro + ação reexecutar; kanban,
   enriquecimento e demais telas seguem normais (isolamento de falhas);
   `deep_analysis_failed_total` cresce nas métricas.

## Checklist de aceite rápido

- [ ] C1–C7 executam com os resultados esperados
- [ ] `pnpm test` verde (inclui `test/deep-analysis.test.js` e testes de
      transição/contrato)
- [ ] Build do web (`apps/web`) sem erros
- [ ] Métricas `deep_analysis_*` visíveis no endpoint de métricas
