# Feature Specification: Análise Profunda de Lead por IA no Pipeline

**Feature Branch**: `005-deep-lead-analysis`

**Created**: 2026-09-18

**Status**: Draft

**Input**: "No pipeline de vendas hoje temos 4 colunas no kanban. Precisamos remover a coluna 'Novas oportunidades' e adicionar uma coluna 'Análise profunda' onde o lead já enriquecido e pronto pra contato passa por um passo anterior ao contato: ele é submetido à análise de um modelo de IA, que dá o veredito final sobre o score do lead e se faz sentido entrar em contato ou não, baseado no contexto do usuário e nas informações capturadas do lead. Além disso, o modelo de IA deve adicionar um resumo completo sobre o lead e suas impressões, que será exibido na página de detalhes do lead."

## Contexto (o problema hoje)

O pipeline de vendas tem 4 colunas: **Novas oportunidades** (`lead`) →
**Em Qualificação** (`prospect`, onde o enriquecimento roda) → **Prontas para
contato** (`qualified`, para onde o card avança sozinho ao concluir o
enriquecimento) → **Clientes ganhos** (`closed`). A coluna "Novas oportunidades"
é a entrada do funil, mas a criação de leads já os deposita diretamente em "Em
Qualificação" — a coluna funciona como estacionamento de leads legados e não
representa um passo real do processo comercial.

O score de oportunidade atual (0–100) e o painel de decisão de contato
(feature 003) são **determinísticos**: somam pesos sobre sinais capturados, mas
não interpretam o negócio do cliente. Falta ao pipeline um passo que cruze os
dados capturados do lead com o contexto comercial da organização e diga, com
justificativa, **se vale a pena entrar em contato** — a decisão continua sendo
um palpite do operador.

## Clarifications

### Session 2026-09-18

- Q: O que acontece com o lead quando a análise de IA conclui com veredito NEGATIVO (não faz sentido entrar em contato)? → A: Coluna de descartados — o lead reprovado é movido automaticamente para um destino final "Descartados" no pipeline, com veredito e motivo registrados; o usuário pode restaurá-lo.
- Q: A análise profunda por IA deve rodar para quais planos? → A: Somente premium — a análise é recurso exclusivo do plano premium (mesma fronteira do enriquecimento profundo); organizações de outros planos não recebem análise e mantêm o fluxo atual.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Pipeline com "Análise profunda" e "Descartados", sem "Novas oportunidades" (Priority: P1)

O kanban do pipeline passa a exibir: **Em Qualificação** → **Análise profunda**
→ **Prontas para contato** → **Clientes ganhos**, com a coluna terminal
**Descartados** ao final. A coluna "Novas oportunidades" deixa de existir.
Leads novos entram diretamente em "Em Qualificação"; leads enriquecidos de
organizações premium passam a pousar em "Análise profunda" em vez de ir direto
para "Prontas para contato". Para organizações sem o recurso de análise, a
coluna permanece visível com indicação de recurso premium e o fluxo dos leads
não muda.

**Why this priority**: é a reestruturação do funil que sustenta todas as demais
histórias; sem a nova coluna, não existe lugar no pipeline para a análise.

**Independent Test**: abrir o kanban e verificar as colunas; criar um lead
novo e vê-lo entrar direto em "Em Qualificação"; concluir um enriquecimento em
organização premium e ver o card avançar para "Análise profunda".

**Acceptance Scenarios**:

1. **Given** o kanban do pipeline aberto, **When** o usuário visualiza as colunas, **Then** vê "Em Qualificação", "Análise profunda", "Prontas para contato", "Clientes ganhos" e "Descartados" — sem "Novas oportunidades".
2. **Given** um lead novo criado (manual, via API ou importação), **When** a criação é confirmada, **Then** o lead aparece diretamente em "Em Qualificação" com o enriquecimento disparado.
3. **Given** um lead em "Em Qualificação" com o enriquecimento concluído em uma organização premium, **When** a esteira de enriquecimento finaliza, **Then** o card avança automaticamente para "Análise profunda" (e não mais para "Prontas para contato").
4. **Given** leads existentes no estágio "Novas oportunidades" no momento da atualização, **When** a feature entra no ar, **Then** todos aparecem em "Em Qualificação" sem perda de dados.
5. **Given** uma organização em plano sem o recurso de análise, **When** o usuário observa o kanban, **Then** a coluna "Análise profunda" aparece com indicação de que a análise é exclusiva do plano premium, e os leads da organização continuam avançando diretamente de "Em Qualificação" para "Prontas para contato".

