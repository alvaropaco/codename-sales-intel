# Descoberta de empresas por CNAE (MCP-CNPJ)

Depois do onboarding (que captura segmentos e CNAEs-alvo), a SalesIntel usa um
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
| GET | `/api/discovery/candidates` | Empresas reais por CNAE/segmento/região |
| POST | `/api/discovery/import` | Adiciona empresa descoberta como prospecto |
| POST | `/api/prospects/:id/enrich-mcp` | Enriquece prospecto existente via MCP |
| GET | `/api/discovery/stats` | Agregados do dataset |

`/api/discovery/candidates` sem parâmetros usa o perfil do onboarding como
critério. Também aceita `?segment=&location=&cnae=&limit=` para busca manual.

## Frontend

Em **Descobrir empresas**, o card "Empresas descobertas agora" carrega sugestões
reais via MCP a partir dos critérios do onboarding (ou do nicho/lugar digitado)
e permite adicioná-las à lista de prospectos.

## Segurança

- Token fora do versionamento (`.env.local` + `.gitignore`).
- Nenhum dado mockado: descoberta mostra apenas empresas reais retornadas pelo MCP.
