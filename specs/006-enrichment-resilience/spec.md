# Feature Specification: Resiliência e Observabilidade do Enriquecimento

**Feature Branch**: `006-enrichment-resilience`

**Created**: 2026-09-20

**Status**: Draft

**Input**: "Primeiro temos que mitigar os 756 jobs PARTIAL e as 1869 tasks FAILED. A premissa: uma task nunca pode falhar mesmo que o serviço/etapa de enriquecimento falhe! Quando a etapa de enriquecimento falha por timeout ou algo do tipo, deve ser gerado um novo evento para retry posterior. Além disso, devemos implementar um dashboard Grafana com detalhes dos processos que falharam, que estão travados e que tiveram sucesso, e notificar os que falharam."

## Contexto (o problema hoje)

O motor de enriquecimento distribuído (feature 001) tem hoje uma janela de retry de
**~6 minutos** (4 tentativas: 5s, 15s, 60s, 300s). Problemas reais dos provedores
duram mais que isso: o circuit breaker do People Data Labs abre cronicamente por
rate limit (cota gratuita ~10/min), a busca full-text da base RFB via MCP está
operando com timeouts de 45s, e instabilidades de provedores externos duram horas.
Quando a janela se esgota, a task vai a **`FAILED` terminal** — e nunca mais é
reprocessada. Resultado atual: **1.869 tasks FAILED** (contra 1.525 concluídas) e
**756 jobs PARTIAL** (B2Base 726, Trade Marketing 30) que jamais chegam a 100% —
a "fila travada" visível para todas as orgs.

Além disso, as duas etapas de OSINT profundo (bbot, até 300s; spiderfoot, até 600s)
estouram o orçamento de tempo e geram `TIMEOUT` tratado como falha — embora os
eventos coletados até o estouro sejam dados válidos e utilizáveis. E, por fim, não
existe visão consolidada do estado do enriquecimento (concluído / falhado / travado)
nem notificação proativa quando algo falha de verdade.

**Premissa desta feature (inegociável): uma task de enriquecimento nunca termina
`FAILED` por erro transitório** (timeout, rate limit, circuito aberto, provedor
indisponível, erro de rede). Falha transitória gera novo evento para retry
posterior, até succeeded. Falha não-transiente (entrada inválida, recurso não
encontrado, regra de negócio) permanece terminal — e é notificada.

## Clarifications

### Session 2026-09-20

- Q: Por qual canal as notificações de falha devem chegar à operação? → A: E-mail + Slack — alertas em tempo real via webhook de Slack (falha real, circuito aberto > 1h) e digest diário consolidado por e-mail (infra transacional existente).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Task nunca termina FAILED por erro transitório (Priority: P1)

Quando uma etapa de enriquecimento falha por erro transitório (timeout, rate limit,
circuito de provedor aberto, provedor indisponível, erro de rede) e as tentativas
immediatas se esgotam, a task **não** vai a `FAILED`: ela entra em estado de
espera programada (`PARKED`) e um processo periódico (sweeper) re-publica novas
oportunidades de execução, respeitando o tempo de espera que o próprio provedor
recomenda (quando informado). A task só sai de parked quando conclui com sucesso.
Falha não-transiente (entrada inválida, recurso inexistente) continua terminal e é
notificada como falha real. Cada ciclo de retry é registrado para auditoria
(tentativa, erro, provedor, próximo momento).

**Why this priority**: é a premissa do produto — dado de lead não pode ser perdido
por instabilidade de terceiro; é o que elimina a criação de novos travados.

**Independent Test**: com um provedor simulado fora do ar por 1h, a task não fica
`FAILED`; ao provedor voltar, a task conclui no próximo ciclo sem intervenção.

**Acceptance Scenarios**:

1. **Given** uma task cujas tentativas imediatas se esgotaram com erro `RATE_LIMIT`/`PROVIDER_CIRCUIT_OPEN`/`TIMEOUT`/`NETWORK_ERROR`, **When** o sweeper roda, **Then** a task é re-publicada para execução respeitando o intervalo do provedor, e seu histórico de tentativas cresce com registro do motivo.
2. **Given** o provedor volta a operar, **When** a task parked é re-publicada, **Then** ela conclui com sucesso e o job recalcula seu estado (de degradado para concluído) sem intervenção manual.
3. **Given** uma task com erro não-transiente (ex.: empresa inexistente na base), **When** as tentativas se esgotam, **Then** ela fica terminal como hoje, vai ao registro de falhas reais e dispara notificação (User Story 5).
4. **Given** um lote de centenas de tasks parked do mesmo provedor, **When** o sweeper as re-publica, **Then** a taxa de re-publicação respeita o limite do provedor (nenhuma rajada que reabra o circuito).

