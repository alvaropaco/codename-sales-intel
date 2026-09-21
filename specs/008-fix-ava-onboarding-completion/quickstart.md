# Quickstart: Validar o Fim do Travamento do Onboarding

**Feature**: 008-fix-ava-onboarding-completion | **Date**: 2026-09-21

Cenários que provam a correção ponta a ponta. Detalhes de contrato:
[contracts/frontend-service.md](./contracts/frontend-service.md) · modelo de
estado: [data-model.md](./data-model.md).

## Pré-requisitos

```bash
pnpm install
# Testes automatizados da camada web (vitest, ambiente node):
pnpm --dir apps/web test
# Build de tipo (TypeScript strict):
pnpm --dir apps/web build
```

Obrigatório (constituição III): os testes de regressão do cenário que trava
devem existir **antes** da implementação e falhar no código atual.

## Cenário 1 — Regressão do relato (o caminho que hoje trava)

**Montagem**: teste de serviço com `extract` fake controlável (promise
pendente) e `storage` fake.

1. Responder perguntas 1–9 (nome, empresa, …, e-mail).
2. Responder o site institucional (pergunta 10) — a extração dispara e
   permanece pendente.
3. Responder/pular as perguntas 11 (materiais) e 12 (catálogo).
4. Resolver a extração fake **agora** (confirmação tardia).

**Esperado**:

- A mensagem "Pronto, absorvi tudo…" fica **antes** da última interação
  pendente no transcript (invariante I1) — a pergunta pendente permanece a
  última acionável.
- `getState().stepIndex === 12` (fase de resumo), `completed === false`.
- `complete()` devolve o `OnboardingResult` (com `businessContext` da extração
  tardia) e o flag de sessão é gravado.

No código atual, o passo 4 deixa o serviço sem interação acionável e o
`complete()` nunca é alcançável pela UI — este teste falha antes do fix.

## Cenário 2 — Teto de espera e descarte de resultado tardio

1. `createOnboardingService({ …, extractionTimeoutMs: 50 })` com `extract`
   fake que só resolve após 500 ms (fake timers).
2. Informar site e aguardar o teto.

**Esperado**: `ExtractionOutcome { ok: false, reason: 'TIMEOUT' }`; ativos
`failed` com `warning: 'EXTRACTION_TIMEOUT'`; mensagem conversacional de aviso
inserida antes da interação pendente; a conversa segue até o resumo.
Resolvendo o fetch fake **após** o timeout: nenhuma mutação adicional de
estado, nenhuma mensagem nova (época descartada) e nenhum erro não tratado.

## Cenário 3 — Confirmação só após o settle

1. Extração em voo (fake pendente) e 12 perguntas respondidas.
2. Chamar `complete()` durante a extração.

**Esperado**: `null` (guarda novo). Após resolver a extração: `complete()`
devolve o resultado. (Espelho na UI: botão do resumo desabilitado enquanto
`extracting`.)

## Cenário 4 — Gate da UI pela pergunta pendente (helper puro)

Com `pendingInteraction(state, currentQuestionId)`: dado um transcript onde a
confirmação da extração é a última mensagem, o helper aponta a **pergunta
pendente** como interação acionável. Com a pergunta revelada, composer/chips
ativo. (Unit, sem DOM — padrão vitest node da 004.)

## Cenário 5 — Correção retroativa sem replay e concluível

1. Conversa avançada (ex.: até a pergunta 12); acionar `revise('empresa')`.
2. Responder empresa e as perguntas seguintes até o resumo.

**Esperado**: respostas posteriores descartadas (semântica da 004), mas a
conversa alcança o resumo e `complete()` funciona. Na exibição, o histórico
não é re-revelado do zero (sem `visibleCount = 0`).

## Validação manual (opcional, smoke E2E)

```bash
pnpm --dir apps/web dev
```

Conta nova → conversa até o fim informando um site → conferir que o resumo
aparece, confirmar → dashboard com workspace/CRM. Em DevTools, abas
Network > conditions com throttling lento simulam extração tardia; os eventos
`[ava-onboarding]` aparecem no console.
