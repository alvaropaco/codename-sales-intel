# Descoberta de empresas por CNAE (MCP-CNPJ)

Depois do onboarding (que captura segmentos e CNAEs-alvo), a B2Base usa um
servidor MCP externo de dados empresariais brasileiros para descobrir empresas
reais com potencial de compra e para enriquecer empresas já cadastradas.

## Fonte de dados

- Endpoint MCP (streamable HTTP): `https://mcps.0xcloud.net/mcp`
- Base: dados abertos de CNPJ da Receita Federal (≈2,9 mi de empresas, 28 UFs)
- Ferramentas usadas: `search_companies` (busca semântica), `filter_companies`
  (filtro por UF/cidade/situação/CNAE), `get_company_by_cnpj` (lookup exato),
  `stats` (agregados).

## Configuração

O token de acesso é um segredo e **não fica no repositório**. Ele é lido de
`process.env` (ou de `.env.local`, ignorado pelo git):

```
CNPJ_MCP_URL=https://mcps.0xcloud.net/mcp
CNPJ_MCP_TOKEN=<seu-token>
```

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/discovery/profile` | Critérios do onboarding (CNAEs/segmentos/regiões) |
| GET | `/api/discovery/candidates` | Leads reais por CNAE/segmento/região (paginado) |
| POST | `/api/discovery/import` | Adiciona lead descoberto à lista |
| POST | `/api/prospects/:id/enrich-mcp` | Enriquece lead existente via MCP |
| GET | `/api/discovery/stats` | Agregados do dataset |

`/api/discovery/candidates` sem parâmetros usa o perfil do onboarding como
critério. Também aceita busca manual e paginação:

- `?segment=&location=&cnae=` para busca manual;
- `&page=1` (padrão 1) e `&pageSize=12` (padrão 12, máx. 25) para paginar;
- `&seed=<token>` para rotacionar a ordem dos resultados — um seed novo
  ("Buscar novamente") revela uma outra ordem do mesmo pool, enquanto o mesmo
  seed mantém a paginação estável.

O servidor busca uma janela ampla do MCP (filtro por CNAE até 100 registros,
busca semântica até 40), exclui CNPJs que já estão na lista de leads e devolve
`total`, `totalPages`, `hasMore` para montar a paginação no cliente.

## Frontend

Em **Descobrir leads**, o bloco "Leads descobertos agora" carrega sugestões
reais via MCP a partir dos critérios do onboarding (ou do nicho/lugar digitado)
em uma listagem paginada — o cliente pode navegar por todas as páginas — e
permite adicioná-las à lista de leads.

## Segurança

- Token fora do versionamento (`.env.local` + `.gitignore`).
- Nenhum dado mockado: descoberta mostra apenas empresas reais retornadas pelo MCP.
