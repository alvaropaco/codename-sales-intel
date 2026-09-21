# Research: Conclusão do Onboarding com a Ava — Fim do Travamento

**Feature**: 008-fix-ava-onboarding-completion | **Date**: 2026-09-21

Pesquisa focada: o bug é de orquestração interna de um fluxo já existente —
não há tecnologia nova a escolher. As "decisões" abaixo resolvem os pontos de
design abertos da spec (onde e como restaurar as invariantes), cada uma com a
causa raiz correspondente identificada no código atual.

## Causa raiz (diagnóstico do código atual)

Cadeia exata do travamento relatado (confirmada por leitura de
`services/onboarding.ts`, `state/useAvaOnboarding.ts` e
`components/onboarding/ava/AvaOnboarding.tsx`):

1. O usuário responde o site institucional (pergunta 10). `attachUrl` dispara
   `extractBusinessContext()` (fetch assíncrono) e a conversa **segue** —
   `advance()` já anexou o prompt da pergunta 11 (materiais), e cada resposta
   seguinte anexa a próxima pergunta.
2. Quando o fetch resolve, `extractBusinessContext` faz
   `state.messages.push(...)` — a confirmação "Pronto, absorvi tudo…" entra
   **depois** da pergunta pendente no array de mensagens.
3. Na UI, `activeMessage` = última mensagem revelada e `activeIsCurrent` exige
   `active.questionId === currentQuestionId`. Com a confirmação por último, o
   composer/chips **não renderizam**. `isSummaryPhase` ainda é `false`
   (`stepIndex < 12`), então o resumo não aparece. Resta só "Corrigir resposta
   anterior" (visível quando `!isSummaryPhase && reviseTarget`).
4. `revise()` trunca mensagens/respostas a partir da pergunta alvo **e**
   `setVisibleCount(0)` faz o transcript inteiro ser re-revelado com jitter de
   800–1600 ms por mensagem — a percepção de "todo o fluxo recomeça".

Variantes do mesmo defeito: (a) anexar arquivos na pergunta de materiais — as
mensagens "Recebi o X ✅"/confirmação também entram depois do prompt e escondem
o composer "Pronto, seguir 📎"; (b) fetch sem teto — em falha de rede o
`extracting` pode persistir indefinidamente com o rodapé bloqueado.

## Decisões

### D1 — Inserção ordenada de mensagens de status no serviço (corrige a raiz)

**Decision**: `extractBusinessContext` (e qualquer mensagem de status futura)
insere a mensagem de resultado **imediatamente antes** da "mensagem de
interação pendente" — a última mensagem que é prompt de pergunta (`questionId`
presente) ou o marcador de resumo (`kind: 'summary'`). Se não houver interação
pendente, anexa no fim (comportamento de hoje). Helper puro e testável em
`lib/avaScript.ts` (ex.: `insertBeforePendingInteraction(messages, message)`),
consumido pelo serviço.

**Rationale**: preserva a cronologia legível do transcript ("absorvi tudo…"
aparece acima da pergunta que aguarda resposta) **e** restaura a invariante na
fonte — a pergunta pendente volta a ser a última mensagem acionável para a UI
atual, sem mudar o formato de `ChatMessage` nem o contrato do estado.

**Alternatives considered**:
- *Só mudar o gate da UI (D2) sem reordenar*: menor diff, mas deixa o
  transcript fora de ordem (confirmação renderizada **abaixo** da pergunta,
  sugerindo que é resposta a ela) e espalha a invariante entre camadas.
- *Fila de saída assíncrona no hook*: mais maquinário (agendamento, cancelamento)
  para o mesmo resultado — viola YAGNI (constituição VI).

### D2 — Gate da UI pela mensagem de interação pendente (defesa em profundidade)

**Decision**: `useAvaOnboarding` deixa de derivar a ativação do composer/chips
de "última mensagem revelada" e passa a expor a ativação a partir da mensagem
de interação pendente (`questionId === currentQuestionId`): chips/composer
renderizam quando **essa mensagem já foi revelada** e não há `typing`/`extracting`.
Helper puro (testável sem DOM, ambiente vitest node da 004), ex.:
`pendingInteraction(state, currentQuestionId)` → `{ message, revealed }`.

**Rationale**: FR-002 da spec exige que o resultado da leitura "nunca
substitua, oculte ou desative a pergunta pendente" — codificar isso na UI
torna a invariante estrutural, imune a qualquer caminho assíncrono futuro
(não só a extração de hoje). Custo: poucas linhas no hook.

**Alternatives considered**: confiar apenas em D1 — rejeitado porque a
invariante ficaria incidental (dependente da disciplina de quem anexa
mensagens), exatamente o que permitiu este bug.

### D3 — Teto de espera de 60 s + época de extração (descarte de resultado tardio)