---

### User Story 2 — Análise de IA com veredito final sobre score e contato (Priority: P1)

Quando o lead entra em "Análise profunda" (organizações premium), o sistema
submete automaticamente o lead à análise de um modelo de IA. A análise cruza
**o contexto comercial da organização** (o que ela vende, modelo de negócio,
diferenciais, perfil ideal de cliente e proposta de valor, conforme cadastrado
pela organização) com **as informações capturadas do lead** (firmografia,
presença digital, contatos, sinais do enriquecimento, score e métricas já
calculados). O resultado é:

- **Score final do lead (0–100)**, que passa a ser o score oficial exibido;
- **Veredito final**: faz sentido entrar em contato ou não;
- **Justificativa**: resumo com as impressões da IA (ver User Story 3).

Lead com veredito positivo avança automaticamente para "Prontas para contato";
lead com veredito negativo é movido automaticamente para "Descartados", com o
motivo registrado e visível na página de detalhes.

**Why this priority**: é o coração da feature — transforma o pipeline de um
funil manual em um funil com triagem inteligente; é o que entrega o valor
prometido ("veredito final sobre o score e sobre o contato").

**Independent Test**: com um lead enriquecido e contexto comercial cadastrado
em organização premium, entrar o lead em "Análise profunda" e verificar que,
sem nenhuma ação do usuário, ele recebe score final, veredito e justificativa —
e avança sozinho quando o veredito é positivo.

**Acceptance Scenarios**:

1. **Given** um lead em "Análise profunda" com análise em execução, **When** a análise conclui com veredito positivo, **Then** o card avança automaticamente para "Prontas para contato" e o score exibido passa a ser o score final da IA.
2. **Given** um lead cuja análise conclui com veredito negativo, **When** a análise finaliza, **Then** o card é movido automaticamente para "Descartados" e a página de detalhes mantém o veredito negativo e o motivo visíveis.
3. **Given** uma organização sem contexto comercial preenchido, **When** a análise de um lead roda, **Then** a IA analisa somente com os dados capturados do lead e registra explicitamente que o contexto da organização não foi considerado — sem afirmar características não informadas.
4. **Given** uma falha do modelo de IA (indisponibilidade, timeout, erro), **When** a análise não conclui, **Then** o lead permanece em "Análise profunda" com estado de erro visível e ação de reexecutar; nenhum lead avança ou é descartado por automação sem veredito concluído.

---

### User Story 3 — Resumo completo e impressões da IA na página de detalhes (Priority: P2)

A página de detalhes do lead ganha uma seção dedicada à análise profunda,
exibindo: o **resumo completo do lead** produzido pela IA, as **impressões**
dela sobre o lead (por que este lead interessa ou não a esta organização), o
**veredito** (contatar / não contatar), o **score final** e os **principais
fatores** que sustentam a conclusão, além da data da análise.

**Why this priority**: é o registro explicável da decisão — dá ao time
comercial o "porquê" — mas depende da análise existir (User Story 2) para ter
conteúdo.

**Independent Test**: abrir a página de detalhes de um lead analisado e
encontrar a seção completa com resumo, impressões, veredito, score final e
data; abrir a de um lead ainda não analisado e ver o estado correspondente
sem seção vazia.

**Acceptance Scenarios**:

1. **Given** um lead com análise concluída, **When** o usuário abre a página de detalhes, **Then** encontra a seção da análise com resumo completo, impressões, veredito, score final e data da análise.
2. **Given** um lead com análise em execução ou falha, **When** o usuário abre a página de detalhes, **Then** vê o estado correspondente (em análise, ou erro com ação de reexecutar) em vez de um resumo vazio ou desatualizado.
3. **Given** um lead descartado automaticamente pela IA, **When** a página de detalhes é aberta (inclusive a partir da coluna "Descartados"), **Then** a seção mantém visíveis o veredito negativo, o resumo e os fatores que sustentaram a reprovação.

---

### User Story 4 — Visibilidade e controle do estado da análise no kanban (Priority: P2)

No kanban, cada card da coluna "Análise profunda" comunica o estado da análise:
**em análise** (indicador de progresso, análogo ao "Enriquecendo dados…" atual),
**concluída** (score final e selo de aprovado), **falhou** (indicação de erro).
O usuário pode reexecutar a análise de um card a qualquer momento e pode
restaurar um lead da coluna "Descartados".

