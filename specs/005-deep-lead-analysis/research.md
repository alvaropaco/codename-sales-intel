# Research: Análise Profunda de Lead por IA no Pipeline

**Feature**: 005-deep-lead-analysis | **Date**: 2026-09-18

Decisões técnicas da fase de planejamento. Todas as incógnitas da spec foram
resolvidas contra o código existente do repositório (não há NEEDS
CLARIFICATION pendente — as ambiguidades de produto foram fechadas na spec).

## R1 — Onde a análise de IA roda: plataforma Node (in-process), não serviço Python

**Decision**: a análise profunda roda in-process na plataforma Node, como
módulo plano novo (`deep-analysis.js`), chamando o gateway LiteLLM via
`llm-client.js`. Nenhum worker Python novo.

**Rationale**: o caminho de IA da plataforma já é o gateway LiteLLM consumido
por `ai-campaign.js`, `whatsapp-workers.js`, `csv-import.js` e `ava-extract.js`
— todos na plataforma. `llm-client.js` já resolve timeout (AbortController),
JSON mode, log de usage e fallback de modelo. Criar um serviço Python só para
esta chamada violaria o princípio VI (Simplicidade incremental) sem ganho de
carga: a análise é 1 chamada por lead enriquecido, disparada por evento.

**Alternatives considered**:
- *Worker Python novo* (padrão `company-enrichment-worker`): rejeitado — carga
  ínfima comparada ao OSINT do enriquecimento; adicionaria deploy, contrato
  NATS novo e latência de fila sem necessidade.
- *Análise dentro do worker de enriquecimento (Python)*: rejeitado — acoplaria
  a IA de triagem comercial ao pipeline de dados oficiais; falha/slow de LLM
  atrasaria a conclusão do enriquecimento (violação do isolamento de falhas
  FR-015/edge case da spec).

## R2 — Gatilho da análise: hook nos pontos de conclusão de enriquecimento

**Decision**: extrair a decisão de "para onde o card vai ao concluir o
enriquecimento" num helper único (ex.: `statusAfterEnrichment(prospect, plan)`
em `deep-analysis.js`), usado pelos DOIS pontos que hoje fazem
`prospect → qualified`:
- `nats-enrichment.js:~303` (esteira premium NATS — `COMPLETED`/`PARTIAL`);
- `cnpj-enrichment.js:~165` (fluxo básico BrasilAPI).

Premium → `status='deep_analysis'` + enqueue da análise; outros planos →
`qualified` (comportamento atual, FR-018). A entrada manual por `PUT
/prospects/:id` (`stageTransitionError` liberando para estados terminais do
enriquecimento) também enfileira a análise.

**Rationale**: dois pontos de conclusão já existem e divergir entre eles
reproduziria bugs; um helper puro é testável sem NATS/HTTP. O padrão de
"ganchos pós-enriquecimento isolados por try/catch" já existe
(`campaignSuite.onLeadEnriched` em `nats-enrichment.js`) e é seguido.

**Alternatives considered**:
- *Consumidor NATS dedicado para um evento novo `analysis.request.v1`*:
  rejeitado — introduz contrato de evento novo sem necessidade (a plataforma
  já é a consumidora dos resultados de enriquecimento); princípio II exige
  contratos versionados para comunicação entre serviços, e aqui não há novo
  serviço.

## R3 — Persistência do resultado: tabela `DeepAnalysis` + ponteiro na Prospect

**Decision**: nova tabela `DeepAnalysis` (uma linha por execução de análise)
e `Prospect.currentDeepAnalysisId` apontando para a análise VIGENTE +
`Prospect.analysisStatus` (`not_started|running|completed|failed`) para o
estado do card. Reexecução cria nova linha e move o ponteiro.

**Rationale**: a spec exige que a reexecução substitua a vigente (FR-014) e
que o veredito permaneça visível mesmo quando o lead é descartado ou avançado
manualmente (FR-010, edge cases) — um Json solto em `Prospect` não daria
rastreabilidade de versão do modelo/data nem suportaria exibir histórico sem
reinterpretar JSON. O ponteiro explícito torna "vigente" uma consulta O(1) e
evita "última por createdAt" (sensível a relógio/ordem de escrita).

**Alternatives considered**:
- *Json único em `Prospect.enrichmentSummary`-style*: rejeitado — sobrescrever
  destruiria a análise anterior durante reanálise e misturaria domínios
  (enriquecimento ≠ análise de IA).
- *Histórico completo versionado com UI de histórico*: fora de escopo v1
  (spec/assumptions: apenas a vigente é exibida); as linhas antigas ficam
  retidas no banco, barateando uma UI de histórico futura.

