# Data Model: Conclusão do Onboarding com a Ava — Fim do Travamento

**Feature**: 008-fix-ava-onboarding-completion | **Date**: 2026-09-21

Nenhuma entidade nova. Este fix reforça invariantes sobre o modelo da 004
(`specs/004-ai-onboarding/data-model.md`, espelhado em
`apps/web/src/types/onboarding.ts`) e adiciona dois valores de enumeração e um
campo interno. Fonte da verdade dos tipos: `apps/web/src/types/onboarding.ts`.

## Deltas sobre o modelo da 004

### 1. `ExtractionOutcome` — novo motivo `TIMEOUT`

```ts
export type ExtractionOutcome =
  | { ok: true; businessContext: BusinessContext | null }
  | { ok: false; reason: 'NOTHING_TO_EXTRACT' | 'REQUEST_FAILED' | 'TIMEOUT' };
```

- `TIMEOUT`: o fetch não resolveu dentro de `extractionTimeoutMs` (default
  60 s). Dispara mensagem conversacional de aviso (voz da Ava) e segue o fluxo
  (FR-004/FR-006 da spec 008).

### 2. `BusinessAsset.warning` — novo valor `EXTRACTION_TIMEOUT`

Ativos que estavam `pending`/`extracting` quando o teto estourou passam para
`status: 'failed'` com `warning: 'EXTRACTION_TIMEOUT'` (mesmo mecanismo dos
warnings já existentes do endpoint). Sem efeito além do resumo/exibição —
nunca bloqueia (ativos são opcionais).

### 3. Estado interno do serviço — `extractionEpoch: number`

Contador de corrida (não exposto em `OnboardingState`): incrementado a cada
`extractBusinessContext()`. Resultado de fetch cuja época já não é a corrente
(timeout estourado ou extração mais recente iniciada) é **descartado** — sem
mutar `businessContext`, sem anexar mensagens. Garante a regra "toda mutação
de estado por extração pertence à corrida vigente".

## Invariantes de transição (o núcleo do fix)

### I1 — Ordem do transcript: interação pendente é sempre a última acionável

`state.messages` obedece: **toda mensagem de status** (resultado de extração,
aviso de timeout/falha) é inserida imediatamente **antes** da *mensagem de
interação pendente* — definida como a última mensagem com `questionId`
(prompt de pergunta) ou `kind: 'summary'` (marcador de resumo). Se não houver
interação pendente, a mensagem é anexada no fim.

Estado antes (bug): `[..., Q11(materiais), Q12?..., "Pronto, absorvi tudo…"]` —
pergunta pendente deixa de ser a última.
Estado depois: `[..., "Pronto, absorvi tudo…", Q_pendente]` — invariante
restaurada em qualquer chegada tardia.

Helper puro: `insertBeforePendingInteraction(messages, message): ChatMessage[]`
em `lib/avaScript.ts` (imutável; sem efeitos).

### I2 — Fase da sessão: das perguntas ao resumo sem beco

`stepIndex` alcança `AVA_QUESTIONS.length` (fase de resumo) assim que a 12ª
pergunta é respondida/pulada — **independente** do estado da extração. A
extração pendente atrasa apenas a *habilitação da confirmação* (I3), nunca a
transição de fase nem a exibição dos controles da pergunta pendente.

### I3 — Confirmação habilitada só com extração liquidada

`complete()` retorna `null` enquanto `extractionEpoch` indicar corrida em
voo. A UI espelha: botão de confirmação do resumo desabilitado enquanto
`extracting === true` (settle inclui sucesso, falha e timeout).

### I4 — Correção retroativa sempre concluível, sem replay

`revise(questionId)` mantém a semântica da 004 (descarta a resposta alvo e as
posteriores, trunca o transcript na pergunta alvo, re-anexa o prompt), mas a
camada de exibição **não** reinicia a revelação do transcript: o histórico já
revelado permanece e apenas o novo prompt entra com "···".

## Diagrama de estados da sessão (pós-fix)

```text
[perguntas 1..12] --responde/pula a 12ª--> [resumo exibido] --settle extração--> [confirmação habilitada]
        |                                        |                                  |
        | extração em voo (qualquer momento)     | --ajustar item (revise)--> [pergunta re-aberta] --...--> [resumo]
        |    → status inserido antes da          |                                  |
        |      interação pendente (I1)           | ----------confirmar---------> [completed] → dashboard (FR-015 004)
        | timeout 60s → aviso + segue (I1, I2)
```

## Validações preservadas (inalteradas da 004)

Roteiro, ordem das 12 perguntas, chips/`multi-chips`/`yesno`, validações
conversacionais (`validateAnswer`/`correctionMessage`), pre-fill, limite de
materiais (5 × 20 MB, mimes), guarda de empresa genérica, follow-up de URL do
catálogo, `complete()` exigindo as 3 obrigatórias + fase de resumo — todos
intocados (FR-009 da spec 008).
