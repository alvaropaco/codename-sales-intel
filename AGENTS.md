# AGENTS.md — b2base-platform

Instruções para agentes de código (ZCode e afins) neste repositório.

## Spec-Driven Development (Spec Kit)

Este projeto usa o GitHub Spec Kit (estrutura em `.specify/`). Features de
produto seguem o fluxo, nesta ordem:

`$speckit-specify` → `$speckit-clarify` → `$speckit-plan` → `$speckit-tasks` →
`$speckit-analyze` → `$speckit-implement` → `$speckit-converge`

(`clarify`, `analyze` e `checklist` são opcionais, mas recomendados em features
com ambiguidade; o restante é obrigatório.)

- Spec de cada feature: `specs/<NNN>-<nome>/` (branch `NNN-<nome>` criado pelo
  script de spec-kit).
- Constituição — princípios inegociáveis do projeto:
  `.specify/memory/constitution.md`. Toda decisão de spec/plan valida contra ela.
- Templates de artefatos: `.specify/templates/`.

## Regras rápidas

- Nunca commitar segredos: `.env`, `.env.local`, tokens ou credenciais.
- Stack: Node.js/Express + Prisma/Postgres (raiz, `apps/web/`), Python 3.12
  (`services/`). Não introduzir framework/dependência nova sem justificativa na
  spec ou no plan.
- Migrações de schema apenas via Prisma (`pnpm run db:migrate` / `db:deploy`);
  nunca `db push` em produção.
- Testes são porta de entrada: `pnpm test` (node --test) na plataforma,
  `pytest` nos serviços Python. Alteração de comportamento sem teste não sai.
- Comunicação entre serviços via NATS JetStream; consumidores idempotentes;
  eventos versionados (`*.v1`), evolução via `.v2`.
- Respeitar gating por plano (trial/premium) e isolamento por organização em
  qualquer endpoint novo.
- Commits no padrão conventional, em PT-BR (ex.: `feat(score): ...`).
