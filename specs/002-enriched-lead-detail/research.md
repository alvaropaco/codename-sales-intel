# Research: Perfil Completo do Lead Enriquecido

**Feature**: `002-enriched-lead-detail` | **Date**: 2026-09-17

Decisões técnicas para os pontos em aberto da spec (a spec deliberadamente não
fixou tecnologia). Cada decisão inclui justificativa — a constituição (VI) exige
justificativa para nova dependência/framework.

## D1 — Biblioteca de mapa 3D: **MapLibre GL JS** (`maplibre-gl`)

- **Decision**: `maplibre-gl` (BSD-3-Clause) com tiles raster públicos do
  OpenStreetMap (`tile.openstreetmap.org`), sem chave de API. Import dinâmico
  (code-splitting) para não impactar o carregamento inicial da tela.
- **Rationale**: único candidato open source que entrega os requisitos da US5
  (rotação/inclinação 3D da cena, marcadores clicáveis, cartão por marcador)
  sem chave nem custo por chamada. Suporta pitch até 85° e bearing contínuo.
- **Alternatives considered**:
  - *CesiumJS*: globo 3D completo — bundle muito pesado (~MBs) para plotar
    endereços de um lead; overkill (YAGNI).
  - *Leaflet*: 2D apenas — não atende "mapa 3D".
  - *Google Maps JS / Mapbox GL*: exigem chave de conta/cobrança (constituição V
    prefere zero segredos novos) e/ou licença proprietária.
- **Notas**: nenhuma chave de API é necessária; política de uso dos tiles OSM é
  adequada ao volume (mapa por lead, sob demanda do operador). Para praise de
  terreno 3D real (terrain-RGB) não há necessidade — o requisito é perspectiva
  3D (pitch/rotação), atendida pelo renderer vetorial do MapLibre.

## D2 — Biblioteca de grafo interativo: **React Flow** (`@xyflow/react`)

- **Decision**: `@xyflow/react` (MIT, compatível React 18) para a seção de rede
  de relacionamentos (US4): pan, zoom, seleção de nó, destaque de vizinhança e
  painel de detalhe. Layout radial calculado em código (evolução do posicionamento
  radial já existente em `RelationshipGraph` no `EnrichmentGraphModal.tsx`),
  sem dependência extra de layout (sem dagre).
- **Rationale**: dá interatividade completa (arrastar, zoom, seleção, minimap)
  com integração React idiomática e custom nodes — substitui o SVG desenhado à
  mão, que hoje é estático e sem interação.
- **Alternatives considered**:
  - *Evoluir o SVG manual atual* (d3-force à mão): mantém todo o custo de
    interação (hit-test, zoom, pan, seleção) em código próprio — exatamente o
    que a biblioteca resolve; rejeitado por custo/manutenção.
  - *Cytoscape.js*: maduro, mas API imperativa alheia ao React; integração pior.
  - *react-force-graph / 3d-force-graph*: grafo em 3D WebGL (three.js) — peso e
    complexidade desnecessários; o requisito de 3D da spec é para o **mapa**,
    não para o grafo.

## D3 — Deep link / navegação para a nova tela: **evoluir o padrão atual (pushState), sem react-router**

- **Decision**: estender o padrão existente de `App.tsx` (`TAB_FROM_PATH` +
  `window.location.pathname`): nova rota de tela `/leads/:id` controlada por
  estado (`leadDetailId`) + `history.pushState` no clique e listener de
  `popstate` para o botão voltar/retornar ao contexto (FR-002, FR-003).
- **Rationale**: a constituição (VI) manda preferir evoluir o módulo existente a
  criar camada nova. A SPA já resolve deep links por mapeamento URL→estado
  (redirect OAuth cai em `/settings?gmail_connected=…`); uma única nova rota de
  tela não justifica introduzir react-router (nova dependência + refactor de
  todas as tabs) — custo alto para 1 rota.
- **Alternatives considered**:
  - *react-router*: padrão de mercado, mas refatoraria navegação das 10 tabs
    existentes para atender uma rota nova; rejeitado nesta feature (pode ser
    reavaliado se o número de rotas de tela crescer).

## D4 — Geocodificação de endereços: **BrasilAPI CEP v2 (primária) + Nominatim/OSM (fallback), com cache persistente**

