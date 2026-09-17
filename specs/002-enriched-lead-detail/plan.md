# Implementation Plan: Perfil Completo do Lead Enriquecido

**Branch**: `002-enriched-lead-detail` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-enriched-lead-detail/spec.md`

## Summary

Substituir o fluxo atual de detalhe do lead enriquecido (painel lateral
`ProspectDetailDrawer` + botão "Ver grafo de enriquecimento completo" +
`EnrichmentGraphModal`) por uma **tela dedicada** com deep link (`/leads/:id`),
que apresenta todas as informações capturadas em seções independentes: visão
geral, inteligência (scores), firmografia, presença digital, tecnologias,
redes de contato acionáveis, endereços, pessoas, financeiro, **grafo de
relacionamento interativo** (React Flow) e **mapa 3D** dos endereços
geocodificados (MapLibre GL). Backend: 1 endpoint novo
(`GET /api/prospects/:id/addresses`) com geocodificação BrasilAPI/Nominatim e
cache persistente (`GeocodeCache`); o restante compõe endpoints existentes
(`prospect + /enrichment + /enrichment/graph/:cnpj`), preservando isolamento
por org e mascaramento de trial. Decisões detalhadas: [research.md](./research.md).

## Technical Context

**Language/Version**: Node.js (Express 5) na plataforma; TypeScript 5 + React 18.3 (Vite 5) em `apps/web/`

**Primary Dependencies**: existentes — Express, Prisma 5, ioredis, NATS, recharts, framer-motion, Tailwind 3.4. **Novas** (justificadas em research.md D1/D2): `maplibre-gl` (mapa 3D), `@xyflow/react` (grafo interativo). Sem react-router (research.md D3).

**Storage**: Postgres via Prisma — 1 tabela nova `GeocodeCache` (migração via `pnpm run db:migrate`); leitura de `Prospect`, view `company_enrichment.v_company_graph` (pool read-only `ENRICHMENT_DATABASE_URL`) e fatos v2 existentes

**Testing**: `pnpm test` (`node --test test/*.test.js`) na plataforma; gate do web: `pnpm run build` (`tsc && vite build`); validação de UX pelos cenários do [quickstart.md](./quickstart.md)

**Target Platform**: Web desktop-first (SPA existente); Chrome/Firefox/Safari atuais

**Project Type**: Monorepo — plataforma (raiz) + SPA (`apps/web/`)

**Performance Goals**: tela com dados essenciais renderizada ≤ 2s (SC-001); mapa plota endereços ≤ 3s (SC-003); libs de mapa/grafo carregadas via import dinâmico (code-splitting)

**Constraints**: zero novas chaves/segredos (tiles OSM, BrasilAPI, Nominatim sem key — constituição V); Nominatim ≤ 1 req/s (cache + limite de 1 geocode novo por request); masking de trial em toda resposta (constituição IV); nenhuma mudança em contratos de evento NATS (constituição II)

**Scale/Scope**: 1 tela nova + 11 componentes de seção; 1 endpoint novo + 1 módulo (`geocoding.js`); 1 migração Prisma; aposentadoria do drawer+modal como caminho de detalhe

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Evidência |
|-----------|--------|-----------|
| I. Especificação antes de código | ✅ | `spec.md` aprovada no checklist de qualidade; este plan define o "como" |
| II. Persistência idempotente orientada a eventos | ✅ | Nenhuma mudança em contratos `*.v1`; feature só lê resultados existentes (contracts/api.md) |
| III. Testes como porta de entrada | ✅ | Testes `node --test` novos (`test/geocoding.test.js`, `test/lead-addresses.test.js`) precedem implementação nas tasks; gates `pnpm test` + `pnpm run build` |
| IV. Multi-tenancy e gating por plano | ✅ | Endpoint novo com `requireRequestOrgId` + filtro `{id, orgId}` (404 cross-tenant); trial: endereços de rua retidos (coerente com `cnpjRawData → null`), reuso de `maskProspectForTrial`/`maskCompanyGraphForTrial` |
| V. Segredos fora do repositório | ✅ | Nenhuma chave nova: tiles OSM, BrasilAPI e Nominatim sem credencial |
| VI. Simplicidade incremental (YAGNI) | ✅ | Sem novo serviço (geocoding é módulo plano na raiz); 2 deps novas de frontend justificadas por requisito de spec (mapa 3D, grafo interativo); sem react-router (evolui padrão `TAB_FROM_PATH` + pushState); endpoint agregador único rejeitado (D5) |
| VII. Deploy GitOps observável | ✅ | Sem mudança de infra/CI; endpoint novo loga estruturado (erros de geocode com contagem, sem dado de cliente) |

**Pós-Phase 1**: sem violações — nenhuma linha na tabela de complexidade.

## Project Structure

### Documentation (this feature)

```text
specs/002-enriched-lead-detail/
├── plan.md              # This file
├── research.md          # Decisões D1–D7 ($speckit-plan)
├── data-model.md        # GeocodeCache + objetos derivados ($speckit-plan)
├── quickstart.md        # Cenários de validação ponta a ponta ($speckit-plan)
├── contracts/
│   └── api.md           # Contrato do endpoint novo + reusados + navegação SPA
└── tasks.md             # ($speckit-tasks)
```

### Source Code (repository root)

```text
# Plataforma (raiz, módulos planos — padrão existente)
geocoding.js                  # NOVO: extração, normalização, BrasilAPI/Nominatim, cache
server-prod.js                # Endpoint novo GET /api/prospects/:id/addresses (requireRequestOrgId + masking)
prisma/schema.prisma          # Modelo GeocodeCache
prisma/migrations/<n>/        # Migração gerada por pnpm run db:migrate
plan-masking.js               # Reuso (maskProspectForTrial) — sem mudança de contrato
enrichment-graph.js           # Reuso (fetchCompanyGraph) — sem mudança
test/
├── geocoding.test.js         # NOVO
└── lead-addresses.test.js    # NOVO

# SPA (apps/web/)
apps/web/package.json         # + maplibre-gl, @xyflow/react
apps/web/src/
├── App.tsx                   # Rota /leads/:id (estado + pushState/popstate), cliques navegam p/ tela
├── services/api.ts           # fetchLeadAddresses(id)
├── types/index.ts            # LeadAddress, LeadDetail* types
└── components/
    ├── lead/                 # NOVO: tela + seções
    │   ├── LeadDetailScreen.tsx
    │   ├── LeadOverview.tsx
    │   ├── LeadIntelligence.tsx
    │   ├── LeadFirmographics.tsx
    │   ├── LeadDigitalPresence.tsx
    │   ├── LeadContacts.tsx
    │   ├── LeadAddresses.tsx
    │   ├── LeadPeople.tsx
    │   ├── LeadFinancials.tsx
    │   ├── LeadRelationshipGraph.tsx
    │   ├── LeadLocationMap.tsx      # maplibre-gl via import dinâmico
    │   ├── LeadEvidence.tsx
    │   └── useLeadDetail.ts        # hook de fetch paralelo + estados por seção
    ├── modals/
    │   ├── ProspectDetailDrawer.tsx # Botão "Ver grafo..." e bloco de grafo removidos (aposentado do fluxo de detalhe)
    │   └── EnrichmentGraphModal.tsx # REMOVIDO (conteúdo redistribuído nas seções)
    └── ui/                  # primitivos existentes (LockedText etc.) reusados
```

**Structure Decision**: mantém a estrutura do monorepo — plataforma com módulos
planos na raiz (constituição VI) e SPA em `apps/web/src/` com componentes por
domínio; nova pasta `components/lead/` isola a tela e suas seções.

## Complexity Tracking

> Sem violações de constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
