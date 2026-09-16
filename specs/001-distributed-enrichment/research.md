# Research — Plataforma Distribuída de Enriquecimento de Leads

Feature: `001-distributed-enrichment` · Data: 2026-09-16
Base: [spec.md](./spec.md), [plan.md](./plan.md), levantamento do codebase (.estado atual documentado inline).

Não restou nenhum `NEEDS CLARIFICATION` da spec; as decisões abaixo resolvem os pontos de desenho que a spec deliberadamente deixou para o plan. Todas validam contra a constituição (referências I–VII entre parênteses).

---

## R1 — Runtime dos workers novos: Node na plataforma, não serviço novo

**Decision**: workers de capability são processos Node (mesma imagem da plataforma, entrypoint `node workers/<família>.js`). O worker Python existente continua sendo o executor do deep-graph OSINT, acoplado como *provider* (R12).

**Rationale**: as capabilities da fase 1 são I/O-bound (HTTP/DNS/API) — o gargalo é concorrência, não CPU; a convenção do repo é módulo plano na raiz (VI); criar um serviço novo multiplicaria pipeline de CI/CD, chart Helm e ritual de release sem necessidade.

**Alternatives considered**: (a) novo serviço Python para todos os workers — rejeitado: custo de ops sem carga que justifique (VI); (b) TypeScript — rejeitado: a raiz é JS puro, mudança de stack transversal sem ganho para esta feature; (c) BullMQ para tudo — rejeitado: o requisito é barramento de eventos com consumers duráveis e contratos versionados, papel do NATS JetStream que já opera em produção (II).

## R2 — Scheduler como módulo da plataforma (não deployment próprio)

**Decision**: `enrichment-manager.js` é um módulo Node carregado pelo processo da plataforma; é o único escritor do ciclo de vida de `EnrichmentJob`/`EnrichmentTask`.

**Rationale**: os 5 pontos de disparo atuais (`POST /prospects`, enrich manual, transição de estágio, pós-CSV, discovery) já vivem em `server-prod.js` — `dispatchEnrichmentForPlan` permanece como fachada e passa a delegar ao manager (evolução, não substituição — VI). O isolamento de falha requerido pela spec não depende de processo separado: workers nunca chamam o manager, só o barramento. Sob pressão de escala, o manager extrai-se para deployment próprio **sem mudança de contrato** (mesmo código, entrypoint diferente) — a decisão de agora não fecha essa porta.

**Alternatives considered**: microsserviço `enrichment-manager` desde o dia 1 — rejeitado: camada nova de deploy/observabilidade antes de qualquer evidência de carga (VI).

## R3 — Contratos de evento: novos subjects `*.v1` no stream `ENRICHMENT` existente

**Decision**: o stream JetStream `ENRICHMENT` (retention 7d, subjects `enrichment.>`) já cobre os novos subjects — nenhum stream novo:
- `enrichment.task.<capability>.v1` (capability com pontos = tokens NATS; ex.: `enrichment.task.identity.cnpj.resolve.v1`)
- `enrichment.result.v1` (resultado unificado; correlation completa no payload/headers)
- `enrichment.job.completed.v1` (agregado para consumidores externos, ex. futuros)
- `enrichment.task.dlq.v1` (poison messages via `term()`)

Contratos legados (`enrichment.company.{requested,completed,partial,failed,discarded,dlq}.v1` e do modo grafo) permanecem intocados — coexistência, evolução futura por `.v2` (II). JSON Schemas dos payloads ficam em `contracts/` para um futuro job de CI de compatibilidade (padrão já existente no `cnpj-data-publisher`).

**Rationale**: reusar o stream e a convenção de versão evita reconfiguração de infra e mantém um único domínio de subjects de enriquecimento.

**Alternatives considered**: subject por capability de resultado (`enrichment.result.<capability>.v1`) — rejeitado para v1: multiplica consumers duráveis sem consumidor real hoje; o campo `capability` no payload cobre filtragem, e o subject genérico pode coexistir com específicos depois (`.v2`).

## R4 — Idempotência determinística em três camadas

**Decision**: (1) `taskKey = uuidv5(NAMESPACE_ENRICHMENT, orgId|jobId|entityKey|capability|provider|inputHash)` — uuidv5 implementado localmente (~10 linhas, SHA-1), sem dependência nova; (2) header `Nats-Msg-Id = taskId` (dedup server-side do JetStream); (3) `@@unique([taskKey])` em `EnrichmentTask` + upsert idempotente de `EnrichmentResult` por `taskId` — espelhando o padrão comprovado de `CnpjEnrichment @@unique([companyId, enrichmentVersion])` e a proteção de reordering por versão.