## R4 — Insumos do prompt: o que a IA recebe

**Decision**: o prompt de análise recebe, como JSON compacto:
1. Contexto da org via `org-context.js` (`buildOrgContext`/`loadOrgContext`) —
   já implementa a degradação honesta exigida pela FR-017 ("NÃO CONFIGURADO —
   ... NÃO invente").
2. Lead: firmografia (`Prospect`: setor, porte, capital, idade do CNPJ,
   localização), `enrichmentSummary` (presença digital, stack, social),
   canais de contato (existência/classificação — nunca valores crus de
   e-mail/telefone no prompt de veredito; padrão da 003).
3. Insumos determinísticos como evidência: `opportunityScore` + breakdown e
   `computeContactDecision` (atingibilidade/momento/veredito determinístico +
   fatores) — a IA interpreta, não substitui a coleta.

Saída exigida em JSON mode: `{ score_final: 0-100, veredito:
"contatar"|"nao_contatar", resumo: string, impressoes: string[], fatores_pro:
string[], fatores_contra: string[] }` — validada por função pura; saída
inválida = `analysisStatus='failed'` (retry manual), nunca aplicada.

**Rationale**: `contact-decision.js` já entrega evidência explicável
(atingibilidade, momento, fatores ponderados) sem expor PII de contato — o
mesmo contrato de privacidade é estendido ao prompt. `org-context.js` já é a
fonte canônica do "contexto do usuário" citado na spec.

**Alternatives considered**:
- *IA re-capturando dados (web search etc.)*: rejeitado — a spec limita a
  análise aos dados capturados + contexto; captura é papel do enriquecimento.
- *Prompt sem insumos determinísticos*: rejeitado — perderia a ancoragem
  numérica e explicabilidade que a 003 já consolidou.

## R5 — Score final vs. score determinístico

**Decision**: `Prospect.opportunityScore` passa a receber o `score_final` da
IA quando a análise vigente conclui (premium); o score determinístico
permanece calculável e é preservado na linha `DeepAnalysis` como
`deterministicScore` (referência/comparação, FR-008). Cards e detalhes exibem
o score vigente.

**Rationale**: FR-008 pede o score da IA como exibido com o determinístico
"disponível como referência" — um campo dedicado na análise evita duplicar
colunas em `Prospect` e mantém o score legado calculável para leads de trial e
para leads pré-análise (não reanalisados retroativamente).

**Alternatives considered**:
- *Coluna nova `aiScore` em Prospect*: rejeitado — o score exibido precisa ser
  um só (kanban hoje ordena/agrupa por `opportunityScore`); duplicar exigiria
  tocar todos os consumidores do campo.

## R6 — Reconciliação de análises presas (boot) e idempotência

**Decision**: fila em memória (enqueue assíncrono, uma análise em execução por
lead) + varredura no boot re-despachando leads com
`status='deep_analysis'`/`analysisStatus='running'` travados — espelha o
padrão comprovado de `resumePendingEnrichments` (com flags
`RECONCILE_*_ON_BOOT`/`_LIMIT` equivalentes). Idempotência do gatilho: só
analisar se `enrichmentVersion` vigente não tiver análise concluída associada
ou se a reexecução for manual explícita.

**Rationale**: jobs em memória podem morrer no restart do pod; o repo já
resolveu o mesmo problema para enriquecimento (comentário em
`server-prod.js:1469-1483`). Reusar o padrão elimina a classe de bug "preso em
running para sempre".

**Alternatives considered**:
- *BullMQ/Redis para a fila*: rejeitado — dependência nova sem necessidade de
  escala (princípio VI); a reconciliação no boot cobre o caso de falha.

## R7 — Transições de estágio no backend

**Decision**: `stageTransitionError` (`server-prod.js:1402`) evolui:
- novos destinos válidos: `deep_analysis` (a partir de `prospect` com
  enriquecimento concluído — mesmo gate atual de `qualified`), `discarded`
  (a partir de qualquer estágio não terminal — FR-011);
- `qualified` passa a exigir análise vigente concluída com veredito positivo
  **para avanço automático**; avanço manual de `deep_analysis` → `qualified`
  é permitido (override humano, FR-010/FR-012) e fica marcado
  (`DeepAnalysis.override` / evento de log) — bloqueado apenas enquanto
  `analysisStatus='running'` (FR-012);
- `discarded` → `deep_analysis` (restaurar, FR-011); retorno de
  `discarded` para outros estágios permanece bloqueado;
- bulk move (`POST /prospects/bulk`) usa as mesmas regras (hoje já reutiliza o
  bloqueio de retorno a `prospect`).

**Rationale**: centralizar em `stageTransitionError` mantém a "fonte da verdade
server-side" já estabelecida; o frontend apenas exibe o motivo (padrão atual
do kanban). Override humano registrado atende à transparência da US3/US4 sem
criar máquina de estados paralela no cliente.

