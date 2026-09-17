# Data Model: Perfil Completo do Lead Enriquecido

**Feature**: `002-enriched-lead-detail` | **Date**: 2026-09-17

A feature é majoritariamente de leitura/apresentação. Novo estado persistido:
**1 tabela nova** (`GeocodeCache`) e **1 campo novo** em `Prospect`
(`leadDetailOpenedAt` não — nenhuma mudança além do cache). Endereços e contatos
continuam vivendo nas fontes existentes; nada de contratos de evento muda
(constituição II intacta).

## Entidades

### `GeocodeCache` (NOVA — Prisma, migração via `prisma migrate`)

Cache de geocodificação compartilhado entre organizações (endereço não é dado
de tenant — o masking por plano é aplicado na leitura, não no cache).

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `String @id @default(uuid())` | |
| `normalizedKey` | `String @unique` | endereço normalizado (minúsculas, sem acento, sem pontuação redundante, componentes ordenados: `cep`, `rua+numero+cidade+uf`, `cidade+uf`) |
| `lat` | `Float` | |
| `lng` | `Float` | |
| `precision` | `String` | `street` \| `zip` \| `city` — rua (número resolvido), CEP (centroide do CEP), cidade (centroide municipal) |
| `source` | `String` | `brasilapi` \| `nominatim` |
| `fetchedAt` | `DateTime @default(now())` | base para revalidação (TTL 90 dias; expirado → re-geocodifica em background, serve o cache enquanto isso) |

### `Prospect` (EXISTENTE — lido, não alterado)

Fontes de endereço/contato por plano (ver `plan-masking.js`):

- **Premium**: `cnpjRawData` (JSON bruto da Receita: `logradouro`, `numero`,
  `complemento`, `bairro`, `municipio`, `uf`, `cep`), `cnpjEmail`, `cnpjPhones`,
  `cnpjPartners`, `cnpjOpenedAt`, `cnpjLegalNature`; sempre visíveis: `city`,
  `state`, `domain`, `companyName`, `tradeName`, `industry`, `employees`,
  `revenueEstimate`, scores (`opportunityScore`, `creditRiskScore/Level`),
  `enrichmentStatus/Source/Version`, `enrichedAt`, `enrichmentSummary` (JSON).
- **Trial** (`maskProspectForTrial`): `cnpjRawData → null` (endereço de rua
  retido), e-mails/telefones/sócios/datas/natureza mascarados; `dataRestricted:
  true`; cidade/UF permanecem → mapa trial é **coarse (precision `city`)**.

### Perfil de enriquecimento (EXISTENTE — via `enrichment-graph.js` / view `company_enrichment.v_company_graph`)

Já normalizado pelo worker; a tela consome `profile` (firmographics, domain,
social, contact_points, financial_indicators, technologies, people),
`nodes`/`edges` (grafo) e `facts` (proveniência). Trial:
`maskCompanyGraphForTrial` (contact_points/people mascarados, `raw_facts`
removido) — já aplicado no servidor (`server-prod.js`).

### Fatos v2 (EXISTENTE — `GET /api/prospects/:id/enrichment`)

`entities[]` com `entityKey`, `entityType`
(prospect|company|person|domain|email|phone|social_profile|product|article) e
`capabilities` filtradas por plano (`filterFactsForPlan`).

## Objetos derivados (sem persistência — contratos de leitura)

### `LeadAddress` (derivado, endpoint `/addresses`)

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `string` | determinístico: hash do `normalizedKey` |
| `fullText` | `string` | endereço formatado em uma linha (premium). Trial: `"Cidade, UF"` |
| `kind` | `string` | `headquarters` \| `summary` (sede extraída do raw) \| `captured` (fato de endereço do grafo) \| `city` (resumo comercial) |
| `source` | `string` | `cnpj_raw` \| `graph_fact` \| `prospect_summary` |
| `confidence` | `number?` | herdado do fato do grafo quando `captured` |
| `location` | `{ lat, lng, precision } \| null` | do `GeocodeCache`; `null` quando não geocodificou (FR-012) |

Deduplicação por `normalizedKey` (sede == resumo comercial da mesma cidade não
gera dois pinos idênticos; mantém o de maior precisão).

## Transições de estado

- **GeocodeCache**: miss → fetch externo → insert (ou update se expirado);
  erro de fonte externa → **não** grava, responde `location: null` (degrada,
  nunca bloqueia a tela).
- **Tela do lead**: `idle → loading (por seção) → ready | error (retry) | empty`;
  lead com `enrichmentStatus` pendente/andamento → seções exibem estado de
  pendência + progresso (FR-017) — nenhum estado novo persistido.
