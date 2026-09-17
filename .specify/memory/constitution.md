# b2base-platform Constitution

Princípios que governam especificações, planos e implementações deste monorepo.
Qualquer feature guiada pelo Spec Kit (`$speckit-*`) valida as decisões contra
este documento; violações precisam de justificativa explícita na spec/plan.

## Princípios Fundamentais

### I. Especificação antes de código
Toda feature de produto nasce como spec em `specs/<NNN>-<nome>/spec.md`, criada
via `$speckit-specify` (branch `NNN-<nome>`). Implementação sem spec/plan
correspondente só é aceitável para fixes triviais, chores e ajustes de
infraestrutura documentados. A spec define o "quê" e os critérios de aceite; o
plan define o "como".

### II. Persistência idempotente orientada a eventos
Os serviços conversam por NATS JetStream com contratos de evento versionados
(`company.br.cnpj.*.v1`, `enrichment.company.*.v1`). Consumidores devem ser
idempotentes (reprocessar o mesmo evento não pode duplicar estado — padrão de
referência: `nats-enrichment.js`). Contratos existentes nunca mudam de forma
quebrada: evolução ganha sufixo `.v2` e período de convivência.

### III. Testes como porta de entrada (NÃO-NEGOCIÁVEL)
Feature nova ou comportamento alterado exige teste antes do merge:
`pnpm test` (`node --test test/*.test.js`) na plataforma, `pytest` +
`make lint typecheck test` nos serviços Python. Nas tarefas geradas pelo
`$speckit-tasks`, os testes vêm antes das tarefas de implementação.

### IV. Multi-tenancy e gating por plano
Dados e ações são isolados por organização (contexto via `org-context.js`).
Recursos respeitam o plano do cliente (trial = enriquecimento básico,
premium = profundo) através de `plan.js` / `plan-masking.js` — nenhuma resposta
de API pode vazar capacidade além do plano contratado. Regras de cobrança
(Stripe) mudam sempre com as skills Stripe como referência.

### V. Segredos fora do repositório
`.env` / `.env.local` nunca são commitados; credenciais chegam por variáveis de
ambiente. Scopes OAuth são os mínimos necessários (Gmail, Firebase, WhatsApp).
Materiais sensíveis de teste usam fixtures, nunca contas reais de produção.

### VI. Simplicidade incremental (YAGNI)
Plataforma em Node.js com módulos planos na raiz; serviços extraídos para
Python apenas quando a carga justificar (padrão: `cnpj-data-publisher` e
`company-enrichment-worker`). Novas dependências e frameworks exigem
justificativa na spec/plan. Preferir evoluir módulo existente a criar camada nova.

### VII. Deploy GitOps observável
CI publica imagens por commit no GHCR (`sha-<sha>`) e o ArgoCD sincroniza a
partir de `alvaropaco/k8s-infra` — infraestrutura não é alterada por mão na
produção. Fluxos críticos novos expõem métricas (prom-client) e logs
estruturados suficientes para diagnóstico sem acesso a dados de cliente.

## Restrições de Stack

- Plataforma: Node.js (Express 5, Prisma 5/Postgres, ioredis, NATS, Stripe,
  Firebase Admin); SPA em `apps/web/` (Vite).
- Serviços: Python 3.12 (publisher: DuckDB/Parquet; enrichment worker: OSINT/IA).
- Migrações de schema exclusivamente via Prisma
  (`pnpm run db:migrate` / `db:deploy`) — nunca `db push` direto em produção.
- Integrações externas de billing/pagamento seguem as skills Stripe do repo.

## Fluxo de Desenvolvimento

1. Feature: `$speckit-specify` → `$speckit-clarify` (opcional, recomendado) →
   `$speckit-plan` → `$speckit-checklist` (opcional) → `$speckit-tasks` →
   `$speckit-analyze` (opcional) → `$speckit-implement` → `$speckit-converge`.
2. Branch `NNN-<nome>` por feature; commits no padrão conventional (PT-BR),
   ex.: `feat(score): ...`, `fix(enrichment): ...`.
3. Quality gates antes do merge: `pnpm test`, build do web, lint/typecheck/test
   dos serviços afetados.
4. Merge em `main` dispara CI por paths e deploy automático da plataforma;
   serviços Python publicam por tags (`v*`, `enrichment-v*`).

## Governança

- Esta constituição se sobrepõe a práticas ad-hoc: em conflito, ela vence.
- Specs/planos que precisam violar um princípio registram a exceção e a
  justificativa na própria spec; complexidade sem justificativa é recusada em review.
- Emendas seguem versionamento MAJOR.MINOR.PATCH: MAJOR remove ou reescreve um
  princípio, MINOR adiciona princípio/seção, PATCH esclarece redação. A emenda
  é documentada no PR correspondente com plano de migração do que já existe.
- Orientação de runtime para agentes: `AGENTS.md` na raiz.

**Version**: 1.0.0 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-09-16