---

### User Story 2 — Backlog atual volta ao processamento (Priority: P1)

As 1.869 tasks `FAILED` com erro transitório e as capabilities faltantes dos
756 jobs `PARTIAL` são re-enfileiradas (uma vez, de forma idempotente e
escalonada) pelo novo mecanismo de retry. Conforme cada task conclui, os jobs
recalculam seu estado para concluído. Tasks `FAILED` não-transientes e jobs
cancelados permanecem de fora. O re-enfileiramento não duplica dados
(merge idempotente já existente) e não reenriquece leads que avançaram de estágio
desde a falha — apenas complementa os fatos.

**Why this priority**: mitiga o acúmulo existente — sem isso, o parc+retry só
impede novos travados e os 756 continuam lá.

**Independent Test**: rodar o reenfileiramento uma vez e observar, nas horas
seguintes, os jobs PARTIAL recalculando para concluído conforme as tasks
reprocessadas chegam; rodar de novo não cria processamento duplicado.

**Acceptance Scenarios**:

1. **Given** tasks `FAILED` cujo último erro é transiente, **When** o reenfileiramento roda, **Then** elas voltam ao estado de processamento (respeitando rate limit dos provedores) e seus jobs recalculam o estado ao concluir.
2. **Given** um job `PARTIAL` com capabilities faltantes, **When** o reenfileiramento o processa, **Then** apenas as capabilities ausentes/falhadas-transitórias são (re)criadas e enfileiradas.
3. **Given** tasks `FAILED` com erro não-transiente (entrada inválida), **When** o reenfileiramento roda, **Then** elas permanecem de fora e aparecem no registro de falhas reais (User Story 5).
4. **Given** o reenfileiramento já executado, **When** executado novamente, **Then** nenhuma task é duplicada (idempotente).

---

### User Story 3 — Timeout de OSINT profundo não é falha (bbot/spiderfoot) (Priority: P1)

As etapas de OSINT profundo (bbot e spiderfoot) passam a operar com orçamento de
tempo: ao atingir o prazo, a task **conclui com sucesso** carregando os eventos
coletados até ali, marcada como parcial (`parcial: verdadeiro`) — nunca mais falha
por `TIMEOUT`. Além disso, o spiderfoot passa a executar apenas como complemento
quando o bbot retorna poucos/nenhum evento (em vez de rodar sempre em paralelo),
reduzindo pela metade o tempo típico da esteira profunda.

**Why this priority**: elimina a maior fonte de `TIMEOUT`/lentidão que satura a
fila e alimenta as falhas transitórias.

**Independent Test**: com o bbot lento de propósito (acima do prazo), a task
conclui no prazo com os eventos parciais; spiderfoot não roda quando o bbot
entrega conteúdo.

**Acceptance Scenarios**:

1. **Given** um scan de OSINT que excede o prazo, **When** o prazo é atingido, **Then** a task conclui com sucesso marcada como parcial, com os eventos coletados, e nenhum registro de `TIMEOUT` é gerado.
2. **Given** um bbot que concluiu com eventos suficientes, **When** a esteira avalia a etapa seguinte, **Then** o spiderfoot não é executado.
3. **Given** um bbot que concluiu vazio (domínio sem presença), **When** a esteira avalia, **Then** o spiderfoot roda como complemento.

---

### User Story 4 — Dashboard Grafana do enriquecimento (Priority: P2)

Um dashboard Grafana consolida o estado do enriquecimento para todas as orgs:
**concluídas com sucesso** (volume, taxa, duração p50/p95), **falhadas** (volume,
por provedor/capability/tipo de erro, últimas mensagens), **travadas ou aguardando**
(parked por tempo de espera, tasks ativas, jobs degradados) e **saúde dos
provedores** (estado dos circuitos, taxa de erro por provedor, profundidade das
filas). Painéis filtráveis por organização e capability, com o estado refletido em
tempo próximo (refresh automático).

**Why this priority**: dá à operação a visão contínua; depende dos indicadores
novos (User Story 1) para os estados de travadas/parked, mas pode expor o que já
existe enquanto isso.

**Independent Test**: abrir o dashboard e ver, sem consultar o banco, quantas
tasks concluíram, quantas falharam, quantas estão parked/travadas e o estado de
cada provedor — com filtros por organização.

**Acceptance Scenarios**:

