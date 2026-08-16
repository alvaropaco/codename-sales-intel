# Integração com o Pipeline de Enriquecimento (NATS JetStream)

Este documento descreve como o SalesIntel Platform se integra ao pipeline
`enrichment-worker` via NATS, e como habilitá-lo no deploy (Coolify).

## Arquitetura

```
+-----------+   enrichment.company.requested.v1 (cnpj, company_id, Nats-Msg-Id)
|   backend | ───────────────────────────────────────────────────────────►  NATS (ENRICHMENT)
|  (Express)|                                                                     │
+-----------+                    enrichment.company.completed.v1                 │
          ▲  ◄──────────────────────────────────────────────────────────  enrichment-worker
          │
    consumer durável "salesintel-results"
    (persiste idempotente + ACK)
```

Quando **um lead entra na esteira de "Em Qualificação"** (status `prospect`
no kanban), o backend publica um pedido de enriquecimento. O worker processa
(firmografia + descoberta + scoring) e publica o resultado em
`enrichment.company.completed.v1`. Nosso **consumer durável exclusivo**
(`salesintel-results`) consome, persiste de forma idempotente e dá ACK.

## O que foi implementado

| Arquivo | Papel |
|---------|-------|
| `nats-enrichment.js` | Módulo de integração (publish + consumer + DLQ monitor) |
| `server-prod.js` | Dispara o publish quando um lead entra em "Em Qualificação"; inicia consumer e DLQ no boot |
| `prisma/schema.prisma` | Modelo `CnpjEnrichment` (resultados, chave única `companyId + enrichmentVersion`) + campo `enrichmentVersion` em `Prospect` |
| `prisma/migrations/20260813180000_add_nats_enrichment/` | Migração do schema |

### Trigger de enriquecimento
Em **`server-prod.js`**:
- `POST /api/prospects`: cria o prospect (status `prospect` = Em Qualificação) e publica.
- `PUT /api/prospects/:id`: quando o `status` passa a ser `prospect` (movimento no kanban), publica.
- `POST /api/prospects/:id/enrich`: envia o pedido manualmente.

### Regras de ouro seguidas
1. **At-least-once / idempotência**: a persistência usa a chave única
   `(companyId, enrichmentVersion)` — a mesma mensagem reentregue não duplica.
2. **ACK só após persistir**: só `ack()` depois do `upsert` + aplicação no
   `Prospect`. Em erro, `nak()` para reentrega.
3. **Durable name exclusivo**: `salesintel-results` (não reutiliza `enrichment-worker`).
4. **Status**: `COMPLETED`, `PARTIAL`, `FAILED`, `DISCARDED` são mapeados
   para `enriched`, `partial`, `error` no `Prospect`.
5. **Dedup no envio**: header `Nats-Msg-Id = event_id` (replay dentro de 2 min ignorado).
6. **DLQ**: monitora `enrichment.company.dlq.v1` (ex.: CNPJ inválido) e loga.

## Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `NATS_URL` | `nats://legal-nats...:4222` | Endereço do NATS |
| `NATS_ENABLED` | `false` | `true` liga publish + consumer (desliga cai no enriquecimento BrasilAPI síncrono) |
| `NATS_STREAM` | `ENRICHMENT` | Nome do stream JetStream |
| `NATS_DURABLE` | `salesintel-results` | Nome do consumer durável |
| `NATS_REQUEST_SUBJECT` | `enrichment.company.requested.v1` | Subject de pedidos |
| `NATS_COMPLETED_SUBJECT` | `enrichment.company.completed.v1` | Subject de resultados |
| `NATS_DLQ_SUBJECT` | `enrichment.company.dlq.v1` | Subject de DLQ |
| `NATS_BATCH` | `20` | Lote de mensagens por fetch |
| `NATS_FETCH_TIMEOUT_MS` | `5000` | Timeout do fetch (pull) |

## Como habilitar no deploy (Coolify)

No app do Coolify (VPS), adicione/variáveis as variáveis abaixo — **não** edite
`.env`/`.env.local` do repositório para produção; use o painel do Coolify:

```
NATS_ENABLED=true
NATS_URL=<endereço acessível do NATS, ex.: nats://<host>:4222 ou via túnel/ingress>
NATS_STREAM=ENRICHMENT
NATS_DURABLE=salesintel-results
```

> ⚠️ O `NATS_URL` de exemplo (`legal-nats.laweragent.svc.cluster.local`) é um
> endereço interno de cluster Kubernetes. No VPS via Coolify você deve usar o
> endereço público/roteável do NATS (DNS, IP + porta 4222, ou um túnel).
> Se ainda não houver um NATS acessível, mantenha `NATS_ENABLED=false`: o app
> continua funcionando com o enriquecimento síncrono BrasilAPI (fallback).

## Bancos de dados

A migração cria a tabela `CnpjEnrichment` e adiciona `enrichmentVersion` em
`Prospect`. Ao subir em produção:

```bash
pnpm --filter api prisma migrate deploy
```

## Grafo completo de enriquecimento (UI)

Além do resumo (`enrichment.company.completed.v1`), o worker persiste o **grafo
completo** (entidades, fatos, relacionamentos e perfil agregado) no PostgreSQL do
pipeline. A view `company_enrichment.v_company_graph` denormaliza o perfil mais
recente por empresa para leitura direta pela API.

| Variável | Descrição |
|----------|-----------|
| `ENRICHMENT_DATABASE_URL` | Conexão read-only ao PostgreSQL do worker (schema `company_enrichment`). Ex.: `postgresql://<user>:<pass>@<host>:5432/legal_mcp` |

Sem essa variável, o endpoint `GET /api/enrichment/graph/:cnpj` degrada
graciosamente (`available: false`) e a UI exibe o estado vazio correspondente.

No frontend, o botão **“Ver grafo de enriquecimento completo”** (drawer do
prospect) abre o `EnrichmentGraphModal`, que consome esse endpoint e exibe
firmografia, presença digital, contatos, tecnologias, quadro societário,
indicadores, rede de relacionamentos e evidências com confiança/proveniência.

## Endpoints úteis

- `GET /api/enrichment/status/:id` — status do enriquecimento de um prospect e histórico de resultados.
- `POST /api/prospects/:id/enrich` — força o envio do pedido de enriquecimento.

## Monitoramento

O consumer roda em background no mesmo processo do servidor. Logs:
- `[nats] pedido publicado ... event=<id>` — publish feito.
- `[nats] consumindo ... (durável=salesintel-results)` — consumer ativo.
- `[nats][DLQ] ...` — mensagens rejeitadas na DLQ (vale monitorar).