**Decision**: dentro de `extractBusinessContext`, correr o fetch contra um
timer de 60 s (`Promise.race`; valor injetável via `deps.extractionTimeoutMs`
para testes). No estouro: ativos `pending/extracting` → `failed` com warning
`EXTRACTION_TIMEOUT`, mensagem conversacional na voz da Ava ("a leitura está
demorando mais que o esperado — sigo sem ela; dá pra complementar depois nas
configurações 🙂", inserida pela regra D1) e `ExtractionOutcome` estendido com
`{ ok: false, reason: 'TIMEOUT' }`. Um contador de época (`extractionEpoch`)
no serviço descarta silenciosamente resultado de corrida vencida (fetch que
resolve após timeout ou após nova extração) — sem mutar estado, sem anexar
mensagem. O aviso de lentidão de ~30 s que já existe no hook permanece.

**Rationale**: FR-004 exige teto; sem o descarte por época, o fetch tardio
mutaria estado após o timeout (ou após o usuário já ter reanexado/recarregado
o fluxo), reintroduzindo desordem. Manter timeout e descarte **no serviço**
mantém o hook fino e a lógica testável com `vi.useFakeTimers()`.

**Alternatives considered**:
- *`AbortController` para cancelar o fetch*: mais correto em rede, mas o
  backend continua processando de todo jeito; o descarte por época dá a mesma
  garantia de UI com menos superfície (e sem risco de mudar o comportamento do
  endpoint). Rejeitado para este escopo.
- *Timeout só no hook (`Promise.race` fora do serviço)*: deixaria o serviço
  mutando estado depois do "settle" percebido pela UI — divide a verdade sobre
  o fim da extração em dois lugares.

### D4 — Confirmação do resumo só após o settle da extração

**Decision**: dois guardas baratos: (1) `AvaSummary` ganha `confirmDisabled`
e o botão fica desabilitado enquanto `extracting` (com rótulo inalterado — o
"···" no rodapé já comunica a espera); (2) `service.complete()` retorna `null`
enquanto houver extração em voo (checagem de época no serviço, 1 linha).
Quando a extração termina em timeout, `complete()` libera imediatamente —
o resultado sai sem `businessContext` da corrida perdida, como a spec admite.

**Rationale**: FR-005 (quem informou ativos sai com o contexto quando ele foi
possível) e remove a corrida "confirmou durante extração" na fonte, sem
estados novos nem desabilitar o resumo em si (ajustar itens continua
disponível).

**Alternatives considered**: bloquear o resumo inteiro até o settle — pior UX
(sem nada acionável por até 60 s) e desnecessário; agendar confirmação
deferida (clicou → espera → conclui) — esconde o estado do botão e complica o
contrato.

### D5 — `revise` sem replay visual do transcript

**Decision**: `revise()` no hook deixa de fazer `setVisibleCount(0)`; passa a
posicionar `visibleCount` no índice da nova mensagem de pergunta re-anexada —
o histórico anterior permanece visível e apenas o prompt revisado entra com o
"···" (as reações injetadas ancoradas em mensagens removidas já são filtradas
pela mesclagem existente).

**Rationale**: é a metade "recomeça tudo" do relato do usuário; FR-007 exige
que após a correção o fluxo seja concluível — e a experiência de corrigir não
pode custar ~25 s de replay (transcript longo × jitter de 800–1600 ms).
Semântica de descarte de respostas posteriores permanece a da 004
(assumption da spec 008).

**Alternatives considered**: manter o replay (comportamento de hoje) — rejeitado;
reconstruir só o trecho revisado removendo mensagens do DOM — equivalente ao
proposto com mais estado de exibição para gerenciar.

### D6 — Observabilidade mínima (FR-010)

**Decision**: (1) no cliente, eventos estruturados em `console`
(`console.info('[ava-onboarding]', { event: 'extraction_timeout' | 'late_result_discarded' | ... })`)
emitidos pelo serviço/hook nos caminhos de timeout e descarte; (2) na rota
`ava-extract.js`, 1 linha de log estruturado de duração e resultado
(`extracted | empty | warning`) — já existe DI de `logger`; **nenhum dado de
cliente nos logs** (só contagens/duração/códigos de warning).

**Rationale**: constituição VII (fluxo crítico observável) com o mínimo de
superfície; permite medir recorrência do timeout e latência real da extração
sem infraestrutura nova (sem prom-client novo, sem fila).

**Alternatives considered**: métrica prom-client na plataforma — rejeitado
aqui: o fluxo é de frontend e o ganho não justifica novo endpoint de métricas
nesta iteração (reavaliável na integração real do onboarding).

## Consequências para as tarefas (insumo ao $speckit-tasks)

- Testes primeiro (constituição III): regressão do cenário exato do relato
  (site → extração resolve tarde → perguntas 11/12 → pergunta pendente
  acionável → resumo → complete) em `onboarding.completion.test.ts`; casos de
  inserção ordenada, timeout + descarte por época, guard de `complete()` e
  helper puro do gate da UI.
- Ordem sugerida: tipos → helper puro → serviço → hook → componentes → log da
  rota.
- Nada de mudança em `avaScript.ts` além do helper (roteiro/textos intocados,
  FR-009); mensagens novas de timeout/timeout-warning seguem o tom das já
  existentes no serviço.