1. **Given** o enriquecimento processando normalmente, **When** o dashboard é aberto, **Then** painéis mostram volume de sucesso, falhas reais e tasks em espera, com a taxa de sucesso do período e duração p50/p95.
2. **Given** um provedor com circuito aberto, **When** o dashboard é observado, **Then** o painel de provedores reflete o estado do circuito e a taxa de erro dele.
3. **Given** tasks parked aguardando retry, **When** o painel de travadas é consultado, **Then** mostra quantas estão aguardando, há quanto tempo e por qual provedor/motivo, filtrável por organização.

---

### User Story 5 — Notificação de falhas reais (Priority: P2)

Falhas reais (erro não-transiente terminal, task que esgota a janela longa de
retry sem sucesso, provedor com circuito aberto além do tolerado) geram
notificação imediata para a operação, com organização, lead/capability afetada,
erro e link de contexto — além de um resumo diário consolidado (falhas do dia,
travadas mais antigas, taxa de sucesso).

**Why this priority**: fecha o ciclo de confiabilidade — a operação só é chamada
quando há falha real que o mecanismo de retry não resolve sozinho.

**Independent Test**: forçar uma falha não-transiente em ambiente controlado e
receber a notificação com os detalhes; verificar o digest diário com o consolidado.

**Acceptance Scenarios**:

1. **Given** uma task terminal por erro não-transiente, **When** ela falha definitivamente, **Then** a operação recebe notificação imediata com organização, lead, capability e erro.
2. **Given** um provedor com circuito aberto por mais de uma hora, **When** a condição persiste, **Then** a operação recebe um alerta único (sem repetição a cada ciclo) até a condição cessar.
3. **Given** o fim de um ciclo diário, **When** o digest é gerado, **Then** a operação recebe o consolidado: concluídas, falhadas (por motivo), parked mais antigas e taxa de sucesso.

### Edge Cases

- **Provedor permanentemente fora do ar**: tasks parked do provedor acumulam com alerta único ao operador; o lead não é perdido — permanece visível como "aguardando provedor".
- **Lead avança de estágio antes do retry chegar**: o resultado tardio complementa os fatos via merge idempotente já existente; nenhum dado é sobrescrito por versão antiga (`enrichmentVersion`).
- **Task parked cujo lead foi excluído**: o sweeper descarta silenciosamente ao detectar a ausência (sem notificação de erro).
- **Reenfileiramento concorrente com a esteira normal**: reuso do mesmo caminho de publicação com deduplicação por tentativa/timestamp — nenhuma task duplicada.
- **Falha não-transiente mal classificada como transitória**: janela longa de retry esgota; task sai de parked para falha real e notifica (não fica em loop infinito).
- **Rajada de park após incidente de provedor**: sweeper limita a taxa de re-publicação por provedor (guarda-chuva contra reabrir o circuito).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Task de enriquecimento com erro transiente (timeout, rate limit, circuito aberto, provedor indisponível, erro de rede) cujas tentativas imediatas se esgotam MUST entrar em estado de espera programada (`PARKED`), nunca `FAILED`.
- **FR-002**: O sistema MUST manter um sweeper periódico que re-publica tasks `PARKED` para execução, respeitando o intervalo recomendado pelo provedor (`retryAfterMs`) quando existente e um intervalo mínimo configurável caso contrário.
- **FR-003**: A re-publicação pelo sweeper MUST ser limitada em taxa por provedor, de modo a não reabrir circuitos nem estourar cotas.
- **FR-004**: Task `PARKED` MUST concluir com sucesso assim que uma execução re-publicada for bem-sucedida, recalculando o estado do job (de degradado para concluído) automaticamente.
- **FR-005**: Task com erro não-transiente (entrada inválida, recurso inexistente, regra de negócio) permanece terminal como hoje e MUST ser registrada como falha real.
- **FR-006**: Task `PARKED` que esgota a janela longa de retry (configurável, padrão 72 horas) sem sucesso MUST sair de parked, tornar-se falha real e disparar notificação — sem loop infinito.
- **FR-007**: Cada ciclo de retry MUST registrar tentativa, erro, provedor e próximo momento agendado, consultável no histórico da task.
- **FR-008**: O reenfileiramento do backlog existente MUST ser idempotente, escalonado no tempo (sem rajada) e limitado a: tasks `FAILED` com último erro transiente e capabilities faltantes/falhadas-transitórias de jobs `PARTIAL`.
- **FR-009**: Jobs com tasks pendentes/parked MUST refletir estado intermediário (degradado/aguardando) em vez de `PARTIAL` terminal, preservando compatibilidade com consumidores do estado atual durante a transição.
- **FR-010**: As etapas de OSINT profundo (bbot/spiderfoot) MUST operar com orçamento de tempo: ao atingir o prazo, a task conclui com sucesso carregando os eventos coletados, marcada como parcial.
- **FR-011**: O spiderfoot MUST executar apenas como complemento quando o bbot retornar vazio/insuficiente (não mais em paralelo incondicional).
- **FR-012**: O sistema MUST expor indicadores (métricas) do enriquecimento: concluídas/falhadas/parked por provedor, capability e organização; duração p50/p95; estado e taxa de erro por circuito de provedor; profundidade das filas de tasks.
- **FR-013**: O dashboard Grafana MUST apresentar painéis de sucesso, falhas reais e travadas/aguardando, com filtros por organização e capability, provisionado como código (versionado no repositório de infraestrutura).
- **FR-014**: Falha real (FR-005, FR-006) MUST gerar notificação imediata à operação contendo organização, lead, capability, erro e referência de contexto.
- **FR-015**: Condição persistente (circuito aberto > 1h, mesmo provedor falhando repetidamente) MUST gerar alerta único (deduplicado até a condição cessar).
- **FR-016**: Digest diário MUST consolidar: concluídas, falhadas por motivo, parked mais antigas e taxa de sucesso, por organização.
- **FR-017**: Alertas em tempo real MUST ser entregues via webhook de Slack e o digest diário por e-mail (infra transacional existente); falha de entrega da notificação não pode afetar o enriquecimento.
- **FR-018**: Métricas, dashboard e notificações MUST respeitar isolamento por organização nos detalhes: usuários finais veem apenas os agregados e detalhes da própria organização; o canal de operação (interno à plataforma) recebe os detalhes completos dos alertas (organização, lead, capability, erro), pois é quem opera o serviço para todos os clientes.

