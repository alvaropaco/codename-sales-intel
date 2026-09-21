# Implementation Plan: Conclusão do Onboarding com a Ava — Fim do Travamento

**Branch**: `008-fix-ava-onboarding-completion` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-fix-ava-onboarding-completion/spec.md`

## Summary

Corrigir o travamento terminal do onboarding conversacional da Ava (004): a
confirmação da leitura de ativos chega de forma assíncrona e é anexada **depois**
da pergunta pendente, quebrando a invariante "a pergunta aguardando resposta é a
última interação acionável" — o input desaparece, o resumo nunca é alcançado e a
única saída é "Corrigir resposta anterior" (que trunca e reproduz a conversa).

Abordagem: restaurar a invariante **na fonte** — o serviço insere mensagens de
status (resultado da extração, aviso de timeout) imediatamente **antes** da
mensagem de interação pendente (pergunta ou marcador de resumo) — e blindar a
UI: o gate do composer passa a ser o estado de revelação da **pergunta pendente**,
não da "última mensagem". Complementos obrigatórios para os FRs da spec: teto de
espera de 60 s na extração com descarte de resultado tardio (época/generation),
confirmação do resumo habilitada só após o settle da extração, e `revise` sem o
replay visual de todo o transcript. Zero dependências novas; nada muda no
roteiro, na extração em si nem no backend (exceto 1 log estruturado na rota,
FR-010).

## Technical Context

**Language/Version**: Plataforma: Node.js (CommonJS, Express 5.2). Web:
TypeScript strict + React 18.3 (Vite 5) — mesmo stack da 004, na qual este fix
se insere.

**Primary Dependencies**: Nenhuma nova. Existentes e tocadas: apenas módulos do
onboarding (`services/onboarding.ts`, `state/useAvaOnboarding.ts`,
`components/onboarding/ava/*`, `lib/avaScript.ts`,
`types/onboarding.ts`) e `ava-extract.js` (1 linha de log — FR-010).

**Storage**: Inalterado — estado em memória + `sessionStorage` (flag de
conclusão), decisão de escopo da 004 (FR-018/FR-019). Nenhuma migração.

**Testing**: Web: `vitest` (`pnpm --dir apps/web test`), ambiente node sem DOM,
fakes injetados no serviço (padrão dos testes da 004: `onboarding.test.ts`,
`onboarding.assets.test.ts`, `onboarding.complete.test.ts`,
`onboarding.revise.test.ts`). Raiz: `pnpm test` (`node --test`) para a rota de
extração, se o log for testado.

**Target Platform**: Web desktop (SPA existente).

**Performance Goals**: Nenhuma ação de avanço indisponível além da latência
natural do "···" (800–1600 ms/jitter); extração com teto de 60 s (aviso de
lentidão ~30 s mantido); resumo alcançado no pior caso ≤ 60 s após a última
resposta (SC-003).

**Constraints**: Correção de orquestração — roteiro, textos da Ava, validação e
contratos HTTP da 004 intocados (FR-009 da spec 008); nenhum dado de cliente em
logs (constituição VII); sem I/O novo além do fetch já existente.

**Scale/Scope**: ~5 arquivos web alterados + 1 arquivo de rota (1 log line) +
2–3 arquivos de teste novos/estendidos. Nenhuma tela nova, nenhuma dependência.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Nota |
|-----------|--------|------|
| I. Especificação antes de código | ✅ | Spec 008 completa e aprovada no checklist. |
| II. Persistência idempotente orientada a eventos | ✅ N/A | Nenhum evento NATS novo; endpoint de extração segue stateless e idempotente. |
| III. Testes como porta de entrada (NÃO-NEGOCIÁVEL) | ✅ | Tarefas de teste antecedem implementação (regressão do cenário que trava incluída). |
| IV. Multi-tenancy e gating por plano | ✅ N/A | Fluxo de UI autenticado já existente; nenhum endpoint novo; extração já protegida. |
| V. Segredos fora do repositório | ✅ | Nada novo; materiais continuam em memória, fora de logs. |
| VI. Simplicidade incremental (YAGNI) | ✅ | Sem dependências/frameworks novos; evolução de módulos existentes; helper puro em `lib/` existente. |
| VII. Deploy GitOps observável | ✅ | Logs estruturados no cliente (eventos de timeout/descarte) + duração na rota (FR-010); sem dados de cliente. |

## Project Structure

### Documentation (this feature)

```text
specs/008-fix-ava-onboarding-completion/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── frontend-service.md  # Delta v1.1 do contrato da 004
└── tasks.md             # Phase 2 output ($speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/web/src/
├── types/
│   └── onboarding.ts                    # ExtractionOutcome ganha 'TIMEOUT'
├── lib/
│   └── avaScript.ts                     # Helper puro: mensagem de interação pendente
├── services/
│   ├── onboarding.ts                    # Inserção ordenada + timeout/época + guard no complete()
│   ├── onboarding.completion.test.ts    # NOVO — regressão do cenário que trava
│   └── onboarding.assets.test.ts        # Estendido — inserção ordenada/timeout
├── state/
│   └── useAvaOnboarding.ts              # Gate por pergunta pendente; revise sem replay
└── components/onboarding/ava/
    ├── AvaOnboarding.tsx                # Consome novo gate; confirm desabilitado em extração
    └── AvaSummary.tsx                   # Prop confirmDisabled
ava-extract.js                           # 1 log estruturado de duração/resultado (FR-010)
```

**Structure Decision**: Correção contida na camada web do onboarding (feature
004) + 1 linha observável na rota de extração existente. Nenhum serviço novo,
nenhuma mudança de schema, nenhum contrato HTTP alterado.

## Complexity Tracking

> Sem violações de constituição — seção vazia.