**Rationale**: redelivery do barramento e replanejamento do job (crash do manager entre publish e persist) não podem criar estado duplicado (II; spec FR-008/SC-004).

**Alternatives considered**: `uuid` como dependência — rejeitado (VI): a implementação v5 é trivial; dedup apenas via `Nats-Msg-Id` — insuficiente: janela de dedup do JetStream é curta (2 min no padrão atual) e não protege contra replanejamento.

## R5 — Dado bruto: Postgres atrás de `raw-store.js` (S3 ativável depois)

**Decision**: `RawRecord` em Postgres (payload Text, limite configurável — default 256 KB; acima disso trunca com flag e registra `truncated`). Abstração `raw-store.js` com interface `put(record) → ref` / `get(ref)`; backends `postgres` (v1) e `s3` (MinIO, quando existir bucket para a plataforma). Escolha de backend por env `RAW_STORE_BACKEND`.

**Rationale**: a plataforma Node não tem nenhum uso de S3 hoje (verificado); MinIO só existe no chart do publisher. Introduzir bucket agora é infraestrutura sem consumidor (VI). A spec exige retenção separada e reprocessabilidade (FR-027/028, SC-011) — ambas garantidas com o backend Postgres; a exigência de "repositório de objetos" fica registrada como **desvio justificado** em plan.md/Complexity Tracking, satisfeito na fase S3.

**Alternatives considered**: S3/MinIO desde o dia 1 — rejeitado agora, aceito como evolução: o publisher já comprova o caminho (boto3 MinIO-friendly) e o gancho fica pronto.

## R6 — Rate limit + circuit breaker: Redis via ioredis (primeiro uso direto)

**Decision**: `enrichment-provider-registry.js` implementa: janela fixa por provider (`INCR` + `EXPIRE` por minuto), semáforo distribuído de concorrência (contadores com lease/TTL para auto-liberação em crash), e circuit breaker com estado em Redis (`HEALTHY → DEGRADED (erro ≥ limiar) → OPEN (TTL) → HALF-OPEN (probe) → HEALTHY`), tudo compartilhado entre instâncias. Estado é runtime-only (Redis); configuração (limites, limiares) vive no catálogo de capabilities/env. Métricas: `b2base_enrichment_provider_state{provider,state}`.

**Rationale**: a spec exige limites válidos entre instâncias (FR-022); `ioredis` já está declarada no package.json (o Redis já serve o Bull de outreach), então não há dependência nova (VI). O worker Python já demonstra o padrão de circuit breaker; a versão Node é própria e simples.

**Alternatives considered**: rate limit em memória — rejeitado: inválido com N réplicas; limitar via Postgres como faz `outreach-rate-limiter.js` — rejeitado: contagem em janela de tempo por segundo/minuto com alta frequência de escrita é papel de cache, não de OLTP.

## R7 — DAG mínimo + expansão dinâmica com limites duros

**Decision**: dependência = `dependsOn: [taskId]` em `EnrichmentTask`; task `BLOCKED` não é publicada; o manager desbloqueia ao consumir results. Expansão dinâmica: workers podem incluir `suggestedTasks` no resultado (**declarativo, nunca orquestração**); o manager valida contra o catálogo (capability existe? tier permitido? dentro dos limites `MAX_TASKS_PER_JOB` (default 200) e `MAX_DEPTH` (default 3)?) e só então cria/publish. Regras de "qual resultado gera o quê" ficam no catálogo (`enrichment-capabilities.js`), não no worker.

**Rationale**: atende FR-012/013 e a spec ("evitar workflow engine completo — construir scheduler mínimo de dependências"). A assimetria worker-sugere/manager-dispacha preserva FR-015 (worker não orquestra) e dá ao manager o ponto único de aplicação de plano, cota e limite.

**Alternatives considered**: biblioteca de workflow (Temporal etc.) — rejeitada: dependência + infra nova para um DAG de profundidade ≤3 (VI); expansão direta pelo worker publicando tasks — rejeitada: violaria FR-015 e duplicaria gating/limites.

## R8 — Escala e autoscaling: mecanismo agora, KEDA depois

**Decision**: v1 entrega o mecanismo que torna a escala possível — workers stateless, consumers duráveis, concorrência configurável por réplica, zero estado em memória — mais o gauge `b2base_enrichment_tasks_pending{capability}` (base para HPA/KEDA). Réplicas por worker: manuais no values do k8s-infra (padrão `workertype-deployment.yaml` do worker Python). Validação de carga do quickstart: ~1.000 tasks simultâneas em dev/staging; a validação de 10k+/100 réplicas (SC-002 pleno) é um marco próprio, pós-M4, quando houver ambiente de staging dimensionado.