**Why this priority**: dá previsibilidade visual ao novo passo do funil e evita
que o operador interfira em análises em andamento; complementa, mas não
substitui, as histórias de valor.

**Independent Test**: observar a coluna "Análise profunda" durante uma análise
e após sua conclusão, conferindo a mudança de estado no card; reexecutar uma
análise e ver o card voltar ao estado "em análise"; restaurar um lead
descartado e vê-lo retornar à coluna "Análise profunda".

**Acceptance Scenarios**:

1. **Given** um lead em "Análise profunda" com análise em execução, **When** o usuário observa o card, **Then** vê o indicador "analisando…" e nenhum botão de avanço manual disponível enquanto isso.
2. **Given** um lead com análise concluída e aprovada, **When** o usuário observa o card, **Then** vê o score final da IA e o selo de aprovado.
3. **Given** um lead com análise falha, **When** o usuário observa o card, **Then** vê a indicação de erro e pode reexecutar a análise.
4. **Given** um lead já analisado, **When** o usuário solicita reexecução da análise, **Then** a análise vigente é substituída pela nova e o card volta ao estado "em análise".
5. **Given** um lead na coluna "Descartados", **When** o usuário o restaura, **Then** o lead retorna à coluna "Análise profunda" e uma nova análise é executada, substituindo a anterior como vigente.

### Edge Cases

- **Lead descartado pela IA e restaurado pelo usuário**: ao restaurar, o lead volta para "Análise profunda" e a reanálise substitui a anterior como vigente; a nova análise pode confirmar ou reverter o veredito.
- **Leads já em "Prontas para contato" no release**: permanecem onde estão e NÃO são reanalisados retroativamente; a reexecução manual da análise fica disponível.
- **Enriquecimento concluído com falha ou dados escassos** (`error`/`unavailable`): o lead ainda entra em análise; a IA trabalha com o que existe e sinaliza explicitamente a escassez de dados na justificativa — sem inventar informações.
- **Reexecução concorrente**: solicitar nova análise enquanto outra está em execução não cria análises duplicadas nem estados inconsistentes.
- **Análise de lead sem CNPJ** (importado, enriquecido por fontes digitais): a análise roda normalmente com os dados disponíveis.
- **Organização sem plano premium**: nenhuma saída da análise (score final, veredito, resumo) é exposta; leads não entram na coluna e seguem o fluxo atual, e a UI deixa claro que a análise é um recurso premium.
- **Multi-organização**: a análise usa exclusivamente o contexto e os dados da organização à qual o lead pertence; nunca dados de outra organização.
- **Isolamento de falhas**: indisponibilidade do modelo de IA não derruba o kanban, o enriquecimento nem as demais funcionalidades do pipeline — a coluna apenas sinaliza o erro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O pipeline de vendas MUST exibir as colunas "Em Qualificação", "Análise profunda", "Prontas para contato", "Clientes ganhos" e "Descartados", e o estágio "Novas oportunidades" MUST deixar de existir em todas as superfícies do produto (kanban, página de detalhes, filtros, contadores e relatórios que referenciem estágios).
- **FR-002**: Todo lead novo (criação manual, via API ou importação) MUST entrar diretamente em "Em Qualificação".
- **FR-003**: Leads existentes no estágio "Novas oportunidades" MUST ser migrados para "Em Qualificação" de forma idempotente e sem perda de dados.
- **FR-004**: Em organizações com o recurso de análise (premium), ao concluir o enriquecimento o lead MUST avançar automaticamente de "Em Qualificação" para "Análise profunda".
- **FR-005**: A entrada do lead em "Análise profunda" MUST disparar automaticamente a análise pelo modelo de IA, sem ação do usuário.
- **FR-006**: A análise MUST considerar o contexto comercial da organização (produto, modelo de negócio, diferenciais, perfil ideal de cliente e proposta de valor, conforme cadastrado) e as informações capturadas do lead pelo enriquecimento.
- **FR-007**: O resultado da análise MUST conter: score final (0–100), veredito final sobre entrar em contato (faz sentido / não faz sentido) e um resumo em texto com as impressões da IA sobre o lead, citando os fatores que sustentam o veredito.
- **FR-008**: O score final da IA MUST ser o score exibido no kanban e na página de detalhes; o score determinístico anterior permanece disponível como referência de comparação.
- **FR-009**: Lead com veredito positivo MUST avançar automaticamente para "Prontas para contato".
- **FR-010**: Lead com veredito negativo MUST ser movido automaticamente para "Descartados", com o veredito, o motivo e os fatores da reprovação registrados e visíveis na página de detalhes do lead.
- **FR-011**: "Descartados" MUST ser um destino final do pipeline; o usuário MUST poder descartar manualmente um lead de qualquer estágio anterior e restaurar um lead descartado — a restauração retorna o lead para "Análise profunda" e dispara nova análise.
- **FR-012**: O kanban MUST indicar no card o estado da análise (em análise, aprovada, descartada, falha) e MUST bloquear avanço manual enquanto a análise está em execução.
- **FR-013**: A página de detalhes do lead MUST exibir a seção de análise profunda com resumo completo, impressões da IA, veredito, score final, principais fatores e data da análise.
- **FR-014**: O usuário MUST poder reexecutar a análise de um lead (pela coluna ou pela página de detalhes); a reexecução substitui a análise vigente pela nova.
- **FR-015**: Nenhum lead MUST avançar ou ser descartado por automação sem análise concluída; falha de análise mantém o lead em "Análise profunda" com estado de erro e reexecução disponível.
- **FR-016**: Análises MUST ser isoladas por organização: a IA recebe apenas o contexto comercial e os dados de leads da própria organização.
- **FR-017**: Se o contexto comercial da organização estiver incompleto, a análise MUST prosseguir com os dados disponíveis do lead e sinalizar no resultado que o contexto da organização não foi considerado — sem afirmar características não informadas pela organização.
- **FR-018**: A análise profunda por IA MUST ser exclusiva do plano premium: para organizações de outros planos, nenhuma saída da análise (score final, veredito, resumo) é exposta, os leads avançam diretamente de "Em Qualificação" para "Prontas para contato" ao concluir o enriquecimento (fluxo atual preservado), e a coluna "Análise profunda" permanece visível com indicação de recurso premium.

