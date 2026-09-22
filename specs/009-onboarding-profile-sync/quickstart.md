# Quickstart: Onboarding Salvo na Conta + Região de Interesse

**Feature**: 009-onboarding-profile-sync | **Date**: 2026-09-22

Contratos: [profile-sync.md](./contracts/profile-sync.md) ·
[frontend-service.md](./contracts/frontend-service.md) · modelo:
[data-model.md](./data-model.md).

## Pré-requisitos

```bash
pnpm install
pnpm run db:migrate          # aplica a migração (crmName, onboardingAnswers) em dev
pnpm --dir apps/web test     # suíte web (vitest)
pnpm test                    # suíte raiz (node --test)
pnpm --dir apps/web build    # tsc strict + vite build
```

Migração: gerada pelo caminho oficial do Prisma (`db:migrate`); no deploy é
aplicada por `db:deploy`. Nunca `db push`.

## Cenário 1 — Mapeamento respostas → perfil (unit, serviços)

Dado um `OnboardingResult` completo (empresa, setor, tamanho, mercado-alvo com
empresas, regiões com Sudeste+Sul, site, CRM "Pipedrive", contexto de negócio
extraído) e um `current` com `targetCnaes: ['6201-2/00']` e `averageTicket: 5000`:

- `buildCommercialProfilePayload(result, current)` preserva `targetCnaes` e
  `averageTicket` intactos (I2);
- `companyName` = empresa; `targetSegments` = setor; `salesTeamSize` = tamanho;
  `targetSizes` = `['small']` (Pequenas empresas); `targetLocations` =
  `['Sudeste','Sul']`; `websiteUrl` = site; `crmName` = 'Pipedrive';
  `productDescription`/`valueProposition`/`businessModel`/`differentiators` do
  contexto; `onboardingCompleted: true`;
- `onboardingAnswers.answers` contém as 13 perguntas, incluindo puladas
  (`via: 'skipped'`).

## Cenário 2 — Bordas do mapeamento (unit)

- CRM `__none__` → `crmName: null`.
- `mercadoAlvo` só "Consumidor final (B2C)" → `targetSizes` herda `current`.
- `businessContext: null` → campos de contexto herdam `current`.
- Regiões com `todo-brasil` → `targetLocations: ['Todo o Brasil']`.
- Mesma entrada duas vezes → payload idêntico (I3).

## Cenário 3 — Roteiro 13 perguntas + exclusividade (unit, roteiro)

- `AVA_QUESTIONS` tem 13 questões; `regioesInteresse` é a 9ª (após
  `mercadoAlvo`, antes de `email`), `multi-chips`, pulável, com "Outro" e
  `exclusiveValue 'todo-brasil'`.
- Serviço: responder mercado-alvo → próxima pergunta é `regioesInteresse`;
  respondê-la avança para `email`; pular funciona.
- `SUMMARY_LABELS` inclui 'Regiões de interesse'.

## Cenário 4 — Fim a fim (smoke manual/E2E)

1. Conta nova → conversa completa (informe região Sudeste + Sul e um CRM).
2. Confirmar resumo → despedida → dashboard **após** o salvamento.
3. Recarregar: onboarding não re-aparece; sidebar mantém empresa e badge verde
   do CRM (derivados do perfil salvo).
4. Settings → perfil comercial: empresa, segmento, tamanho, porte "Pequenas",
   localizações Sudeste+Sul, site, descrição de produto/proposta preenchidos;
   campos avançados (CNAEs, ticket) preservados se já existiam.
5. (Opcional) DevTools offline no momento do confirm → bolha da Ava com aviso,
   respostas intactas, botão volta a "Tudo certo — concluir ✨" para tentar de novo.
