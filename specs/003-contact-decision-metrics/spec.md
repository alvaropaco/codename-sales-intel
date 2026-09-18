# Feature Specification: Métricas de Decisão de Contato no Lead

**Feature Branch**: `003-contact-decision-metrics`

**Created**: 2026-09-17

**Status**: Draft

**Input**: "Inteligência de enriquecimento: na página de detalhes do lead, as métricas de POTENCIAL, PRONTIDÃO e LANÇAMENTO não fazem o menor sentido. Temos que substituí-las por métricas que realmente embasem a decisão do cliente de entrar em contato ou não com o lead."

## Diagnóstico (o problema hoje)

A seção "Inteligência de enriquecimento" da tela de detalhes do lead exibe três
notas anônimas de 0–100 — **Potencial**, **Prontidão** e **Lançamento**. As três
derivam praticamente dos mesmos sinais de presença digital (domínio ativo, HTTPS,
e-mail corporativo, redes sociais, tecnologias detectadas), com sobreposição
quase total de conteúdo entre elas. Na prática, o operador vê três números
parecidos, sem responder a nenhuma pergunta comercial concreta: nenhum deles diz
se há canal de contato utilizável, se a empresa está realmente operando, ou se
vale a pena gastar o próximo minuto de prospecção naquele lead. A decisão de
"entro em contato ou não com este lead?" — que é o único motivo de existir dessa
seção — continua nas mãos do palpite.

## Clarifications

### Session 2026-09-17

- Q: Quando o lead já recebeu contato (status avançado no funil ou canais "Contatado"), o que a recomendação de contato deve mostrar? → A: Recomendação padrão + contexto: mantém o veredito baseado em evidência e exibe aviso "lead já contatado (canal · data)" junto à recomendação, sem criar lógica separada de follow-up nem esconder o painel.
- Q: Quando uma evidência usada nas métricas está desatualizada (ex.: o "site no ar" foi verificado há 4 meses), o que o painel deve fazer? → A: Selo de desatualização: evidência capturada há mais de ~90 dias recebe marca "dados podem estar desatualizados" com sugestão de reenriquecer; a métrica continua exibida.
- Q: Como cada métrica (Atingibilidade e Momento) deve comunicar seu valor: selo qualitativo como leitura principal ou número 0–100 como leitura principal? → A: Selo qualitativo primário (ex.: "Alta / Média / Baixa") com o valor 0–100 como detalhe secundário visível.
- Q: Para leads importados sem CNPJ (sem identificador fiscal), como a métrica de Momento deve se comportar? → A: Computa parcialmente: usa os sinais digitais disponíveis (site, e-mail, social, stack) e indica quais sinais oficiais estão ausentes; sinais oficiais entram quando o CNPJ for resolvido.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Métricas que respondem às perguntas da decisão de contato (Priority: P1)

Na tela de detalhes do lead, as três notas genéricas (Potencial, Prontidão,
Lançamento) deixam de existir e são substituídas por métricas que respondem,
cada uma, a uma pergunta distinta da decisão de contato:

1. **Atingibilidade** — "consigo chegar até este lead?" Indica se existe ao
   menos um canal de contato utilizável e a qualidade do melhor canal
   disponível (e-mail corporativo próprio vs. endereço de provedor gratuito ou
   de contabilidade terceirizada, telefone válido, WhatsApp), acompanhada da
   evidência concreta (qual canal, quão confiável é a captura).
2. **Momento** — "este é um bom momento para abordar?" Indica se a empresa
   aparenta estar operando e investindo agora (situação cadastral ativa, site
   no ar e acessível, e-mail funcionando, presença social, ferramentas de
   marketing/vendas detectadas, sinal de empresa recente ou em expansão),
   acompanhada do sinal-chave que sustenta a leitura.