**Rationale**: KEDA e testes de carga em produção-scale agora violariam YAGNI (VI) sem mudar nenhum contrato — a spec registra as metas como referência recalibrável no plan.

**Alternatives considered**: KEDA ScaledObject por worker já na fase 1 — rejeitado: depende de Prometheus+KEDA no cluster da plataforma, peça nova de infra para ganho que réplicas manuais cobrem no volume atual.

## R9 — Qualificação como consumidora separada com debounce

**Decision**: `qualification.js` mantém um consumer durável próprio em `enrichment.result.v1` (diferente do do manager), coalescendo recalques por prospect (debounce de poucos segundos ou imediato no `enrichment.job.completed.v1`) e chamando `recalcLeadScore` (já existe, idempotente, grava `opportunityScore` + `score_breakdown`). `commercial_potential` do worker Python continua com precedência quando presente — comportamento atual preservado.

**Rationale**: FR-030/031 — desacopla score de workers e isola sua falha (consumer próprio: erro → log/métrica/Nak→DLQ, enriquecimento segue). Reuso direto do módulo existente (VI).

**Alternatives considered**: recalcular score dentro do manager ao aplicar resultado — rejeitado: acopla dois domínios que a spec exige separados (a fachada `dispatchEnrichmentForPlan` hoje chama score inline; este é exatamente o acoplamento a remover).

## R10 — Observabilidade: correlação em headers/logs + métricas; OTel Node adiado

**Decision**: toda mensagem carrega headers de correlação (`X-Org-Id`, `X-Job-Id`, `X-Task-Id`, `X-Attempt` e `traceparent` W3C gerado no manager e propagado verbatim pelos workers). `logger.js` emite JSON estruturado com esses campos; `metrics.js` ganha contadores/gauges/histogramas do motor no registry existente (porta 9090). OTel SDK no Node: adiado — o `traceparent` já é gerado e propagado (FR-036 atendido na semântica), e o exportador entra quando o cluster tiver collector para o side Node (hoje só o worker Python tem OTEL opcional).

**Rationale**: constituição VII pede métricas + logs suficientes para diagnóstico sem dados de cliente; a infraestrutura dos dois já existe na plataforma. Novas dependências de tracing agora seriam custo sem coletor definido (VI).

**Alternatives considered**: `@opentelemetry/*` desde já — rejeitado nesta fase; manter `console.log` com prefixo — insuficiente para US8/FR-035 em milhares de tasks.

## R11 — Rollout: flag por ambiente + allowlist por organização

**Decision**: env `ENRICHMENT_ENGINE_V2` liga o motor; dentro dele, `ENRICHMENT_ENGINE_V2_ORGS` (lista) restringe a orgs específicas. Sem flag: comportamento atual byte-a-byte. A paridade (mesmo resultado final do Prospect) é o critério de migração das 5 esteiras; a fila in-process de `lead-enrichment.js` só desliga após M3.

**Rationale**: enriquecimento é caminho crítico de criação de lead; big-bang contraria VI e o padrão de toggle existente (`NATS_ENABLED`).

**Alternatives considered**: corte direto sem flag — rejeitado: sem caminho de rollback rápido.

## R12 — Ponte com o worker Python: provider via contratos legados (zero mudança nele)

**Decision**: a capability `company.deepgraph` tem como provider o worker Python atual: a task, ao executar, publica `enrichment.company.requested.v1` (contrato existente, com `tenant_id` agora preenchido) e o manager correlaciona a conclusão (`completed/partial/failed.v1` via ledger `EnrichmentRequest`) para encerrar a task (dentro do timeout da capability). Nada muda no serviço Python nesta feature; a migração dele para consumir `enrichment.task.company.deepgraph.v1` nativamente fica registrada como evolução `.v2`.

**Rationale**: FR-020 (capability ≠ provider) permite exatamente isso; evita double-publication e risco no serviço que hoje sustenta o premium (VI, estabilidade).

**Alternatives considered**: worker Python consumindo o novo subject desde já — adiado: exige mexer em Pydantic/JobRunner do serviço crítico sem ganho imediato.

---

## Desvios conscientes da spec (registrados, justificados)

1. **S3/objeto para bruto** — R5: backend Postgres primeiro, abstração pronta; satisfeito em fase posterior (desvio em Complexity Tracking do plan).
2. **OTel SDK completo no Node** — R10: correlação via headers `traceparent` + logs; exportador depois.
3. **Validação 10k tasks/100 réplicas** — R8: quickstart valida escala reduzida; validação plena é marco próprio pós-M4.

Todos os demais pontos da spec têm decisão direta acima. Nenhum `NEEDS CLARIFICATION` restante.
