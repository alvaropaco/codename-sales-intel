# Contract: Profile Sync (mapeamento respostas → perfil comercial)

**Feature**: 009-onboarding-profile-sync | `apps/web/src/services/onboarding.ts`

Contrato da função pura que liga a conversa à persistência existente
(`PUT /api/settings/commercial-profile` — sem mudanças no endpoint):

```ts
export function buildCommercialProfilePayload(
  result: OnboardingResult,
  current: CommercialProfile
): CommercialProfile;
```

## Comportamento contratual

1. **Base + override**: saída = `current` com os campos derivados de `result`
   sobrepostos (tabela em research.md D2 / data-model.md). Campos não produzidos
   pelo mapeamento herdam `current` **intactos** (merge preserva — invariante I2).
2. **Campos sempre sobrepostos**: `companyName`, `salesTeamSize`,
   `targetSegments`, `targetSizes`, `targetLocations`, `websiteUrl`,
   `valueProposition`, `businessModel`, `differentiators`,
   `productDescription`, `crmName`, `onboardingCompleted: true`,
   `onboardingAnswers` (registro completo), `onboardingStep` preservado.
3. **Contexto de negócio ausente** (`result.businessContext === null`):
   campos de contexto herdam `current`.
4. **CRM**: `result.crm.name` → `crmName` (`null` quando não declarado);
   `crm.connected` segue `Boolean(crmName)`.
5. **Registro completo** (`onboardingAnswers`): `{ completedAt, answers }` com
   cada pergunta (13), `value`/`via`/`answeredAt` — puladas com `value: null,
   via: 'skipped'`; fonte: `result.answers`.
6. **Idempotência**: mesma entrada → mesma saída (I3).