Cada métrica apresenta um **selo qualitativo como leitura principal** (ex.:
"Alta / Média / Baixa"), com o valor 0–100 como **detalhe secundário visível**,
**junto da evidência que os sustenta** — o canal encontrado, o sinal detectado —
e de uma leitura comercial direta (ex.: "há e-mail corporativo próprio: e-mail é
o canal recomendado"; "site fora do ar e CNPJ suspenso: risco de empresa
inativa"). O operador não precisa adivinhar o que o número significa nem por que
ele é daquele valor: o julgamento comercial vem primeiro, o número complementa.

**Why this priority**: sem métricas que respondam às perguntas reais ("consigo
chegar?" e "agora é hora?"), a seção não tem valor decisório — é o cerne do
pedido. Este slice já entrega, sozinho, uma seção útil mesmo antes da
recomendação sintetizada da User Story 2.

**Independent Test**: abrir a tela de um lead enriquecido e verificar que as
duas métricas respondem às suas perguntas com evidência visível; verificar que
Potencial, Prontidão e Lançamento não aparecem mais em nenhum ponto da tela.

**Acceptance Scenarios**:

1. **Given** um lead com e-mail corporativo próprio e telefone capturados, **When** a seção é aberta, **Then** a métrica de Atingibilidade indica que o lead é atingível, nomeia o canal de melhor qualidade (e-mail corporativo próprio) e exibe os canais encontrados como evidência.
2. **Given** um lead cujo único contato é um e-mail de provedor gratuito, **When** a seção é aberta, **Then** a Atingibilidade reflete a qualidade inferior do canal e a evidência deixa claro que não há e-mail corporativo próprio nem telefone.
3. **Given** um lead com site no ar, e-mail funcionando e ferramentas de marketing detectadas, **When** a seção é aberta, **Then** a métrica de Momento indica momento favorável e exibe os sinais que sustentam a leitura.
4. **Given** um lead com situação cadastral suspensa ou baixada, **When** a seção é aberta, **Then** a métrica de Momento sinaliza risco de empresa inativa, com a situação cadastral exibida como evidência.
5. **Given** a tela de qualquer lead, **When** a seção de inteligência é renderizada, **Then** nenhuma das três métricas antigas (Potencial, Prontidão, Lançamento) aparece.
6. **Given** qualquer métrica com dados suficientes, **When** a seção é aberta, **Then** o selo qualitativo é o elemento visual primário e o valor 0–100 aparece como detalhe secundário, sem competir com o julgamento.

---

### User Story 2 — Recomendação de contato única, explicável e acionável (Priority: P1)

A seção sintetiza as métricas — Atingibilidade, Momento — e os fatores já
conhecidos do lead (risco de crédito, aderência ao perfil comercial da
organização) em **uma única recomendação de contato**, em três níveis
intuitivos: **abordar agora**, **abordar com prioridade menor** e **não
priorizar**. A recomendação sempre exibe os **motivos decisivos** (ex.:
"e-mail corporativo válido e empresa investindo em marketing"; "atingível, mas
risco de crédito alto"; "nenhum canal de contato encontrado") e sugere a
próxima ação quando ela existe (ex.: "comece por e-mail", "dispare
enriquecimento para obter contatos").

Hoje o operador precisa cruzar mentalmente três números genéricos, o chip
"Oportunidade", o risco de crédito e a decomposição de sinais para chegar a um
veredito próprio; a partir desta feature existe **um** veredito explícito que
assume essa síntese, e o chip genérico de Oportunidade deixa de competir com
ele dentro da seção.

**Why this priority**: a recomendação é a resposta direta ao pedido — "embasar
a decisão de entrar em contato ou não". Depende das métricas da US-1 para
existir com evidência, por isso vem em sequência, mas na mesma prioridade.

**Independent Test**: abrir leads com perfis distintos (canais bons × sem
canais; momento ativo × CNPJ suspenso; risco alto × baixo) e verificar que a
recomendação reflete cada combinação com motivos explícitos e coerentes entre
si.

**Acceptance Scenarios**:

1. **Given** um lead com bom canal de contato e momento favorável, **When** a seção é aberta, **Then** a recomendação é "abordar agora" com os motivos decisivos exibidos.
2. **Given** um lead sem nenhum canal de contato capturado, **When** a seção é aberta, **Then** a recomendação indica que não há como abordar ainda e sugere a ação de disparar/penalizar enriquecimento para obter contatos.
3. **Given** um lead atingível com risco de crédito alto, **When** a seção é aberta, **Then** a recomendação reflete o risco entre os motivos (ex.: "abordar com cautela") em vez de ignorá-lo.
4. **Given** um lead atingível mas com sinais de empresa parada (site fora do ar, cadastral irregular), **When** a seção é aberta, **Then** a recomendação explica a tensão entre os fatores (atingível × momento ruim) em vez de esconder o conflito.
5. **Given** a seção com a recomendação exibida, **When** o operador inspeciona a decomposição, **Then** consegue ver quanto cada fator (atingibilidade, momento, risco, aderência) contribuiu para o veredito.
6. **Given** um lead que já recebeu contato (canais "Contatado" ou status avançado no funil), **When** a seção é aberta, **Then** a recomendação padrão é exibida acompanhada do contexto "lead já contatado (canal · data)" — sem virar estado dedicado nem recomendação de follow-up separada.

---

### User Story 3 — Ausência de dados não vira número enganoso (Priority: P2)

Quando não há evidência suficiente para calcular uma métrica (ex.: lead ainda
não passou pela etapa que captura contatos, ou nenhuma fonte respondeu), a
métrica exibe um estado honesto de **"sem dados suficientes"** com a orientação
de como obtê-los (ex.: "dispare o enriquecimento para capturar contatos") —
nunca um número baixo que simule precisão e faça um lead parecer ruim por falta
de informação. Hoje, um lead sem dado nenhum recebe nota baixa nas três
métricas, indistinguível de um lead ruim de verdade.

**Why this priority**: protege a confiança do operador nas métricas novas; é
complementar às US-1/US-2 e pode evoluir depois delas sem bloquear o valor
central.

**Independent Test**: abrir um lead recém-importado sem enriquecimento (ou com
enriquecimento parcial) e verificar que cada métrica sem evidência mostra
estado de "sem dados" orientativo, sem valor numérico pretensioso.

**Acceptance Scenarios**:

1. **Given** um lead sem nenhuma evidência de contato nem de presença digital, **When** a seção é aberta, **Then** Atingibilidade e Momento exibem "sem dados suficientes" com orientação de ação, e não um número baixo.
2. **Given** um lead com enriquecimento parcial (contatos capturados, presença digital ainda não), **When** a seção é aberta, **Then** a métrica com evidência exibe valor normal e a outra exibe estado de ausência de dados.
3. **Given** uma métrica baseada em evidência fraca (baixa confiança da fonte), **When** a seção é aberta, **Then** a métrica distingue visualmente essa condição de uma medição sólida, coerente com o padrão de confiança já usado na tela.
4. **Given** um lead cujas evidências foram capturadas há mais de 90 dias, **When** a seção é aberta, **Then** as métricas continuam exibidas com marca de "dados podem estar desatualizados" e sugestão de reenriquecer — sem bloquear nem ocultar o valor.
5. **Given** um lead importado sem CNPJ com sinais digitais capturados, **When** a seção é aberta, **Then** a Momento é calculada a partir dos sinais digitais disponíveis e indica quais sinais oficiais (situação cadastral, idade do CNPJ) estão ausentes — em vez de ficar "sem dados" ou fingir que os tem.

---

### Edge Cases

- **Lead não enriquecido**: a seção permanece no estado de pendência já existente, com chamada para enriquecer; as métricas novas herdam esse estado em vez de exibir zeros.
- **Enriquecimento em andamento**: as métricas recalculam à medida que evidências chegam (comportamento já esperado da tela), sem exigir recarga manual.
- **CNPJ suspenso/baixado**: o Momento deve tratar como sinal forte de empresa inativa, e a recomendação jamais sugere "abordar agora" nesse cenário.
- **Canais mascarados (plano trial)**: as métricas avaliam a existência e a qualidade dos canais, não seus valores — por isso permanecem visíveis a trial; as ações sobre canais (copiar, WhatsApp) seguem bloqueadas como hoje, e nenhum valor mascarado é revelado pelas evidências exibidas.
- **Fatores divergentes**: quando atingibilidade e momento apontam direções opostas, a recomendação explica a tensão nos motivos em vez de reduzir tudo a um número médio sem contexto.
- **Lead sem aderência configurada** (organização sem perfil comercial): a recomendação sintetiza apenas os fatores disponíveis, sem falhar nem inventar neutralidade disfarçada de nota.
- **Métricas antigas em outros pontos do produto**: listas e ordenações que usam o score de oportunidade continuam funcionando inalteradas — o escopo da substituição é a seção de inteligência da tela de detalhes.
- **Lead já contatado**: o painel não diferencia a recomendação por estágio do funil (veredito segue baseado em evidência); o histórico de contato aparece como contexto junto à recomendação, para o operador não ler "abordar agora" sem saber que o lead já está em negociação.
- **Evidências de idades mistas**: quando parte das evidências está desatualizada e parte é recente, o selo de desatualização aplica-se ao fator/métrica cuja evidência é antiga, não ao painel inteiro.
- **Lead sem CNPJ (importado)**: a Momento computa com os sinais digitais disponíveis e sinaliza os sinais oficiais ausentes (situação cadastral, idade do CNPJ), em vez de ficar "sem dados"; quando o CNPJ é resolvido pelo enriquecimento, os sinais oficiais passam a integrar a métrica.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A seção de inteligência de enriquecimento da tela de detalhes do lead MUST deixar de exibir as métricas Potencial, Prontidão e Lançamento, substituídas pelo painel de decisão de contato.
- **FR-002**: O painel de decisão MUST apresentar a métrica **Atingibilidade**, que responde "consigo chegar até este lead?": existência de canais de contato utilizáveis e qualidade do melhor canal (distinguindo e-mail corporativo próprio de endereço de provedor gratuito/terceirizado, e telefonias/WhatsApp válidos), com os canais encontrados como evidência.
- **FR-003**: O painel de decisão MUST apresentar a métrica **Momento**, que responde "este é um bom momento para abordar?": sinais de operação ativa e investimento recente (situação cadastral, site acessível, e-mail funcionando, presença social, ferramentas de marketing/vendas, idade do CNPJ/domínio), com o sinal-chave como evidência.
- **FR-004**: O painel de decisão MUST apresentar **uma única recomendação de contato** em três níveis (abordar agora / prioridade menor / não priorizar), sintetizada a partir de atingibilidade, momento, risco de crédito e aderência ao perfil comercial da organização.
- **FR-005**: A recomendação MUST exibir os motivos decisivos que a sustentam e, quando existir, a próxima ação sugerida (ex.: canal recomendado, disparar enriquecimento).
- **FR-006**: Cada métrica MUST exibir a evidência concreta por trás do valor apresentado (canal encontrado, sinal detectado, situação cadastral), não apenas o número.
- **FR-007**: A recomendação MUST expor a decomposição dos fatores que a compõem, de forma que o operador entenda quanto cada fator contribuiu para o veredito.
- **FR-008**: Uma métrica sem evidência suficiente MUST exibir estado de "sem dados suficientes" com orientação de ação, e MUST NOT apresentar valor numérico que simule medição.
- **FR-009**: O chip genérico "Oportunidade" MUST deixar de aparecer dentro desta seção, substituído pela recomendação como veredito único (o score de oportunidade em si permanece intocado no restante do produto).
- **FR-010**: O risco de crédito MUST continuar visível na seção como fator do veredito.
- **FR-011**: As métricas e a recomendação MUST permanecer visíveis para organizações trial (elas informam decisão sem revelar valores restritos); ações sobre canais mascarados seguem bloqueadas e nenhuma evidência exibida pode revelar valor mascarado.
- **FR-012**: O acesso às métricas e à recomendação MUST respeitar o isolamento por organização.
- **FR-013**: As métricas e a recomendação MUST atualizar-se quando novas evidências de enriquecimento chegam, sem exigir recarga manual, e MUST respeitar o padrão de estados (carregando/erro com retry/vazio) já usado pela tela.
- **FR-014**: A recomendação MUST NOT sugerir "abordar agora" para lead com situação cadastral suspensa/baixada ou risco de crédito alto sem explicitar o motivo entre os fatores decisivos.
- **FR-015**: Para lead que já recebeu contato (canais "Contatado" ou status avançado no funil), a recomendação MUST permanecer no formato padrão, acompanhada do contexto do histórico de contato (canais e data do último contato) — sem estado dedicado nem lógica de recomendação separada.
- **FR-016**: Evidência capturada há mais de 90 dias MUST ser sinalizada visualmente como "dados podem estar desatualizados", com sugestão de reenriquecer o lead; a métrica correspondente MUST continuar exibida (nenhum bloqueio por idade).
- **FR-017**: Cada métrica MUST comunicar seu valor com selo qualitativo como leitura principal (escala tipo Alta/Média/Baixa) e o valor 0–100 como detalhe secundário visível — em nenhuma métrica o número é o elemento primário.
- **FR-018**: Para lead sem CNPJ (importado sem identificador), a métrica de Momento MUST ser calculada com os sinais digitais disponíveis (site, e-mail, social, stack) e MUST indicar quais sinais oficiais estão ausentes; quando o CNPJ for resolvido pelo enriquecimento, os sinais oficiais passam a integrar a métrica.

### Key Entities *(include if feature involves data)*

- **Métrica de decisão**: indicador que responde a uma pergunta do processo decisório de contato (atingibilidade, momento); possui selo qualitativo (leitura principal), valor numérico 0–100 (detalhe secundário) ou estado de ausência de dados, leitura comercial direta e evidências que a sustentam.
- **Evidência**: fato já capturado pelo enriquecimento ou cadastro (canal de contato com classificação e confiança, situação cadastral, site acessível, ferramenta detectada) que sustenta o valor de uma métrica; reaproveita dados existentes — nenhuma nova coleta é criada.
- **Recomendação de contato**: veredito sintetizado em três níveis, com motivos decisivos, decomposição dos fatores e próxima ação sugerida.
- **Canal de contato**: e-mail, telefone ou WhatsApp conhecido do lead, com classificação (corporativo próprio, provedor gratuito, terceirizado) e confiança; insumo da Atingibilidade e sujeito ao mascaramento por plano já existente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em teste de usabilidade, 90% dos operadores respondem corretamente "devo contatar este lead agora?" em menos de 30 segundos olhando apenas a seção — decisão que hoje exige cruzar manualmente múltiplos números sem significado claro.
- **SC-002**: Auditoria contra leads de referência confirma que 100% dos valores exibidos têm a evidência que os sustenta visível na mesma seção.
- **SC-003**: Auditoria de leads sem enriquecimento (ou parcial) confirma zero exibição de valor numérico sem evidência suficiente — apenas estados de "sem dados" orientativos.
- **SC-004**: Nenhuma das três métricas antigas (Potencial, Prontidão, Lançamento) aparece em qualquer ponto da tela de detalhes, verificado por inspeção de todos os estados (enriquecido, parcial, pendente, erro).
- **SC-005**: Em leads de referência com perfis distintos (com/sem canais, CNPJ ativo/suspenso, risco alto/baixo), a recomendação atribui níveis coerentes e explicáveis em 100% dos casos avaliados por um revisor comercial.
- **SC-006**: Auditoria de respostas confirma zero exposição de valores mascarados a organizações trial por meio das métricas, evidências ou recomendação.
- **SC-007**: Em leads de referência com evidências capturadas há mais de 90 dias, o selo de desatualização aparece em 100% dos casos, com a sugestão de reenriquecimento e sem ocultação do valor.

## Assumptions

- **Substituição de superfície**: o escopo é a seção de inteligência da tela de detalhes do lead. Os dados das métricas antigas continuam existindo nos serviços sem quebra; a descontinuação de campos/calculadores obsoletos é decisão posterior, fora desta feature.
- **Nomenclatura final em PT-BR** dos rótulos ("Atingibilidade", "Momento", níveis da recomendação) é refinada no `$speckit-plan`; a spec fixa as perguntas que cada métrica responde e o comportamento exigido, não o texto exato da UI.
- **Sem nova coleta de dados**: as métricas derivam de evidências já capturadas (contatos, presença digital, firmografia, tecnologias, risco, aderência ao perfil comercial existente). Nenhuma capability nova de enriquecimento é criada.
- **Fórmulas e pesos** dos fatores são decisão de implementação (`$speckit-plan`), com testes determinísticos; a spec exige apenas comportamento observável (coerência dos vereditos nos perfis de referência).
- **Aderência ao perfil comercial** (perfil da organização, já existente na plataforma) entra como fator do veredito quando configurada; sem perfil, a recomendação sintetiza os demais fatores.
- **Trial vê métricas**: consistente com o comportamento atual (booleans de e-mail/site já visíveis a trial), pois as métricas informam decisão sem expor valores restritos; canais e ações seguem mascarados/bloqueados.
- **Desktop-first**, padrão das telas da plataforma; responsividade básica sem design dedicado a mobile.