**Alternatives considered**:
- *Máquina de estados declarativa nova em módulo próprio*: rejeitado nesta
  feature — a função atual é pequena e central; extração para módulo
  (`pipeline-transitions.js`) só se crescer (anotado para `$speckit-converge`).

## R8 — Contratos de API novos

**Decision** (detalhes em `contracts/api.md`):
- `GET /api/prospects/:id/deep-analysis` — análise vigente + estado (escopado
  por org; para trial responde 403 `PREMIUM_FEATURE` — padrão de gating do
  repo — sem vazar existência de dados);
- `POST /api/prospects/:id/deep-analysis/rerun` — reexecuta (409 se já
  running);
- listagem do kanban (`GET /api/prospects`) passa a incluir
  `analysisStatus`/veredito mínimo do card, mascarado por plano via
  `redactProspectForPlan`.

**Rationale**: `useLeadDetail` já carrega seções independentes em paralelo
(prospect, fatos, grafo, decisão 003) — a seção nova segue exatamente o padrão
(falha isolada não bloqueia a tela). O endpoint dedicado evita inflar o
payload da listagem com o resumo completo (que só interessa na página de
detalhes).

## R9 — Observabilidade

**Decision**: contadores prom-client em `metrics.js`:
`deep_analysis_started_total`, `deep_analysis_completed_total{verdict}`,
`deep_analysis_failed_total{reason}`, histograma `deep_analysis_duration_seconds`;
log estruturado por etapa (lead, org, versão do modelo, tokens via usage do
`llm-client`). Nenhum dado de cliente nos logs (constituição VII).

**Rationale**: SC-001/SC-004 exigem medir p95 e taxa de erro; o padrão
prom-client já existe no repo.

## R10 — Migração e backfill do estágio removido

**Decision**: migração Prisma (`db:migrate`) para `DeepAnalysis` + campos;
backfill idempotente em script (`scripts/backfill-lead-status.js`, padrão
`backfill-opportunity-score.js`) movendo `status='lead' → 'prospect'` (FR-003),
executável no deploy com flag e seguro a reexecuções. O valor `lead` deixa de
ser aceito em entradas de API (normalizado para `prospect`).

**Rationale**: constituição I proíbe `db push`; a migração só cria estrutura —
transformação de dados massiva em script idempotente é o padrão existente do
repo e reversível por re-execução sem efeito.

## R11 — Frontend: colunas, card e seção de detalhes

**Decision**:
- `PipelineKanbanView.tsx`: colunas = `prospect` → `deep_analysis` →
  `qualified` → `closed` + `discarded` (grid `lg:grid-cols-5`); card de
  `deep_analysis` com estados (spinner "Analisando…", selo aprovado, erro +
  reexecutar) — espelha o par "Enriquecendo dados…/Avançar" existente; card de
  `discarded` com ação restaurar.
- `LeadDetailScreen.tsx` + `useLeadDetail.ts`: `PIPELINE_STATUSES` e
  `STATUS_LABEL` atualizados; nova fonte independente `deepAnalysisState` e
  seção `LeadDeepAnalysis.tsx` (mesmo padrão das seções da 002; falha isolada).
- Trial: coluna visível com banner/selo "Recurso premium"; card nunca entra na
  coluna; endpoints de análise respondem 403 `PREMIUM_FEATURE`.

**Rationale**: reaproveita os dois padrões de UI já consolidados (estados
assíncronos no kanban da esteira de enriquecimento; seções independentes da
página de detalhes), minimizando superfície nova.

## R12 — Modelo de LLM e custo

**Decision**: modelo default do gateway (`LITELLM_MODEL`) com override por
env dedicado (ex.: `DEEP_ANALYSIS_LLM_MODEL`), temperatura baixa (≤0.3) e
`maxTokens` suficiente para o resumo (~900). Uma chamada por lead; reanálise é
manual ou ligada a novo `enrichmentVersion`.

**Rationale**: segue o padrão `AI_CAMPAIGN_LLM_MODEL` (alias com fallback,
`llm-client.js`); decisão de negócio (qual modelo/qualidade) fica em env, sem
deploy de código para ajustar. Reanálise automática limitada a mudança de
dados evita custo descontrolado (assumption da spec: sem reanálise
retroativa).