- **Decision**: módulo `geocoding.js` na raiz (padrão de módulos planos da
  plataforma) que:
  1. extrai endereços do prospect (`cnpjRawData`: logradouro/numero/bairro/
     municipio/uf/cep — premium apenas) e resume comercial (`city`/`state`);
  2. geocodifica com **BrasilAPI `GET /cep/v2/{cep}`** (já usada pela plataforma
     em `cnpj-enrichment.js`/`lead-enrichment.js`; retorna coordenadas
     street-level quando disponíveis e city-level sempre);
  3. cai para **Nominatim (OSM)** estruturado quando o CEP não resolve a rua;
  4. cacheia resultado em nova tabela Prisma `GeocodeCache` (chave = endereço
     normalizado), evitando repetir chamadas externas;
  5. degrada com `location: null` quando nada resolve (FR-012).
- **Rationale**: zero chaves de API (constituição V); BrasilAPI já é dependência
  de facto do projeto; Nominatim é gratuito (política de uso: máx. 1 req/s — o
  cache + demanda de um lead por vez atendem folgado).
- **Alternatives considered**:
  - *Google Geocoding API*: paga + chave; rejeitado.
  - *Geocodificar no worker Python*: espalharia a feature por outro serviço
    (constituição VI — extraia serviço só quando a carga justificar); a
    geocodificação aqui é sob demanda de UI, baixo volume.

## D5 — API da tela: **compor endpoints existentes + 1 endpoint novo** (`GET /api/prospects/:id/addresses`)

- **Decision**: a tela faz fetch paralelo do que já existe —
  `GET /api/prospects/:id/enrichment` (fatos v2), `GET /api/enrichment/graph/:cnpj`
  (perfil/grafo, já com masking de trial aplicado no servidor) e os dados do
  prospect já carregados nas listas — mais **um endpoint novo** para endereços
  geocodificados: `GET /api/prospects/:id/addresses` (escopo por `orgId`,
  masking por plano; trial recebe apenas cidade/UF coarse — o endereço completo
  já é retido do trial hoje via `cnpjRawData → null`).
- **Rationale**: minimiza backend novo (YAGNI) e mantém cada fonte com seu
  masking já testado (`maskProspectForTrial`, `maskCompanyGraphForTrial`).
  Fetch paralelo + seções independentes atendem SC-001 (≤2s) e FR-015.
- **Alternatives considered**:
  - *Endpoint agregador único* `/detail`: menos round-trips, mas duplicaria
    masking/agregação já existentes e acoplaria as seções a uma falha só
    (contra FR-015).

## D6 — Estrutura de componentes frontend

- **Decision**: nova pasta `apps/web/src/components/lead/` com a tela
  (`LeadDetailScreen.tsx`) e uma seção por componente
  (`LeadOverview`, `LeadIntelligence`, `LeadFirmographics`, `LeadDigitalPresence`,
  `LeadContacts`, `LeadAddresses`, `LeadPeople`, `LeadFinancials`,
  `LeadRelationshipGraph`, `LeadLocationMap`, `LeadEvidence`). As listas
  (Dashboard/Prospecção/Pipeline) passam a navegar para a tela; o botão "Ver
  grafo de enriquecimento completo" e o `EnrichmentGraphModal` são aposentados
  (FR-009), com o conteúdo do modal redistribuído nas seções.
- **Rationale**: seções independentes = carregamento/erro/vazio por seção
  (FR-015) e testabilidade por história (US2–US5 mapeiam para seções).

## D7 — Testes e validação

- **Decision**: seguir a constituição (III): testes na plataforma com
  `node --test` antes da implementação correspondente — `test/geocoding.test.js`
  (extração/normalização/cache/fallback com fetch mockado) e
  `test/lead-addresses.test.js` (endpoint: escopo org, masking trial, degradação).
  No web, o gate existente é `tsc && vite build`; validação da UX pelos
  cenários do `quickstart.md`.
- **Rationale**: o repo não tem teste de componentes React hoje; introduzir
  framework de teste de UI agora violaria YAGNI sem pedido da spec.

## Consequências de dependência (constituição VI)

| Dependência nova | Onde | Justificativa resumida |
|------------------|------|------------------------|
| `maplibre-gl` | `apps/web` | US5 exige mapa 3D (pitch/rotação); open source, sem chave |
| `@xyflow/react` | `apps/web` | US4 exige grafo interativo; MIT, idiomático React |

Nenhuma outra dependência nova (sem react-router, sem lib de geocodicação,
sem novo serviço).