### Key Entities *(include if feature involves data)*

- **Task de enriquecimento (existente)**: ganha o estado de espera programada (`PARKED`) com agendamento de próxima tentativa (`próximo momento`), contador de ciclos parked e histórico de tentativas (erro, provedor, agendamento) — hoje o histórico existe de forma limitada no `lastError`.
- **Job de enriquecimento (existente)**: ganha estado intermediário de degradado/aguardando entre "em processamento" e concluído, recalculado automaticamente quando tasks parked concluem.
- **Sweeper de retry (novo processo)**: varredura periódica que re-publica tasks parked vencidas, com limitação de taxa por provedor e registro de cada re-publicação.
- **Registro de falhas reais (novo, sobre o ledger existente)**: falhas terminais não-transientes com referência para notificação; alimentando painel e digest.
- **Dashboard e alertas (novo, infra de monitoramento)**: definição do dashboard Grafana e das regras de alerta versionadas como código no repositório de infraestrutura.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nenhuma task nova entra em `FAILED` por erro transiente a partir do release (zero ocorrências em 7 dias de operação, verificado por métricas).
- **SC-002**: Dos 756 jobs `PARTIAL` existentes, pelo menos 95% recalculam para concluído dentro de 7 dias após o reenfileiramento.
- **SC-003**: Tasks de OSINT profundo com `TIMEOUT` como desfecho caem em pelo menos 80% (concluem como parciais bem-sucedidas).
- **SC-004**: O dashboard Grafana reflete eventos de enriquecimento com atraso máximo de 1 minuto e carrega por organização/capability sem erro.
- **SC-005**: 100% das falhas reais geram notificação recebida em até 5 minutos; nenhuma notificação duplicada para a mesma ocorrência.
- **SC-006**: O tempo total de enriquecimento profundo por lead cai em pelo menos 30% (spiderfoot como fallback em vez de paralelo).

## Assumptions

- A infraestrutura de monitoramento do cluster (Prometheus + Grafana) já existe e aceita dashboards provisionados como código; o enriquecimento já publica métricas prom-client (base a estender).
- O canal de e-mail transacional existente é reutilizado para digest e notificações; o webhook de Slack é um endpoint de entrada configurável por variável de ambiente.
- Erros não-transientes são a minoria das falhas (as 1.869 FAILED são majoritariamente transitórias — PROVIDER_CIRCUIT_OPEN/RATE_LIMIT/TIMEOUT dominam).
- O mecanismo de merge idempotente dos resultados (por versão de enriquecimento) permanece como está; o retry tardio não sobrescreve dados mais novos.
- Falha de entrega de notificação (e-mail/Slack fora do ar) é apenas logada — nunca bloqueia ou derruba o enriquecimento.
