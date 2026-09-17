# Contracts: Perfil Completo do Lead Enriquecido

**Feature**: `002-enriched-lead-detail` | **Date**: 2026-09-17

Interfaces expostas: 1 endpoint REST novo + reuso de 2 existentes (contrato já
vigente, listado para referência da UI) + contrato interno de navegação da SPA.

## Novo endpoint: `GET /api/prospects/:id/addresses`

Endereços do lead, deduplicados e com geolocalização (cache `GeocodeCache`).

**Auth/contexto**: sessão httpOnly + `requireRequestOrgId` (401 sem org);
prospect filtrado por `{ id, orgId }` → **404** se não existir ou for de outra
organização (nunca 403 — não vaza existência).

**Resposta 200** (`application/json`):

```json
{
  "prospectId": "uuid",
  "dataRestricted": false,
  "addresses": [
    {
      "id": "sha1-8-do-normalizedKey",
      "fullText": "Rua X, 123 — Bairro, Município/UF, 00000-000",
      "kind": "headquarters",
      "source": "cnpj_raw",
      "confidence": null,
      "location": { "lat": -23.5617, "lng": -46.6559, "precision": "street" }
    },
    {
      "id": "sha1-8",
      "fullText": "Município, UF",
      "kind": "city",
      "source": "prospect_summary",
      "confidence": null,
      "location": { "lat": -23.55, "lng": -46.63, "precision": "city" }
    },
    {
      "id": "sha1-8",
      "fullText": "Endereço capturado em fato",
      "kind": "captured",
      "source": "graph_fact",
      "confidence": 0.72,
      "location": null
    }
  ]
}
```

**Regras**:

- **Trial** (`plan === 'trial'`): `dataRestricted: true`; endereços de rua
  (`cnpj_raw`/`captured` com texto de logradouro) **não são incluídos** — apenas
  `kind: "city"` (coarse). Coerente com `cnpjRawData → null` atual.
- **Geocodificação**: consultas externas só em cache-miss; TTL 90 dias; falha
  externa → item com `location: null` (HTTP continua 200, degradação FR-012);
  limite de 1 geocodificação nova por request (protege Nominatim 1 req/s; demais
  itens ficam `null` e populam o cache em requests seguintes).
- Ordenação: `headquarters` primeiro, depois `captured`, `city` por último.

**Erros**: `401` (sem sessão/org), `404` (prospect inexistente/cross-tenant),
`500` (log estruturado, corpo `{ error }`).

## Endpoints existentes reusados (contrato vigente — sem mudança)

### `GET /api/prospects/:id/enrichment`

`{ prospectId, entities: [{ entityKey, entityType, capabilities: [...] }] }` —
fatos v2 agregados por entidade; capabilities já filtradas por plano
(`filterFactsForPlan`). Usado pelas seções de evidência/progresso.

### `GET /api/enrichment/graph/:cnpj`

`{ available, data: { companyId, cnpj, enrichmentVersion, status, enrichedAt,
profile: { firmographics, domain, social, contact_points[], financial_indicators,
technologies[], people[], relationships, raw_facts }, companyLabel, nodes[],
edges[], facts[] } }` — `available: false` quando a fonte não está configurada
(degradação). Trial: `maskCompanyGraphForTrial` aplicado no servidor
(`dataRestricted: true`, contact_points/people mascarados, `raw_facts` removido).
Usado pelas seções de presença digital, contatos, pessoas, financeiro, grafo.

## Contrato interno de navegação (SPA)

- **Rota de tela**: `path ~ ^/leads/([\w-]+)$` → `LeadDetailScreen` com
  `leadDetailId`; qualquer outra path cai no `TAB_FROM_PATH` atual (comportamento
  preservado).
- **Entrada**: cliques em lead em Dashboard/Prospecção/Pipeline executam
  `history.pushState(null, '', /leads/${id})` + setam `leadDetailId`.
- **Saída**: `popstate` (botão voltar do browser) ou ação "Voltar" da tela →
  `history.back()` quando a origem é interna; `leadDetailId = null` retorna à
  tab ativa anterior (contexto de filtros preservado — listas não desmontam).
- **Deep link direto** (nova aba): resolve `/leads/:id`, carrega o prospect por
  API; 404 cross-tenant → estado "não encontrado" com ação para a lista.

## Contrato de eventos NATS

**Inalterado** (constituição II). A feature apenas lê resultados existentes
(`enrichment.company.completed.v1` → `enrichmentSummary`/grafo); a ação
"disparar/reenriquecer" usa o fluxo atual `POST /api/prospects/:id/enrich`.
