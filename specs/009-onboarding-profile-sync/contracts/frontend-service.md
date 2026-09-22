# Contract: Frontend Service — Delta v2 (roteiro 13 perguntas + sync)

Base: `specs/008-fix-ava-onboarding-completion/contracts/frontend-service.md` (v1.1).
Mudanças apenas no roteiro e na camada de integração:

1. **`regioesInteresse`** (9ª pergunta): `multi-chips`, `allowOther`, pulável,
   `exclusiveValue: 'todo-brasil'`; opções Norte/Nordeste/Centro-Oeste/Sudeste/Sul.
   `AVA_QUESTIONS.length === 13`.
2. **`AvaQuestion`/`ChatMessage`**: campo opcional `exclusiveValue?: string`.
   UI: selecionar a opção exclusiva limpa as demais seleções (visual);
   `validateAnswer` inalterado (multi não vazia é válida).
3. **Persistência**: fora do serviço de conversa (continua sem I/O além de
   extração/storage). `App` executa: `buildCommercialProfilePayload(result,
   commercialProfile)` → `saveCommercialProfile(payload)` → `setCommercialProfile`
   → `setOnboardingResult` → dashboard. Em erro: ver D6 (retry conversacional,
   respostas intactas).
4. **Compatibilidade**: assinaturas públicas do serviço de onboarding
   (`answer/skip/revise/complete/…`) inalteradas; chamadores existentes
   compilam sem mudança.

## Server (`normalizeCommercialProfilePayload`)

Campos novos aceitos e normalizados (idempotentes ao payload atual):
`crmName` (string trimada ou null), `onboardingAnswers` (objeto JSON ou null).
`emptyCommercialProfile`/`formatCommercialProfile` os expõem. Nenhuma rota nova.
