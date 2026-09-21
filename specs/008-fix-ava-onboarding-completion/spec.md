# Feature Specification: Conclusão do Onboarding com a Ava — Fim do Travamento

**Feature Branch**: `008-fix-ava-onboarding-completion`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Temos um bug muito sério pra resolver: o onboarding com AI via AVA funciona perfeitamente, porém ao final, ele não termina e fica travado, não tem pra onde ir a não ser clicar em 'Corrigir resposta anterior', o que faz com que todo fluxo recomece. Precisamos corrigir isso Urgente!"

## Contexto (o problema observado)

A conversa de onboarding com a Ava (feature 004) funciona bem do início ao fim
das perguntas: o usuário responde as 12 perguntas, a Ava reconhece cada
resposta, lê os ativos de negócio (site, materiais, catálogo) e confirma o que
absorveu. **Mas a conversa não termina**: após a última mensagem da Ava ("Pronto,
absorvi tudo… Identifiquei o produto…"), a tela fica sem nenhuma ação de
avanço — não aparece o resumo, não há campo para responder nem botão de
confirmar. A única interação disponível é "Corrigir resposta anterior", que
descarta as respostas seguintes e reproduz a conversa desde a pergunta
revisada — na prática, o usuário refaz todo o fluxo e trava de novo no mesmo
ponto, em um loop sem saída.

Em qualquer conversa, o padrão esperado é: enquanto houver pergunta pendente, a
pergunta é a última interação acionável; quando as 12 perguntas acabam, o
resumo assume. O relato mostra que há caminhos em que esse encadeamento quebra:
a confirmação da leitura de um ativo chega **depois** de a conversa já ter
seguido para as perguntas seguintes, e a pergunta pendente deixa de ser a
interação acionável — a conversa para sem nenhuma ação de avanço e o resumo
nunca é alcançado. O mesmo mecanismo permite variantes do travamento (leitura
lenta demais, confirmação chegando após o fim da conversa). Esta feature
garante que **toda conversa de onboarding termina**: resumo exibido, confirmação
possível, transição automática ao dashboard — independente do momento ou do
resultado da leitura dos ativos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A conversa sempre chega ao fim: resumo, confirmação e dashboard (Priority: P1)

Um usuário que responde (ou pula) as 12 perguntas da Ava **sempre** chega à
fase de resumo — mesmo quando a Ava ainda está lendo os ativos de negócio ou
demora para confirmar o que absorveu. A confirmação de leitura ("absorvi
tudo…") pode chegar em qualquer momento, mas **nunca** deixa a conversa sem uma
ação disponível: a pergunta pendente permanece respondível e, esgotadas as
perguntas, o resumo completo aparece com opção de ajustar itens e confirmar.
Ao confirmar, a transição automática ao dashboard acontece sem clique extra
(comportamento já previsto na 004, hoje inalcançável para quem sofre o
travamento).

**Why this priority**: é o próprio fim do onboarding — sem ele, nenhum usuário
afetado consegue configurar a conta pela conversa; o fluxo inteiro da 004 fica
inutilizado para esse público. É o núcleo do bug relatado.

**Independent Test**: percorrer a conversa informando um site institucional
(que dispara a leitura), responder/pular as perguntas seguintes e verificar que
o resumo aparece e a confirmação leva ao dashboard — sem nenhuma tela travada.

**Acceptance Scenarios**:

1. **Given** as 12 perguntas respondidas ou puladas — inclusive com leitura de ativos ainda em andamento ou recém-concluída —, **When** a leitura termina (com sucesso, falha ou expiração), **Then** o resumo completo do configurado é exibido na conversa.
2. **Given** a conversa já avançou para uma pergunta seguinte, **When** a confirmação de leitura de um ativo informado antes chega, **Then** a pergunta pendente permanece a última interação acionável — os controles de resposta (chips ou campo de texto) continuam visíveis e funcionais.
3. **Given** o resumo exibido, **When** o usuário confirma, **Then** a aplicação transiciona automaticamente para o dashboard, sem clique adicional, e o workspace/CRM refletem a conversa.

---

### User Story 2 — A leitura de ativos nunca trava a conversa (Priority: P1)

Enquanto a Ava lê os ativos de negócio, a conversa nunca fica presa no
indicador "···" por tempo indefinido. Há um **teto de espera**: se a leitura não
concluir dentro do limite, a Ava avisa de forma conversacional e a conversa
segue — para a pergunta pendente ou para o resumo. Falhas de leitura (rede,
formato, erro do serviço) também resultam em mensagem conversacional seguida de
progressão normal, nunca em travamento. Quando a leitura termina depois que a
conversa já seguiu, a confirmação é incorporada sem roubar a vez da pergunta
pendente.

**Why this priority**: a leitura assíncrona dos ativos é o gatilho do
travamento relatado; sem garantir que ela nunca bloqueia nem desloca a
conversa, o bug reaparece em outras variações de timing.

**Independent Test**: simular leitura lenta (acima do teto), leitura falha e
leitura que conclui tarde, verificando em todos os casos que a conversa segue
até o resumo com uma ação sempre disponível.

**Acceptance Scenarios**:

1. **Given** leitura de ativos em andamento além do teto de espera, **When** o limite é atingido, **Then** a Ava avisa conversacionalmente e a conversa segue (pergunta pendente ou resumo), sem ficar em "···" indefinidamente.
2. **Given** leitura que falha (erro de rede ou do serviço), **Then** a Ava avisa de forma conversacional e a conversa segue até o resumo normalmente.
3. **Given** leitura que conclui com sucesso depois de a conversa já ter seguido, **Then** a confirmação do que foi absorvido aparece na conversa sem remover nem desativar os controles da pergunta pendente.

---

### User Story 3 — "Corrigir resposta anterior" nunca é beco sem saída (Priority: P2)

A ação "Corrigir resposta anterior" continua disponível durante a conversa para
ajustes, mas deixa de ser a única saída de estados travados. Usá-la em
qualquer ponto — inclusive próximo ao fim — devolve o usuário a uma conversa
que pode ser levada até o resumo e à confirmação. A partir do momento em que o
resumo é alcançado, os controles do resumo (ajustar item, confirmar) assumem e
a ação de correção solta deixa de aparecer como única affordance.

**Why this priority**: protege o usuário de qualquer regressão futura de
travamento (toda conversa permanece concluível após uma correção) e alinha o
fim da conversa com o desenhado na 004, mas depende de US1/US2, que removem o
travamento em si.

**Independent Test**: usar "Corrigir resposta anterior" em pontos variados da
conversa (inclusive após a última pergunta, no estado hoje travado), refazer as
perguntas seguintes e confirmar que o resumo e o dashboard são alcançados.

**Acceptance Scenarios**:

1. **Given** o usuário usa "Corrigir resposta anterior" em qualquer ponto da conversa, **When** responde as perguntas refeitas, **Then** a conversa alcança o resumo normalmente.
2. **Given** todas as perguntas respondidas e o resumo exibido, **Then** os controles do resumo (ajustar item, confirmar) são a interface da conversa — a ação de correção solta não é mais a única opção apresentada.
3. **Given** qualquer estado da conversa em que seja a vez do usuário, **Then** existe sempre uma ação de avanço disponível (responder, pular, ajustar item do resumo ou confirmar).

---

### Edge Cases

- **Leitura conclui depois de 2 ou mais perguntas seguintes** (o caso do relato — site informado na pergunta 10, confirmação chegando após as perguntas 11/12): a confirmação é anexada à conversa sem esconder a pergunta pendente; a fila de perguntas segue intacta.
- **Última pergunta respondida com leitura ainda em andamento**: o resumo aparece assim que a leitura terminar ou expirar, com o "···" mantido até lá — nunca antes, para que quem informou ativos saia com o contexto (SC-009 da 004), e nunca depois do teto.
- **Confirmação do resumo enquanto há leitura pendente**: a confirmação só é habilitada após a leitura terminar ou atingir o teto — evita concluir sem o contexto de negócio que ainda está a caminho.
- **"Corrigir resposta anterior" clicado repetidamente** até a primeira pergunta: a conversa segue repondo as perguntas na ordem e permanece concluível até o resumo.
- **Duas leituras em sequência** (ex.: site na pergunta 10 e catálogo na 12): cada resultado é incorporado quando chega; o mais recente atualiza o contexto; a conversa nunca perde a vez da pergunta pendente.
- **Recarregar a página durante a conversa**: mantém o comportamento da 004 (conversa recomeça do início nesta iteração) — mas, com esta correção, recomeça e termina; nenhum estado travado é persistido.
- **Leitura bem-sucedida de conteúdo vazio/ilegível**: já tratado na 004 (mensagem conversacional "não consegui absorver…"); com esta correção, a conversa segue até o resumo também nesse caso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST garantir que toda sessão de onboarding em que as 12 perguntas forem respondidas ou puladas alcance, sempre, a fase de resumo (resumo completo → ajuste/confirmar) — nenhum estado terminal da conversa pode existir sem o resumo.
- **FR-002**: O resultado da leitura de ativos (confirmação do que foi absorvido, aviso de falha ou de expiração) MUST ser incorporado à conversa sem nunca substituir, ocultar ou desativar a pergunta pendente: enquanto houver pergunta aguardando resposta, ela permanece a última interação acionável.
- **FR-003**: Quando a última pergunta for respondida ou pulada com leitura de ativos ainda em andamento, o sistema MUST exibir o resumo assim que a leitura terminar ou expirar, mantendo o indicador de digitação no intervalo.
- **FR-004**: A leitura de ativos MUST ter um teto de espera: se não concluir dentro do limite definido, o sistema avisa de forma conversacional e a conversa segue (pergunta pendente ou resumo) — o indicador "···" nunca persiste indefinidamente.
- **FR-005**: A confirmação do resumo MUST ser habilitada somente após qualquer leitura pendente terminar ou atingir o teto de espera, de modo que o resultado da conta inclua o contexto de negócio quando ele foi possível de extrair.
- **FR-006**: Qualquer falha de leitura (rede, formato, erro do serviço, expiração) MUST resultar em mensagem conversacional seguida de progressão normal da conversa — nunca em travamento.
- **FR-007**: Após o uso de "Corrigir resposta anterior" em qualquer ponto da conversa — inclusive no fim —, o fluxo MUST permanecer concluível: as perguntas refeitas levam novamente ao resumo e à confirmação.
- **FR-008**: Quando a fase de resumo é alcançada, os controles do resumo (ajustar item, confirmar) MUST ser a única interface de avanço da conversa; a ação de correção solta não pode ser a única opção apresentada em nenhum estado pós-perguntas.
- **FR-009**: O comportamento já entregue da conversa (12 perguntas na ordem, chips, validação conversacional, pre-fill, reações, indicador "···", resumo com ajuste item a item) MUST permanecer inalterado — esta feature é uma correção de orquestração do fluxo, não uma mudança de conteúdo ou de roteiro.
- **FR-010**: O sistema MUST registrar de forma observável (log estruturado, sem dados de cliente) os eventos de expiração de leitura e de confirmação tardia incorporada, para diagnóstico de recorrência sem acesso a dados sensíveis.

### Key Entities *(include if feature involves data)*

- **Sessão de onboarding** (já definida na 004): o estado da conversa — pergunta atual, respostas, ativos, contexto de negócio e fase (perguntas → resumo → concluída). Esta feature reforça a invariante de transição: da última pergunta respondida/pulada, a sessão sempre alcança a fase de resumo, independentemente do estado da leitura de ativos. Nenhuma entidade nova é criada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das sessões de teste que respondem ou pulam as 12 perguntas chegam ao resumo e, após confirmar, ao dashboard — zero travamentos terminais no caminho testado.
- **SC-002**: Em nenhum momento da conversa o usuário fica sem ação de avanço disponível por mais que a latência natural do indicador de digitação (0 ocorrências de "tela sem affordance" nos testes automatizados).
- **SC-003**: A conversa alcança o resumo em no máximo o teto de espera da leitura (≈60 s no pior caso) após a última resposta, mesmo com leitura lenta, falha ou pendente.
- **SC-004**: O caminho feliz completo do relato — conta nova, site informado na pergunta 10, materiais e catálogo respondidos, leitura confirmando tarde — percorre pergunta 10 → 12 → resumo → dashboard sem intervenção corretiva.
- **SC-005**: Zero regressão: os testes existentes da conversa (roteiro, validação, resumo, ativos, revisão) continuam passando sem alteração de comportamento observável.

## Assumptions

- **Causa no nível de orquestração**: o conteúdo da conversa (roteiro, extração, mensagens da Ava) funciona — o relato mostra a confirmação de leitura chegando corretamente; o defeito é de encadeamento da conversa (ordem/vez das interações e transição ao resumo). O plan identifica o ponto exato.
- **Teto de espera da leitura**: 60 s, com o aviso de lentidão existente (~30 s) mantido como sinal intermediário; valor exato é decisão do plan. Hoje não há teto — o "···" pode persistir indefinidamente em falha de rede.
- **Semântica da correção retroativa mantida**: "Corrigir resposta anterior" continua descartando as respostas posteriores à pergunta revisada (comportamento atual da 004). Redesenhar essa semântica (ex.: refazer apenas a pergunta alvo) está fora do escopo desta correção; o exigido é que, após usá-la, a conversa seja sempre concluível.
- **Escopo restrito à conclusão**: integração definitiva com backend/persistência do onboarding continua sendo o passo seguinte da 004, fora do escopo desta feature.
- **Testes como porta de entrada**: a correção entra com testes automatizados dos cenários de travamento (constituição III) — inclusive regressão do caminho que hoje trava.
- **Idioma e persona**: mensagens novas (aviso de expiração, variações necessárias) em PT-BR, na voz da Ava.
