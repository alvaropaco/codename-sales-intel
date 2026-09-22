# Implementation Plan: Onboarding Salvo na Conta + Região de Interesse

**Branch**: `009-onboarding-profile-sync` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-onboarding-profile-sync/spec.md`

## Summary

Conectar a conclusão do onboarding conversacional à persistência que já existe:
o `PUT` do perfil comercial (org-scoped, upsert em `CommercialSettings`) passa a
ser chamado quando o usuário confirma o resumo, com mapeamento determinístico
das respostas (empresa→nome da org, setor→segmentos, tamanho do time, portes,
regiões, site, contexto de negócio extraído, CRM) e um registro completo das
respostas em campo JSON novo — nada se perde. A sobrescrita indevida de campos
que a conversa não cobre (CNAEs, ticket médio…) é evitada mesclando o perfil
atual com os valores novos **no cliente**, antes de salvar (o endpoint atual
sobrescreve o payload inteiro). Novidade no roteiro: pergunta 9 de **região de
interesse** (multi-chips, "Todo o Brasil" exclusiva + 5 regiões + Outro,
pulável) → localizações-alvo. Migração Prisma única para 2 campos novos
(`crmName`, `onboardingAnswers`); sidebar passa a derivar workspace/CRM do
perfil salvo.

## Technical Context

**Language/Version**: Plataforma: Node.js (CommonJS, Express 5.2, Prisma 5).
Web: TypeScript strict + React 18.3 (Vite 5). Mesmo stack das features 004/008.

**Primary Dependencies**: Nenhuma nova. Existentes e tocadas:
`services/onboarding.ts` (helper puro de mapeamento),
`lib/avaScript.ts` + `types/onboarding.ts` (pergunta nova),
`components/onboarding/ava/*` (chips exclusivos, salvar no confirm),
`App.tsx` (salvar via `saveCommercialProfile` + derivar sidebar do perfil),
`server-prod.js` (`normalizeCommercialProfilePayload` +formatos),
`prisma/schema.prisma` (+2 colunas, migração).

**Storage**: Postgres via Prisma — migração única `crmName String?` +
`onboardingAnswers Json?` em `CommercialSettings` (caminho oficial
`pnpm run db:migrate`; nunca `db push`).

**Testing**: Web: `vitest` (`pnpm --dir apps/web test`) — helpers puros +
serviço. Raiz: `pnpm test` (`node --test`) — plataforma. Migração aplicada em
dev com `db:migrate` e validada por `db:deploy` no pipeline.

**Target Platform**: Web desktop (SPA) + servidor Node único.

**Performance Goals**: Salvamento percebido como parte do fim da conversa
(≤ 3 s p95 antes da despedida); nenhuma mudança de latência na conversa.

**Constraints**: Org-scoped (`requireRequestOrgId` — nunca orgId do body);
onboarding escreve o perfil **uma vez**, sem zerar campos que não cobre
(mescla no cliente); materiais continuam não sendo re-armazenados; nenhum
dado de cliente em logs.

**Scale/Scope**: 1 migração (2 colunas), ~8 arquivos web alterados, 1 bloco
no `normalizeCommercialProfilePayload`, suítes novas de mapeamento + roteiro
13 perguntas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Nota |
|-----------|--------|------|
| I. Especificação antes de código | ✅ | Spec 009 completa, checklist 16/16. |
| II. Persistência idempotente orientada a eventos | ✅ N/A | Sem eventos novos; upsert idempotente no perfil (refazer a chamada não duplica). |
| III. Testes como porta de entrada (NÃO-NEGOCIÁVEL) | ✅ | Mapeamento e roteiro com testes antes; migração validada pelos gates. |
| IV. Multi-tenancy e gating por plano | ✅ | Escrita org-scoped por `requireRequestOrgId`; nenhuma resposta de API nova além do perfil já exposto ao próprio org. |
| V. Segredos fora do repositório | ✅ | Nada novo; registro de respostas fica no banco do org, não em logs. |
| VI. Simplicidade incremental (YAGNI) | ✅ | Reusa endpoint/colunas existentes; 2 colunas novas justificadas (CRM no badge + registro completo); sem dependências novas. |
| VII. Deploy GitOps observável | ✅ | Migração via caminho oficial (db:migrate/dev, db:deploy/CI); logs existentes mantidos. |

## Project Structure

### Documentation (this feature)

```text
specs/009-onboarding-profile-sync/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── profile-sync.md      # Mapeamento respostas → perfil (payload do PUT)
│   └── frontend-service.md  # Delta v2: roteiro 13 perguntas + persistência
└── tasks.md             # Phase 2 output ($speckit-tasks)
```

### Source Code (repository root)

```text
prisma/schema.prisma                    # CommercialSettings: +crmName, +onboardingAnswers
server-prod.js                          # normalize/empty/format: +crmName, +onboardingAnswers
apps/web/src/
├── types/
│   ├── onboarding.ts                   # QuestionId + regioesInteresse; ChatMessage.exclusiveValue
│   └── index.ts                        # CommercialProfile: +crmName, +onboardingAnswers
├── lib/
│   ├── avaScript.ts                    # Pergunta 9 (região); order 1–13; SUMMARY_LABELS
│   └── avaScript.test.ts               # Ordem/props da pergunta nova
├── services/
│   ├── onboarding.ts                   # buildCommercialProfilePayload (puro)
│   ├── onboarding.profile.test.ts      # NOVO — mapeamento/merge/registro completo
│   └── onboarding.test.ts              # Ajustes de ordem (12→13), se necessário
├── components/onboarding/ava/
│   ├── ChipsRow.tsx                    # Opção exclusiva (Todo o Brasil)
│   ├── AvaOnboarding.tsx               # onComplete async + retry conversacional
│   └── AvaSummary.tsx                  # Rótulo da região no resumo (via SUMMARY_LABELS)
└── App.tsx                             # onComplete salva perfil; sidebar deriva do perfil
```

**Structure Decision**: Persistência sobre o endpoint e colunas que já existem
(zero endpoints novos); migração mínima de 2 colunas; toda a lógica de
mapeamento é pura e testável no web.

## Complexity Tracking

> Sem violações de constituição — seção vazia.
