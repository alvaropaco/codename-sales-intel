# Contract — Worker SDK (`workers/sdk/`)

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Objetivo: um worker novo contém **apenas lógica de negócio**; toda preocupação de infraestrutura é do runtime (FR-019). JavaScript puro (CommonJS, padrão dos módulos da raiz), testável por injeção de dependências (padrão `test/lead-enrichment.test.js`).

---

## 1. API do runtime

```js
// workers/identity.js — exemplo de worker completo
const { createWorkerRuntime } = require("./sdk/runtime");
const capabilities = require("../enrichment-capabilities").families.identity;

const runtime = createWorkerRuntime({
  name: "identity",                 // família; define durable: enrichment-engine-identity
  filter: "enrichment.task.identity.>",
  capabilities,                     // mapa capability → definição (abaixo)
  deps: { prisma, js, redis, rawStore, logger, metrics }, // injetáveis p/ teste
  concurrency: 8,                   // semáforo próprio do processo
  fetchBatch: 10,
  drainTimeoutMs: 30000,            // graceful shutdown: termina tasks em voo, depois ack/exit
});

runtime.start();                    // conecta, garante stream/consumer, loop de fetch
// runtime.stop() — chamado em SIGTERM (graceful drain antes de sair)
```

Garantias do runtime (todas testadas isoladamente):

1. **Validação antes de executar** — capability existe, `entityType` suportado, `input` contra o schema do catálogo; inválido → `FAILED` permanente (`INVALID_INPUT`), ack imediato (nunca retritável).
2. **Timeout/abort** — executa a capability com `AbortSignal` ligado a `timeoutMs` da task; estouro → `TIMEOUT` (transiente).
3. **Idempotência** — se `EnrichmentResult` já existe para `taskId` (upsert por `@@unique`), a execução é atalho: publica result e ack (redelivery não reexecuta provider).
4. **Persist → publish → ack** — grava `EnrichmentResult` + `EnrichmentEvidence` + `RawRecord` (via `rawStore`), publica `enrichment.result.v1`, **então** ack. Falha em qualquer etapa → `nak(delay)` conforme backoff; esgotado → `term()` + DLQ.
5. **Rate limit/circuit breaker por provider** — chama `providerRegistry.acquire(provider)` antes de `execute`; `PROVIDER_CIRCUIT_OPEN`/`RATE_LIMIT` → erro transiente sem chamar o provider (o ticket só é consumido se a chamada sair).
6. **Métricas/logs** — duração, resultado e tentativa por capability; logs JSON com `X-Org-Id`/`X-Job-Id`/`X-Task-Id`/`traceparent` propagados.

## 2. Definição de capability (catálogo: `enrichment-capabilities.js`)

```js
"identity.cnpj.resolve": {
  family: "identity",
  tier: "basic",                    // basic | premium — gating por plano (FR-033)
  entityType: ["prospect", "company"],
  timeoutMs: 45000,
  maxAttempts: 3,
  priority: 1,
  providers: ["searxng.rfb", "brasilapi.cnpj"],   // ordem = preferência; registry decide saúde/limite
  inputSchema: { companyName: "string", state?: "string" },
  expand: [                          // regras declarativas de expansão (R7) — avaliadas pelo MANAGER
    { whenFact: "company.cnpj", spawn: "identity.cnpj.basic", tier: "basic" },
    { whenFact: "company.domain", spawn: "identity.domain.verify", tier: "basic" },
  ],
  async execute(task, ctx) {
    // SOMENTE lógica de negócio aqui
    return {
      status: "COMPLETED",
      data: { cnpj: "12.345.678/0001-90" },
      facts: [{ attribute: "company.cnpj", value: "12345678000190",
                confidence: 0.95,
                evidence: { sourceType: "rfb", url: null, retrievedAt: new Date() } }],
      raw: { contentType: "application/json", body: rawProviderResponse },
      suggestedTasks: [],            // opcional; manager valida contra catálogo/limites
    };
  },
}
```

`ctx` fornecido pelo runtime:

| Campo | Papel |
|---|---|
| `ctx.logger` | logger JSON já vinculado à correlação da task |
| `ctx.signal` | `AbortSignal` do timeout |
| `ctx.rawStore` | `put({contentType, body}) → rawRecordId` (bruto sai do payload do result — só a referência trafega) |
| `ctx.providers` | `acquire(name) → ticket` com rate limit + circuit; `ticket.release()` |
| `ctx.deps` | `prisma`, `redis` etc. — somente leitura de contexto do task; workers não escrevem job/task do manager |

## 3. Regras invioláveis (espelham a spec)

- Um processo worker serve **uma família** de capabilities e é **stateless** entre tasks (FR-014).
- Nenhuma chamada síncrona a outro worker; nenhuma orquestração; nenhuma publicação de task (FR-015, R7).
- Nenhuma decisão de qualificação (FR-030) e nenhuma escrita em resultados de outras tasks (spec §9).
- Nenhuma credencial lida do payload — providers resolvem segredos de env (constituição V).
- `execute` nunca lança para falha de negócio: retorna `status: "FAILED"` com a taxonomia de erro; exceções imprevistas = `INTERNAL` (transiente) e são tratadas pelo runtime.

## 4. Ponte com o worker Python (`company.deepgraph`)

Capability cujo `execute` publica `enrichment.company.requested.v1` (contrato legado, com `tenant_id` preenchido) e aguarda a conclusão correlacionada (`enrichment.company.completed/partial/failed.v1` via ledger `EnrichmentRequest`) dentro de `timeoutMs` — o serviço Python é tratado como **provider** sem nenhuma mudança nele (R12).
