# Data Model: Onboarding Salvo na Conta + Região de Interesse

**Feature**: 009-onboarding-profile-sync | **Date**: 2026-09-22

Fonte da verdade: `prisma/schema.prisma` (`CommercialSettings`) e
`apps/web/src/types/` (`CommercialProfile`, `OnboardingState`).

## Delta de schema (migração única)

```prisma
model CommercialSettings {
  // … colunas existentes inalteradas …
  crmName            String?   // 009: CRM declarado no onboarding (null = não usa/não informado)
  onboardingAnswers  Json?     // 009: registro completo das respostas da conversa
}
```

- `crmName`: `String?` — `null` quando "Ainda não uso" (`__none__`) ou pulada.
- `onboardingAnswers`: `Json?` — forma:

```json
{
  "completedAt": "2026-09-22T12:00:00.000Z",
  "answers": {
    "nome":      { "value": "Ana",       "via": "text",  "answeredAt": 1727000000000 },
    "mercadoAlvo": { "value": ["Pequenas empresas"], "via": "chip", "answeredAt": 1727000001000 },
    "regioesInteresse": { "value": ["Sudeste", "Sul"], "via": "chip", "answeredAt": 1727000002000 },
    "cargo":     { "value": null, "via": "skipped", "answeredAt": 1727000003000 }
  }
}
```

Espelhia o `Answer` do onboarding (`types/onboarding.ts`) — perde-se nada,
inclusive perguntas sem coluna própria.

## Mapeamento respostas → perfil (contrato do sync)

Função pura `buildCommercialProfilePayload(result: OnboardingResult, current: CommercialProfile): CommercialProfile`
— mescla `current` (base) com os derivados de `result` (ver tabela em
research.md D2). Campos **não** cobertos pela conversa herdam `current`
intactos. `onboardingCompleted: true` e `onboardingAnswers`/`crmName` sempre
presentes na saída.

Casos de borda contratuais:
- `result.crm.name === null` ("Ainda não uso"/pulada) → `crmName: null`.
- `mercadoAlvo` sem empresas (só B2C/órgãos) → `targetSizes: current` (preserva) —
  valores não-empresa não viram porte.
- `businessContext === null` (extração falhou/expirou) → campos de contexto
  herdam `current`; `onboardingAnswers` registra que ativos foram informados.
- `answers.regioesInteresse` contém `todo-brasil` → `targetLocations: ['Todo o Brasil']`
  (rótulo), pois a opção é exclusiva.
- "Outro" de região (texto livre) entra como texto digitado.

## Pergunta nova no roteiro (avaScript)

```ts
{
  id: 'regioesInteresse', order: 9, kind: 'multi-chips',
  required: false, allowOther: true,
  exclusiveValue: 'todo-brasil',           // NOVO campo opcional de AvaQuestion
  options: [Todo o Brasil, Norte, Nordeste, Centro-Oeste, Sudeste, Sul],
}
```

- `QuestionId` ganha `'regioesInteresse'`; ordem passa a 13 perguntas
  (região = 9ª; e-mail → 10ª; site → 11ª; materiais → 12ª; catálogo → 13ª).
- `ChatMessage` (chips) ganha `exclusiveValue?: string` para a UI.
- `SUMMARY_LABELS.regioesInteresse = 'Regiões de interesse'`.

## Invariantes

- **I1 (escrita única)**: o onboarding só escreve o perfil no `complete()`
  bem-sucedido; edits posteriores no Settings jamais são sobrescritos pela
  conversa.
- **I2 (merge preserva)**: todo campo de `current` que o mapeamento não produz
  aparece idêntico no payload de saída.
- **I3 (idempotência)**: refazer o sync com o mesmo `result` produz o mesmo
  payload (upsert idempotente no servidor).
- **I4 (gate por conta)**: `onboardingCompleted` persistido é o critério único
  de não re-exibição entre sessões; o flag de `sessionStorage` permanece como
  atalho da sessão corrente.

## Tipos web (deltas)

- `CommercialProfile`: `+crmName: string | null`, `+onboardingAnswers: OnboardingAnswersRecord | null`.
- `AvaQuestion`: `+exclusiveValue?: string`; `ChatMessage`: `+exclusiveValue?: string`.
- `QuestionId`: `+ 'regioesInteresse'`.