### Key Entities *(include if feature involves data)*

- **Lead (Prospect)**: ganha um novo estágio de pipeline entre "Em Qualificação" e "Prontas para contato", com estado de análise (não iniciada / em execução / concluída / falha), score final e veredito vigentes; o estágio "Descartados" passa a ser um destino final possível do lead.
- **Análise Profunda (resultado da análise de IA)**: registro vinculado a um lead e a uma organização, com score final, veredito, resumo, impressões, fatores pró/contra, indicação de contexto da organização considerado ou ausente, data e versão do modelo. Existe uma análise vigente por lead; a reexecução a substitui.
- **Contexto comercial da organização (existente)**: insumo da análise cadastrado pela organização (produto, modelo de negócio, diferenciais, perfil ideal de cliente, proposta de valor); sua ausência é sinalizada no resultado, não bloqueia a análise.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um lead cujo enriquecimento acabou de concluir (organização premium) recebe veredito de IA concluído em até 5 minutos (p95).
- **SC-002**: 100% dos cards em "Prontas para contato" de organizações premium possuem análise concluída com score final e veredito (nenhum avança sem veredito).
- **SC-003**: Após a migração, zero leads permanecem no estágio removido ("Novas oportunidades").
- **SC-004**: Pelo menos 90% das análises concluem sem erro na primeira execução; as falhas são recuperáveis por reexecução manual sem perda de estado.
- **SC-005**: Em avaliação com o time comercial, a seção de análise permite explicar a decisão de contato sem consultar outras fontes para a maioria dos leads (feedback qualitativo coletado).
- **SC-006**: O tempo de triagem por lead cai — o operador decide a próxima ação a partir do veredito em menos de 1 minuto por lead.
- **SC-007**: Nenhum dado derivado da análise (score final, veredito, resumo) fica acessível a organizações sem o recurso (verificado por inspeção de interface e fluxos de API).

## Assumptions

- A análise roda automaticamente ao entrar na coluna; o fluxo padrão não exige clique do usuário (reexecução manual é o escape).
- O score determinístico atual e o painel de decisão de contato (feature 003) continuam existindo como insumos e referência; a novidade é a camada de IA que os interpreta e emite o veredito final.
- Descarte manual pelo usuário está disponível a partir de qualquer estágio anterior a "Descartados" (ex.: limpar um lead claramente fora de perfil sem esperar análise).
- Leads já presentes em "Prontas para contato" antes do release não são reanalisados automaticamente.
- O resumo e as impressões da IA são exibidos em PT-BR (idioma do produto).
- O resumo exibido é sempre o da análise mais recente concluída; a data da análise é exibida junto ao resumo.
- A coluna "Descartados" permanece visível no kanban (com contagem), para que reprovados não desapareçam do campo de visão do time.
