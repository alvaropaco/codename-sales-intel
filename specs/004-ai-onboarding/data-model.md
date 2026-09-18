# Data Model: Onboarding Conversacional com IA (Ava)

**Feature**: 004-ai-onboarding | **Date**: 2026-09-18

Estado vive no cliente (decisão da spec, FR-018). Nenhuma migração Prisma nesta
iteração. Tipos em `apps/web/src/types/onboarding.ts`.

## Entidades

### QuestionId (union de literais)

Os 12 passos, na ordem da conversa:

`'nome' | 'empresa' | 'cargo' | 'setor' | 'tamanhoTime' | 'objetivo' | 'crm' | 'mercadoAlvo' | 'email' | 'siteInstitucional' | 'materiais' | 'catalogo'`

- Obrigatórias: `nome`, `empresa`, `email` (FR-010). Todas as demais puláveis (FR-011).
- Chips (seleção única): `cargo`, `setor`, `tamanhoTime`, `objetivo`, `crm`, `catalogo` (sim/não).
- Chips (multi): `mercadoAlvo` (FR-005). Texto livre: `nome`, `empresa`, `email`, `siteInstitucional`, endereço do catálogo, "Outro" de qualquer chip (FR-006/FR-007).

### Answer

| Campo | Tipo | Regras |
|-------|------|--------|
| `questionId` | `QuestionId` | único por sessão |
| `value` | `string \| string[]` | `string[]` só para `mercadoAlvo` |
| `via` | `'chip' \| 'text' \| 'prefilled' \| 'skipped'` | `prefilled` = confirmou sugestão da conta (FR-008); `skipped` mantém `value` nulo |
| `answeredAt` | `number` | epoch ms |

Validação (FR-010): `nome`/`empresa` não vazios (trim); `email` com formato
válido; `siteInstitucional`/catálogo com URL `http(s)://` quando preenchidos.
Resposta inválida não avança o passo e gera mensagem de correção da Ava.

### ChatMessage

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | nanoid/uuid local |
| `from` | `'ava' \| 'user'` | — |
| `kind` | `'text' \| 'chips' \| 'input' \| 'attachments' \| 'summary'` | `chips` carrega `options`; `input` renderiza o composer; `summary` renderiza o resumo |
| `text` | `string \| null` | conteúdo textual |
| `options` | `ChipOption[] \| null` | `{ value, label }`; multi quando a pergunta é `mercadoAlvo` |
| `typingForMs` | `number \| null` | duração do "···" antes de revelar (D8) |

### BusinessAsset

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `string` | — |
| `type` | `'site' \| 'document' \| 'catalog'` | 1 site + N documentos + 1 catálogo por sessão |
| `name` | `string` | nome do arquivo ou host da URL |
| `url` | `string \| null` | site/catálogo |
| `file` | `{ name, size, mime } \| null` | metadados; bytes só em memória |
| `status` | `'pending' \| 'extracting' \| 'extracted' \| 'failed' \| 'unsupported'` | transições abaixo |

Limites (FR-026, Assumptions): ≤ 5 documentos, ≤ 20 MB cada, mimes
`application/pdf`, `application/vnd.openxmlformats-officedocument.*`,
`application/msword` (legado → `unsupported` com aviso), `text/plain`.

### BusinessContext

Resultado da extração (shape espelha `org-context.js` — drop-in para outreach):

| Campo | Tipo | Notas |
|-------|------|-------|
| `products` | `{ name: string, description: string }[]` | absorvidos p/ outreach e-mail/WhatsApp (FR-025) |
| `valueProposition` | `string` | — |
| `businessModel` | `string` | — |
| `differentiators` | `string[]` | — |
| `targetMarket` | `string` | — |
| `sources` | `('site' \| 'document' \| 'catalog')[]` | proveniência |
| `warnings` | `string[]` | falhas parciais (arquivo ilegível, site fora, LLM indisponível) |

### OnboardingState (sessão)

`{ stepIndex, messages: ChatMessage[], answers: Partial<Record<QuestionId, Answer>>, assets: BusinessAsset[], businessContext: BusinessContext \| null, completed: boolean }`

Transições: `completed: false → true` apenas via resumo confirmado (FR-015);
conclusão grava flag em `sessionStorage` (`b2base.avaOnboardingDone=1`) —
implementação do FR-019.

### OnboardingResult (para o App/Sidebar)

| Campo | Origem | Consumo |
|-------|--------|---------|
| `companyName` | `empresa` | Sidebar (workspace, FR-016) |
| `userEmail` | `email` (ou `session.email`) | Sidebar (FR-016) |
| `crm` | `{ name: string \| null, connected: boolean }` | Badge verde no rodapé (FR-017); `connected=false` quando "Ainda não uso"/pulou |
| `businessContext` | extração | Contexto de negócio em estado (FR-024/FR-025) |
| `answers` | as 12 respostas | Futura persistência |

## Mapeamento futuro (integração real — fora do escopo desta iteração)

| Onboarding | Destino backend (hoje) |
|------------|------------------------|
| `nome` | `User.name` |
| `email` | `User.email` (update se divergente do Firebase) |
| `empresa` | `Organization.name` |
| `cargo` | novo campo em `CommercialSettings` |
| `setor`, `mercadoAlvo` | `CommercialSettings.targetSegments` |
| `tamanhoTime` | `CommercialSettings.salesTeamSize` |
| `objetivo` | `CommercialSettings.ctaGoal` |
| `siteInstitucional` | `CommercialSettings.websiteUrl` |
| `crm` | novo campo `CommercialSettings.crmName` |
| `businessContext` | `CommercialSettings.{productDescription, valueProposition, businessModel, differentiators}` → lido por `org-context.js` |
| conclusão | `CommercialSettings.onboardingCompleted = true` |

Nota: `normalizeCommercialProfilePayload` (server-prod.js) clampa
`onboardingStep` em 0–4 — quando a integração real entrar, reavaliar o clamp;
nesta iteração nenhuma escrita é feita.
