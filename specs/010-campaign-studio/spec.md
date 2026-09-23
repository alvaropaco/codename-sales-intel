# Feature Specification: Campaign Studio — Criação, Revisão e Orquestração de Campanhas

**Feature Branch**: `010-campaign-studio`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "Revamp da criação de campanhas para outreach e WhatsApp: hoje a criação tem UX não funcional — campanhas de IA disparam na mesma hora sem revisão, não é possível selecionar os leads atingidos (vai para todos os leads prontos para contato) e faltam configurações de disparo por hora. Criar uma feature separada só para campanhas do usuário: um Studio completo dentro do B2Base, com IA para criação (material, URL, prompt), Brand Voice/Kit, Email Studio, WhatsApp Studio, segmentação inteligente sobre os dados de enriquecimento, personalização por lead, automação/journeys, AI Campaign Agent, A/B testing, analytics e diferenciais (Campaign from Material/URL/Company Data, AI Reply Classifier, AI Compliance Guard etc.). Layout: página separada com UI própria, tema primordialmente dark."

## Contexto (o problema hoje)

A criação de campanhas de outreach (e-mail + WhatsApp) existe, mas a
experiência não escala para uso real:

1. **IA sem revisão e sem feedback.** Quando a campanha é automatizada com IA,
   o usuário não tem chance de revisar o que foi gerado nem acompanha o que
   será enviado; em vários caminhos os disparos acontecem na mesma hora, sem
   qualquer vetting. A exceção de hoje (aprovação no fluxo de campanha IA)
   não cobre o fluxo manual e não oferece revisão do conteúdo por lead.
2. **Sem seleção de audiência.** O usuário não escolhe quais leads atingir:
   a campanha simplesmente vai para todos os leads "prontos para contato".
   Não há segmentos salvos, nem prévia de quantos leads serão impactados,
   nem exclusões explícitas.
3. **Sem controle de quando disparar.** Faltam data/hora de início, janelas de
   envio (dias e horários), limites por hora e fuso — o disparo começa
   imediatamente e corre até acabar.
4. **Sem espaço próprio.** A criação vive espremida em abas genéricas do app,
   sem um fluxo pensado para compor conteúdo, audiência, agenda e
   acompanhamento — e sem a identidade visual de um produto de criação.

O B2Base tem um ativo que nenhum "Mailchimp + IA" tem: **os dados de
enriquecimento de cada empresa lead** (setor, porte, localização, saúde
financeira, score de oportunidade, análise profunda). O Campaign Studio
transforma esse ativo em campanhas individualizadas por lead — com o usuário
no controle total do que sai, para quem e quando.

## Clarifications

### Session 2026-09-23

- Q: As suítes automáticas pós-enriquecimento devem continuar disparando sem revisão ou passar pelo fluxo de aprovação do Studio? → A: Guard-rails — aprovação do primeiro lote (amostra real) na criação da automação; disparos seguintes automáticos sob salvaguardas (supressão, opt-out, frequência), pausa automática em anomalia e revisão sob demanda a qualquer momento.
- Q: Quem dentro da organização pode aprovar uma campanha para disparo no Studio? → A: (sem resposta — default aplicado como assumption) qualquer usuário da organização aprova; sem papéis/permissões novos nesta feature.
- Q: Qual o modelo de acesso do Campaign Studio por plano (trial vs premium)? → A: Freemium — Studio base (criar, segmentar, agendar, aprovar, enviar, dashboards) para todos os planos; capacidades de IA avançadas (geração por material/URL, personalização em lote, AI Campaign Agent, otimização contínua, analista de campanha) exclusivas do plano premium.
- Q: Qual o nível do editor visual de e-mail na v1 do Studio? → A: Drag-and-drop completo na v1 — canvas com blocos livres, colunas e redimensionamento.
- Q: Como os follow-ups de e-mail funcionam numa campanha simples do Studio? → A: Follow-ups simples configuráveis por toque (intervalo, condições, quantidade máxima) direto na campanha, sem exigir journey; journeys ficam para fluxos com ramificações complexas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Nenhum disparo sem revisão: criar, revisar, aprovar (Priority: P1)

Dentro do **Campaign Studio** — uma área separada do app, com interface própria
em tema dark — toda campanha nasce como **rascunho** e nenhum disparo acontece
sem passagem explícita por **revisão → aprovação**. Ao abrir uma campanha
gerada por IA (ou montada manualmente), o usuário vê exatamente o que será
enviado: conteúdo por canal, amostra real de mensagens já personalizadas para
leads concretos, e a audiência impactada. Ele edita qualquer texto, descarta
versões, e só quando clica em **Aprovar** a campanha fica elegível a ser
agendada/disparada. Campanhas criadas pela IA ficam em estado "aguardando
revisão" com um resumo do que a IA decidiu (estratégia, audiência sugerida,
tom, canais) — o usuário entende o raciocínio, corrige o que quiser e depois
autoriza. Enquanto não aprovada, **nada é enviado** — nem se o usuário sair
da tela, fechar o navegador ou voltar dias depois.

**Why this priority**: é a quebra de confiança mais grave hoje (disparo sem
vetting) e o pré-requisito de todo o resto do Studio: sem revisão, flexibilidade
só amplia a capacidade de errar em escala.

**Independent Test**: criar uma campanha (manual ou por IA), verificar que ela
fica em rascunho/aguardando revisão sem nenhum envio, inspecionar a prévia por
lead, editar um texto, aprovar e só então ver a campanha elegível a disparo.

**Acceptance Scenarios**:

1. **Given** uma campanha recém-criada por IA, **When** o usuário abre o Studio, **Then** a campanha aparece como "aguardando revisão", com resumo das decisões da IA (objetivo, audiência sugerida, tom, canais) e nenhum disparo foi realizado.
2. **Given** uma campanha em revisão, **When** o usuário visualiza o conteúdo, **Then** ele consegue ver a mensagem que cada canal enviará, incluindo uma amostra de variações personalizadas para leads reais da audiência, e consegue editar qualquer campo inline.
3. **Given** uma campanha não aprovada, **When** o usuário fecha e reabre o Studio horas ou dias depois, **Then** a campanha continua sem enviar nada e mantém o estado de revisão.
4. **Given** uma campanha aprovada, **When** o usuário tenta editar o conteúdo depois do disparo iniciado, **Then** o Studio bloqueia a edição do conteúdo já em fila e oferece pausar a campanha para alterar e re-aprovar.
5. **Given** qualquer caminho de criação (IA, material, prompt, duplicação, template), **When** a campanha é criada, **Then** ela nunca nasce em estado de disparo imediato — o estado inicial é sempre rascunho ou aguardando revisão.

---

### User Story 2 — Audiência explícita: segmentos salvos e seleção de leads (Priority: P1)

Toda campanha declara **para quem** vai. O usuário monta a audiência de três
formas combináveis: **seleção manual** de leads (busca, filtros, seleção em
lote), **segmento salvo** (conjunto nomeado e reutilizável de critérios sobre
qualquer dado do B2Base — setor, porte, faturamento estimado, localização,
cidade/estado/região, score de oportunidade, veredito de análise, status do
lead, engajamento em campanhas anteriores, já-contactado ou não por canal) ou
**importação de lista** (colar/upload de CNPJs ou e-mails). Antes de aprovar,
o Studio mostra **quantos leads** a audiência contém hoje, quantos serão
excluídos por regras de segurança (opt-out, lista de supressão, lead já
contatado recentemente por esse canal), e permite **excluir manualmente**
leads específicos. A audiência é **congelada no momento da aprovação** —
leads que entrarem na base depois não são incorporados sem nova ação do
usuário. Segmentos salvos podem ser criados e reutilizados em qualquer
campanha, e o Studio indica quando um segmento salvo mudou de tamanho desde
a última campanha.

**Why this priority**: disparar para "todos os leads prontos" é hoje o maior
risco de dano (queima de base, banimento de canal); audiência explícita é
condição para qualquer campanha responsável.

**Independent Test**: criar um segmento salvo com 2 critérios, usá-lo numa
campanha, conferir a contagem prévia e a lista de excluídos, agendar e
verificar que apenas os leads da audiência congelada recebem envio.

**Acceptance Scenarios**:

1. **Given** leads com perfis variados na conta, **When** o usuário cria um segmento com critérios (ex.: setor X + estado SP + score ≥ 70), **Then** o Studio mostra a lista resultante com contagem, e o segmento fica salvo com nome para reuso.
2. **Given** uma campanha com segmento selecionado, **When** o usuário revisa a audiência, **Then** ele vê total, excluídos por regras de segurança (opt-out, supressão, contato recente) com o motivo de cada exclusão, e pode remover leads individuais da audiência daquela campanha.
3. **Given** uma campanha aprovada com audiência congelada, **When** novos leads que atendem ao segmento entram na base, **Then** eles NÃO recebem a campanha sem o usuário criar/aprovar um novo envio.
4. **Given** um lead com opt-out ativo ou na lista de supressão, **When** qualquer campanha é montada, **Then** o lead é excluído automaticamente e aparece na lista de excluídos com o motivo — não existe forma de incluí-lo manualmente.
5. **Given** um segmento salvo usado numa campanha anterior, **When** o usuário reutiliza o segmento, **Then** o Studio indica quantos leads o segmento tem agora vs. quando foi usado antes.

---

### User Story 3 — Quando disparar: agendamento e janelas de envio (Priority: P1)

Toda campanha aprovada precisa de uma **agenda**: disparo imediato após
aprovação (escolha explícita), ou **data e hora futuras**. Além do início, o
usuário configura **janelas de envio** — dias da semana e faixas de horário em
que enviar é permitido (ex.: seg–sex, 9h–12h e 14h–18h) — e **ritmo**: número
máximo de envios por hora e por dia, com a fila respeitando esses limites e
pausando fora da janela. O Studio mostra o **fuso horário** de referência
(da conta, com opção de considerar o fuso do lead quando conhecido) e uma
**previsão de conclusão** ("com 400 leads a 30/h dentro da janela, termina em
~3 dias úteis"). Fora da janela, a fila fica pausada com status visível e
retoma sozinha na próxima janela. O usuário pode pausar, retomar, acelerar ou
cancelar a fila a qualquer momento.

**Why this priority**: "disparos na mesma hora sem controle" é um dos três
problemas originais; ritmo e janela são essenciais para entregabilidade e
saúde das contas de envio.

**Independent Test**: agendar uma campanha para o dia seguinte com janela
9h–12h e limite de 5/h, confirmar que nada envia antes, que os envios dentro
da janela respeitam o ritmo e que fora da janela a fila pausa e retoma.

**Acceptance Scenarios**:

1. **Given** uma campanha aprovada, **When** o usuário escolhe agendar para data/hora futura com janela seg–sex 9h–18h e limite de 20/h, **Then** nenhum envio ocorre antes do momento agendado e os envios seguintes respeitam janela e ritmo.
2. **Given** uma campanha em execução, **When** o relógio sai da janela de envio, **Then** a fila pausa com status visível ("pausada fora da janela") e retoma automaticamente na próxima janela.
3. **Given** uma campanha agendada, **When** o usuário a visualiza antes do início, **Then** o Studio exibe a previsão de conclusão baseada no tamanho da audiência e no ritmo configurado.
4. **Given** uma campanha em execução, **When** o usuário pausa, cancela ou altera o ritmo, **Then** a fila obedece imediatamente e leads já enfileirados mas não enviados são preservados (ou descartados no cancelamento, com confirmação).

---

### User Story 4 — Criação por IA: material, URL ou prompt (Priority: P2)

O usuário cria campanhas a partir do que já tem: **upload de material**
(PDF, apresentação, documento, imagem, vídeo com legendagem disponível) ou
**URL** (site do produto, página de lançamento), ou ainda um **prompt em
linguagem natural** ("campaña para vender ERP para indústrias de SP"). A IA
extrai do material **produto, oferta, benefícios, público-alvo e CTA**, mostra
o que entendeu para confirmação, e gera um **pacote de campanha** completo:
título, objetivo, público sugerido (com segmento B2Base proposto), conteúdo
de e-mail (assunto, pré-header, corpo, CTA), mensagem de WhatsApp, sugestão
de timing e **múltiplas versões** em **tons diferentes** (formal, comercial,
técnico, urgente). O pacote é adaptado por canal (e-mail ≠ WhatsApp ≠ texto
para LinkedIn). O usuário compara versões lado a lado, escolhe, edita e segue
para a revisão da US1. Também é possível **reaproveitar campanhas antigas**
como insumo ("faça uma variação desta campanha focada em reativação") e
**gerar a partir dos dados da própria empresa** já cadastrados no onboarding
(perfil comercial, produtos, proposta de valor). Campanhas podem ainda ser
**traduzidas/adaptadas** para outros idiomas mantendo o tom da marca.

**Why this priority**: é o motor de criação do Studio e o diferencial
"Campaign from Material/URL/Company Data"; depende de US1 (toda saída de IA
passa por revisão), mas não dos refinamentos de editor.

**Independent Test**: subir um PDF de produto, confirmar a extração
(produto/oferta/público/CTA), gerar o pacote com 2 tons e conferir que e-mail
e WhatsApp foram gerados adaptados por canal, caindo em revisão.

**Acceptance Scenarios**:

1. **Given** um PDF de apresentação comercial, **When** o usuário o carrega, **Then** a IA apresenta produto, oferta, benefícios, público e CTA extraídos para confirmação, com possibilidade de corrigir antes de gerar.
2. **Given** a confirmação da extração, **When** a IA gera o pacote, **Then** são produzidos título, assunto, pré-header, corpo de e-mail, mensagem de WhatsApp e ao menos 2 versões em tons distintos, com adaptação real por canal (não cópia do mesmo texto).
3. **Given** uma URL de produto, **When** o usuário colar o link, **Then** a IA usa o conteúdo da página como fonte, com o mesmo fluxo de confirmação e geração.
4. **Given** um prompt em linguagem natural, **When** o usuário descreve a campanha, **Then** a IA propõe também um segmento de audiência B2Base coerente com o público descrito, que o usuário pode aceitar ou trocar.
5. **Given** material ilegível, corrompido ou URL inacessível, **When** o processamento falha, **Then** o Studio informa o motivo, preserva o rascunho e oferece nova tentativa ou outra fonte — nada é gerado em silêncio a partir de suposição.
6. **Given** uma campanha existente, **When** o usuário pede uma variação (novo foco, novo tom, outro idioma), **Then** a nova versão nasce como rascunho vinculado à original, sem alterá-la.

---

### User Story 5 — Email Studio (Priority: P2)

O Studio inclui um espaço dedicado à produção de e-mail: **editor visual
drag-and-drop completo** — canvas com blocos (texto, imagem, botão, separador,
colunas) movidos livremente, com colunas e redimensionamento — e **geração
de HTML responsivo por IA** a partir de instrução, de material carregado ou de
referência visual (captura de tela/design). O e-mail suporta **variáveis de
personalização** (nome, empresa, cargo, cidade, setor e demais campos do lead
com dados disponíveis), **conteúdo dinâmico por segmento** (bloco que muda
conforme atributos do lead) e **blocos condicionais** (exibir só se…). O
usuário dispõe de geradores de **assunto**, **pré-header** e **CTA**, com
múltiplas sugestões; **reescrita e revisão por IA** do texto selecionado
(melhorar, encurtar, mudar tom, corrigir); **verificação de spam** (score com
motivos), **verificação de links** (quebrados/rastreadores) e **pré-visualização
desktop/mobile**. Todo link pode receber **UTM automática** com padrão
configurável por campanha. Há um **banco de templates** por objetivo
(prospecção, lançamento, promoção, newsletter, evento, reativação) que serve
de ponto de partida, e um **gerador de imagens** para arte de campanha
(herói, banner), além de upload de mídia própria.

**Why this priority**: e-mail é o canal primário de outreach; sem um espaço
de produção decente, o Studio não substitui o fluxo atual.

**Independent Test**: criar um e-mail a partir de template, aplicar variável
de personalização, gerar 3 assuntos por IA, rodar as verificações (spam,
links) e conferir preview desktop/mobile com UTM aplicada.

**Acceptance Scenarios**:

1. **Given** um template de prospecção, **When** o usuário o seleciona, **Then** o editor abre com blocos editáveis, variáveis substituíveis e preview em desktop e mobile.
2. **Given** um corpo de e-mail redigido, **When** o usuário solicita sugestões de assunto, **Then** recebe múltiplas opções com estilos distintos e pode aplicar com um clique.
3. **Given** um e-mail com links externos, **When** a verificação roda, **Then** o Studio reporta links quebrados e ausência de UTM, oferecendo aplicação automática do padrão de UTM da campanha.
4. **Given** um e-mail com características de spam (palavras, excesso de maiúsculas, links encurtados), **When** a verificação de spam roda, **Then** o Studio apresenta score e motivos acionáveis antes do envio.
5. **Given** uma variável de personalização em um lead sem o dado, **When** o envio é montado, **Then** o Studio aplica o fallback configurado pelo usuário (ex.: omitir a frase) — nunca envia "{{nome}}" literal.
6. **Given** uma captura de tela de um design, **When** o usuário a envia como referência, **Then** a IA gera um e-mail responsivo correspondente em blocos editáveis.

---

### User Story 6 — WhatsApp Studio (Priority: P2)

Espaço dedicado ao WhatsApp: **geração de mensagem a partir da campanha**
(incluindo conversão automática do e-mail em mensagem curta de WhatsApp),
**variáveis dinâmicas por contato**, **botões/CTA** e **mídia** (imagem,
vídeo, documento), com **preview realista** da conversa. A IA gera templates
**no formato compatível com o padrão Meta** (com categorias e variáveis
posicionais), preparando o conteúdo para o protocolo oficial. O usuário monta
**sequências** (toque 1, toque 2 após X dias se não houver resposta…) e
define **fallbacks comportamentais**: WhatsApp após e-mail aberto sem clique,
após clique sem resposta, ou como canal alternativo quando o e-mail falha.
**Respostas recebidas** são detectadas e **classificadas por IA**
(interessado, não interessado, dúvida, pediu reunião, opt-out, fora de
escopo), alimentando o inbox, as sequências (resposta interrompe a sequência)
e os gatilhos de automação (US8). A classificação aparece para confirmação
humana quando a confiança for baixa, e opt-out detectado em qualquer frase
suspende imediatamente todos os contatos com aquele lead.

**Why this priority**: WhatsApp é o segundo canal central do B2Base; as
sequências e fallbacks comportamentais são o que transforma disparo avulso em
conversa bem cuidada.

**Independent Test**: gerar mensagem de WhatsApp a partir de uma campanha de
e-mail, configurar sequência de 2 toques com fallback "abriu e não clicou",
verificar preview, disparo do toque 2 apenas para quem não respondeu e
classificação de uma resposta de teste.

**Acceptance Scenarios**:

1. **Given** uma campanha com e-mail pronto, **When** o usuário pede a versão WhatsApp, **Then** a mensagem gerada é curta, com CTA e variáveis do lead, exibida em preview realista do WhatsApp antes de qualquer envio.
2. **Given** uma sequência de 2 toques com intervalo configurável, **When** o lead responde no toque 1, **Then** o toque 2 é cancelado e a resposta aparece classificada no inbox da campanha.
3. **Given** a condição de fallback "WhatsApp após abertura sem clique em 2 dias", **When** um lead abre o e-mail e não clica em 2 dias, **Then** a mensagem de WhatsApp é enfileirada respeitando janela e ritmo da US3.
4. **Given** uma resposta contendo pedido explícito de não contato, **When** a IA classifica, **Then** o lead é marcado como opt-out, todos os toques futuros são suspensos em todos os canais e o caso aparece para confirmação humana.
5. **Given** um template gerado, **When** o usuário o inspeciona, **Then** ele segue o formato compatível com o padrão de templates Meta (categoria, variáveis posicionais, botões válidos).

---

### User Story 7 — Personalização com IA por lead, usando os dados do B2Base (Priority: P2)

Com um clique, o Studio gera **copy única por empresa**: introdução, proposta
de valor e CTA calibrados com os **dados de enriquecimento do lead** — setor,
porte, localização, site, tecnologias, saúde financeira/crédito, notícias e
movimentos recentes (funding, contratação, expansão) quando disponíveis, e o
veredito da análise profunda. O usuário escolhe o **nível de personalização**
(apenas saudação; introdução personalizada; proposta completa por empresa) e
o Studio gera em lote, com **fila e custo visíveis**. A **prévia de
personalização** mostra a mesma mensagem renderizada para uma amostra de leads
reais (ex.: 10 leads variados) antes de aprovar, e qualquer variação pode ser
editada — a edição pode ser aplicada só àquele lead ou propagada como regra.
Leads sem dados suficientes para personalizar recebem a versão base, nunca
invenção apresentada como fato: a personalização usa apenas dados que existem
na base e sinaliza quando está inferindo.

**Why this priority**: é o diferencial central do produto ("a IA conhece a
empresa para a qual você está vendendo") e o que justifica o Studio frente a
ferramentas genéricas.

**Independent Test**: numa campanha com personalização por setor, abrir a
prévia com 10 leads de setores diferentes, conferir que cada introdução cita
o contexto correto do lead e editar uma delas sem afetar as demais.

**Acceptance Scenarios**:

1. **Given** leads de 3 setores distintos, **When** a personalização por empresa é gerada, **Then** cada mensagem faz referência correta ao setor/contexto do lead, visível na prévia por lead.
2. **Given** um lead sem dados de enriquecimento suficientes, **When** a personalização roda, **Then** o lead recebe a versão base da mensagem e é sinalizado na lista como "sem personalização" — sem dados inventados.
3. **Given** a prévia de personalização, **When** o usuário edita a variação de um lead específico, **Then** a edição vale apenas para aquele lead, com opção explícita de propagar a mudança como regra para os demais.
4. **Given** uma campanha com personalização em lote, **When** a geração está em andamento, **Then** o Studio mostra progresso (leads personalizados / total) e permite pausar.

---

### User Story 8 — Automação: journeys com gatilhos e ramificações (Priority: P3)

O Studio inclui um **construtor visual de journeys**: um canvas onde o usuário
monta o fluxo da campanha com blocos de **envio** (e-mail, WhatsApp),
**espera** (duração ou até data), **ramificação condicional** (abriu/não
abriu, clicou/não clicou, respondeu/não respondeu, score do lead, atributos do
lead), **atualização de estado** e **fim**. Condições de parada global:
resposta do lead, conversão registrada ou opt-out interrompem o journey para
aquele lead em todos os canais. Além dos journeys por lead, há campanhas
**recorrentes e por data**: disparos programados por recorrência (semanal,
mensal), campanhas de datas (aniversário da empresa/contato), de reativação
(leads frios há X dias), de nurturing (série educativa) e de "abandono"
(interagiu e sumiu). Journeys podem começar por **gatilho**: lead entrou no
segmento, behavior (abriu/clicou/respondeu), score cruzou um limite, ou
chamada externa (webhook). Cada bloco mostra estatísticas próprias
(quantos leads passaram, onde os leads estão parados).

**Why this priority**: automação multiplica o valor do Studio, mas só é
segura depois que revisão (US1), audiência (US2) e ritmo (US3) existem.

**Independent Test**: montar um journey e-mail → espera 3 dias → se não
abriu, WhatsApp → se respondeu, parar; simular os três caminhos com leads de
teste e conferir estados e paradas.

**Acceptance Scenarios**:

1. **Given** um journey com ramificação por abertura, **When** os leads passam pelo fluxo, **Then** cada lead segue o caminho correspondente ao seu comportamento real e o canvas mostra a distribuição de leads por bloco.
2. **Given** um journey com parada por resposta, **When** um lead responde em qualquer ponto, **Then** todos os toques futuros dele são cancelados em todos os canais.
3. **Given** uma campanha de reativação recorrente, **When** a recorrência dispara, **Then** a audiência é recalculada pelo segmento salvo, passa pela segurança de exclusão (opt-out/supressão/contato recente) e respeita janela e ritmo — sem exigir reconstrução da campanha.
4. **Given** um gatilho externo (webhook), **When** ele é recebido, **Then** o journey inicia apenas para o lead identificado na chamada, com registro do disparo na timeline dele.
5. **Given** um journey pausado ou com erro em um bloco, **When** o problema ocorre, **Then** os leads afetados ficam retidos no bloco com status visível e o journey não pula etapas em silêncio.

---

### User Story 9 — AI Campaign Agent (Priority: P3)

Um agente conversacional dentro do Studio que recebe um objetivo em linguagem
natural ("quero vender software ERP para indústrias de SP") e produz uma
**campanha completa proposta**: audiência (segmento), estratégia (canais,
sequência, timing), conteúdo de cada toque, variantes e tracking — tudo
apresentado como um **plano revisável**. Nada é ativado sem o usuário avaliar
o plano item a item: ele aceita, edita ou rejeita cada parte (audiência,
estratégia, conteúdos) antes de aprovar a campanha inteira. Após o disparo, o
agente **acompanha os resultados** e propõe alterações (trocar assunto,
ajustar ritmo, pausar segmento com baixa performance) — sempre como
**sugestões com justificativa** que exigem aprovação humana para serem
aplicadas.

**Why this priority**: é o toque-final de diferenciais; exige que os blocos
fundamentais (audiência, conteúdo, agenda, analytics) já existam.

**Independent Test**: descrever um objetivo em linguagem natural, receber o
plano completo da campanha, rejeitar a audiência sugerida, escolher outra,
aprovar — e conferir que nada foi ativado sem essa aprovação.

**Acceptance Scenarios**:

1. **Given** um objetivo descrito em linguagem natural, **When** o agente propõe a campanha, **Then** o plano inclui audiência (segmento), estratégia de canais/timing, conteúdos por toque e configuração de acompanhamento, cada item editável/rejeitável.
2. **Given** um plano proposto, **When** o usuário aprova, **Then** a campanha nasce no estado de revisão da US1 com os itens aprovados — o agente nunca ativa disparo por conta própria.
3. **Given** uma campanha em execução monitorada pelo agente, **When** o agente identifica oportunidade de melhoria, **Then** ele apresenta sugestão com justificativa e só a aplica após aprovação explícita.

---

### User Story 10 — Experimentação e otimização (Priority: P3)

Campanhas podem rodar **testes A/B** — de assunto, de copy, de CTA, de
horário de envio e de canal — com divisão automática da audiência, métricas
por variante e **declaração de vencedor** quando a diferença for
estatisticamente relevante (com critério visível ao usuário: métrica-objetivo,
tamanho mínimo, confiança). Modo opcional **otimização contínua**: a
distribuição de tráfego passa a favorecer progressivamente a variante com
melhor performance. O Studio também recomenda **horário de envio por lead**
(quando houver sinal suficiente de engajamento), detecta **fadiga de
audiência** (frequência excessiva para os mesmos leads) e recomenda
**frequência máxima de contato** por lead. Toda otimização automática é
opcional (ligada/desligada por campanha) e seus efeitos ficam registrados na
timeline da campanha.

**Why this priority**: melhora resultados sobre a base já funcional;
depende de analytics para existir com honestidade.

**Independent Test**: criar campanha com teste A/B de assunto em 20/80,
verificar divisão da audiência, acompanhamento por variante e declaração de
vencedor conforme critério configurado.

**Acceptance Scenarios**:

1. **Given** um teste A/B de assunto com divisão 20/80, **When** a campanha dispara, **Then** a audiência é dividida conforme configurado e cada variante acumula métricas próprias visíveis.
2. **Given** critério de vencedor definido (ex.: taxa de resposta com confiança mínima), **When** o critério é atingido, **Then** o Studio declara o vencedor, registra a decisão e passa a usar a variante vencedora nos envios restantes.
3. **Given** fadiga detectada (lead tocou N vezes em Y dias), **When** o lead entra na fila de qualquer campanha, **Then** o Studio sinaliza a fadiga e, se a política de fadiga estiver ativa, adia ou descarta o toque.
4. **Given** otimização contínua desligada, **When** a campanha roda, **Then** a divisão de audiência permanece estática conforme configurada.

---

### User Story 11 — Analytics do Studio (Priority: P3)

Cada campanha tem um **dashboard**: entregues, aberturas, cliques, respostas,
conversões, bounces, descadastros e, para WhatsApp, entregues/lidos/respondidos
— com **funil completo** etapa a etapa e comparação entre variantes. Cortes de
performance: por **segmento**, por **setor/CNAE**, por **região**, por **canal**
e por **mensagem/toque**. Cada lead tem **timeline individual** (recebeu,
abriu, clicou, respondeu, classificação da resposta, próximas ações). Para
campanhas com conversão definida, o Studio mostra **receita atribuída e ROI**
informados pelo usuário (valor do negócio), deixando claro o que é medido vs.
declarado. O dashboard atualiza próximo ao tempo real, e métricas de canais
sem confirmação oficial (ex.: abertura de e-mail) são **rotuladas como
estimadas**. Há uma visão consolidada de todas as campanhas do Studio com
comparativo de performance.

**Why this priority**: sem feedback de resultado, revisão e otimização são
cegos; analytics fecha o ciclo de melhoria.

**Independent Test**: disparar uma campanha de teste com interações simuladas
(abertura, clique, resposta) e conferir que o funil, os cortes por segmento e
a timeline do lead refletem os eventos.

**Acceptance Scenarios**:

1. **Given** uma campanha em execução, **When** o usuário abre o dashboard, **Then** ele vê o funil completo (enviado → entregue → aberto → clicado → respondido → convertido) com taxas por etapa e volume absoluto.
2. **Given** leads de 3 segmentos na mesma campanha, **When** o usuário filtra por segmento, **Then** as métricas do funil são recalculadas para o segmento selecionado.
3. **Given** um lead específico, **When** o usuário abre a timeline dele, **Then** todos os toques e interações de todos os canais aparecem em ordem cronológica, incluindo classificação de respostas e decisões de automação.
4. **Given** métricas sem confirmação oficial do canal, **When** exibidas, **Then** aparecem rotuladas como estimadas, sem se apresentarem como confirmadas.
5. **Given** uma conversão informada pelo usuário, **When** a receita é registrada no negócio vinculado, **Then** o dashboard da campanha reflete receita atribuída e ROI, distinguindo valor declarado de métrica medida.

---

### User Story 12 — Identidade da marca e conformidade (Priority: P4)

O Studio guarda o **perfil de marca** da organização em duas camadas:
**Brand Voice** — tom de voz aprendido de materiais existentes, textos
aprovados e campanhas passadas, com exemplos de "como nós falamos / como não
falamos" — usado como diretriz em toda geração; e **Brand Kit** — logo, cores,
fontes e elementos visuais aplicados por padrão em e-mails e imagens geradas.
Um **verificador de consistência** analisa qualquer conteúdo pronto e aponta
desvios de tom, terminologia e identidade antes do envio. Em paralelo, o
**AI Compliance Guard** roda em toda campanha antes da aprovação: valida
**opt-in/consentimento** dos leads, aderência à **LGPD** (base de contato,
finalidade), presença de **mecanismo de descadastro** em e-mail, risco de
**spam/banimento** (especialmente WhatsApp) e dados sensíveis indevidos —
produzindo um parecer com níveis (ok / atenção / bloqueio); parecer de
bloqueio impede a aprovação até a correção.

**Why this priority**: protege a marca e a base de leads, mas opera como
camada sobre o fluxo já funcional de criação→revisão→envio.

**Independent Test**: configurar Brand Voice com exemplos, gerar conteúdo
fora do tom, receber apontamento do verificador; rodar Compliance Guard numa
campanha sem descadastro e ver o bloqueio.

**Acceptance Scenarios**:

1. **Given** uma Brand Voice configurada com exemplos, **When** conteúdo gerado se desvia do tom, **Then** o verificador aponta o trecho e o motivo, com sugestão de reescrita alinhada.
2. **Given** um Brand Kit com logo e cores, **When** um e-mail é gerado por IA, **Then** a identidade visual é aplicada por padrão e pode ser ajustada no editor.
3. **Given** uma campanha de e-mail sem mecanismo de descadastro, **When** o Compliance Guard roda, **Then** o parecer é de bloqueio e a aprovação fica indisponível até a correção.
4. **Given** leads sem base legal clara de contato, **When** o Compliance Guard avalia a audiência, **Then** o parecer aponta o risco com o número de leads afetados e sugere exclusão ou revisão do segmento.

---

### User Story 13 — Biblioteca: templates, reuso e estágios do funil (Priority: P4)

O Studio mantém uma **biblioteca** com: templates prontos por objetivo
(prospecção, lançamento, promoção, newsletter, evento, reativação, nurturing),
**campanhas passadas da própria organização** reutilizáveis (duplicar,
adaptar com IA, traduzir) e **campanhas por estágio do funil** (topo
educativo, meio comparativo, fundo com oferta direta) com recomendação de
estágio na criação. Conteúdos podem ser **traduzidos/adaptados** para outros
idiomas preservando variáveis de personalização e links, com revisão humana
antes de salvar. Toda reutilização nasce como novo rascunho — a campanha
original nunca é alterada.

**Why this priority**: acelera operação contínua, mas depende de campanhas
existindo e do fluxo de criação/revisão consolidado.

**Independent Test**: duplicar uma campanha passada, pedir adaptação de tom
e tradução para inglês, conferir variáveis preservadas e original intacta.

**Acceptance Scenarios**:

1. **Given** a biblioteca, **When** o usuário duplica uma campanha passada com adaptação por IA, **Then** um novo rascunho é criado vinculado à original, que permanece inalterada.
2. **Given** um conteúdo em português, **When** o usuário pede tradução para inglês, **Then** variáveis de personalização e links são preservados funcionais e o resultado passa por revisão antes de salvar.
3. **Given** a criação de uma nova campanha, **When** o usuário escolhe o estágio do funil, **Then** os templates e a estrutura sugerida correspondem ao estágio escolhido.

---

### User Story 14 — Diferenciais de IA avançados (Priority: P4)

Pacote de capacidades que fecham o ciclo de inteligência do Studio:
**construtor de segmentos por linguagem natural** ("encontre empresas que
provavelmente precisam disso" → segmento revisável com os critérios
explicados); **audiências lookalike** (a partir dos leads que converteram ou
engajaram); **gerador de follow-up** baseado na interação anterior real do
lead; **classificação de respostas** integrada a **próxima melhor ação**
recomendada por lead (responder, mandar material, agendar call, nutrir,
descansar); **handoff para vendas** — quando a intenção de compra é
detectada, uma tarefa/oportunidade é criada para o time comercial com o
contexto da conversa; **analista de campanha** — perguntas em linguagem
natural sobre performance ("por que essa campanha está performando mal?")
respondidas com os dados da campanha e diagnóstico acionável. Recomendações
são sempre explicáveis (mostram os dados que as motivaram) e ações com efeito
externo (handoff, envio) exigem confirmação humana.

**Why this priority**: diferencial competitivo de longo prazo; cada item é
útil por si, mas nenhum é pré-requisito do Studio operar.

**Independent Test**: criar segmento por linguagem natural, verificar os
critérios gerados e a contagem; simular resposta de interesse e conferir
classificação, próxima ação recomendada e criação da tarefa de handoff.

**Acceptance Scenarios**:

1. **Given** um pedido em linguagem natural, **When** o construtor de segmentos gera o segmento, **Then** os critérios traduzidos ficam visíveis e editáveis antes de salvar, com contagem de leads correspondente.
2. **Given** leads que converteram, **When** uma audiência lookalike é criada, **Then** o Studio explica os atributos usados como base e produz um segmento revisável.
3. **Given** uma resposta classificada como interesse em reunião, **When** o handoff está ativo, **Then** uma tarefa/oportunidade é criada para vendas com o contexto da conversa, mediante confirmação do usuário conforme configuração.
4. **Given** uma campanha com performance abaixo do esperado, **When** o usuário pergunta o motivo, **Then** o analista responde com diagnóstico fundamentado nos dados (entregabilidade, audiência, horário, conteúdo) e sugere ações.
5. **Given** qualquer recomendação do pacote, **When** exibida, **Then** ela cita os dados que a motivam; ações com efeito externo só ocorrem com confirmação humana.

---

### Edge Cases

- **Lead descadastrado a meio da campanha**: todos os toques futuros são
  cancelados em todos os canais, e o fato aparece na timeline.
- **Conta de envio desconecta (e-mail ou WhatsApp) durante a fila**: a fila
  pausa com status de erro visível, nenhum lead é marcado como enviado sem
  confirmação do canal, e o Studio orienta reconexão e retomada.
- **IA indisponível ou timeout na geração**: o rascunho é preservado, o
  usuário é informado e pode tentar novamente ou seguir com conteúdo manual;
  para personalização em lote, os leads já processados mantêm suas variações.
- **Material carregado vazio, protegido por senha ou ilegível**: erro
  explicável com motivo, sem geração silenciosa a partir de suposições.
- **Audiência resultante vazia (segmento sem matches ou todos excluídos)**:
  a campanha não pode ser aprovada; o Studio explica quais filtros zeraram a
  audiência.
- **Placeholders sem dado no lead**: fallback configurável; nunca envia
  variável literal (ex.: "{{nome}}") ao lead.
- **Conflito de campanhas simultâneas sobre o mesmo lead**: o Studio aplica
  a política de frequência configurada (adiar, priorizar campanha de maior
  prioridade ou bloquear) e registra a decisão.
- **Fuso horário**: janelas e agendamentos têm fuso explícito; leads com fuso
  conhecido podem ter janela própria configurável — nunca envia de madrugada
  por engano sem isso estar explícito na configuração.
- **Limite de ritmo conflitante entre campanhas na mesma conta de envio**: os
  limites por conta são respeitados globalmente, com fila justa visível ao
  usuário.
- **Retenção sanitária de conteúdo (regra existente de saneamento)**: conteúdos
  retidos por política de qualidade aparecem na revisão com o motivo e não
  podem ser aprovados sem re-geração/correção.
- **Plano trial**: funcionalidades de IA avançadas respeitam o gating por
  plano; o Studio comunica claramente o que está indisponível e por quê, sem
  expor dados restritos de leads trial.
- **Campanha cancelada com envios em voo**: leads já enviados permanecem com
  status real; os demais saem da fila com status "cancelado" e motivo.

## Requirements *(mandatory)*

### Functional Requirements

**Studio e fluxo de aprovação**

- **FR-001**: O sistema MUST oferecer o Campaign Studio como área separada do aplicativo, com navegação, layout e identidade visual próprios, em tema primordialmente dark.
- **FR-002**: O sistema MUST criar toda campanha em estado não-disparável (rascunho ou aguardando revisão), independentemente da origem (IA, material, template, duplicação, manual).
- **FR-003**: O sistema MUST exigir ação explícita de aprovação do usuário antes que qualquer campanha se torne elegível a envio; a única exceção são automações criadas com opt-in explícito do usuário (ex.: suíte pós-enriquecimento), que exigem aprovação do primeiro lote (amostra real das mensagens) na criação e, aprovadas, seguem disparando automaticamente sob salvaguardas: exclusões obrigatórias sempre aplicadas, limites de frequência respeitados, pausa automática ao detectar anomalia (ex.: queda brusca de entregabilidade, pico de opt-out) e possibilidade de exigir revisão a qualquer momento.
- **FR-004**: O sistema MUST apresentar, na revisão, o conteúdo por canal, uma amostra de mensagens personalizadas para leads reais da audiência e o resumo das decisões tomadas pela IA (quando houver).
- **FR-005**: O sistema MUST permitir edição de qualquer conteúdo na revisão, com as edições preservadas e rastreáveis (quem/quando/quê).
- **FR-006**: O sistema MUST bloquear edição do conteúdo já em fila após o início do disparo, oferecendo pausar → alterar → re-aprovar.
- **FR-007**: O sistema MUST exibir estados claros da campanha (rascunho, aguardando revisão, agendada, em execução, pausada, concluída, cancelada, retida) e o motivo de estados retidos.

**Audiência e segmentação**

- **FR-008**: O sistema MUST permitir montar a audiência por seleção manual (busca, filtros, lote) e por segmento salvo com critérios combináveis sobre os dados do lead: atributos da empresa (setor, porte, faturamento estimado, localização até região/estado/cidade, CNAE quando disponível), qualidade (score de oportunidade, veredito de análise), status do ciclo de vida e histórico de engajamento/contato por canal.
- **FR-009**: O sistema MUST permitir salvar segmentos com nome, reutilizá-los entre campanhas e indicar variação de tamanho desde o último uso.
- **FR-010**: O sistema MUST permitir importar audiência por lista de CNPJs/e-mails da própria conta, respeitando isolamento por organização.
- **FR-011**: O sistema MUST exibir, antes da aprovação, a contagem da audiência e a lista de exclusões obrigatórias (opt-out, supressão, contato recente no canal) com o motivo de cada exclusão.
- **FR-012**: O sistema MUST permitir exclusão manual de leads da audiência de uma campanha — exceto leads com opt-out/supressão, que não podem ser incluídos por nenhum caminho.
- **FR-013**: O sistema MUST congelar a audiência no momento da aprovação; novos leads só entram com nova ação explícita do usuário (ex.: re-sincronizar segmento em campanha futura/recorrente).
- **FR-014**: O sistema MUST permitir criar segmentos a partir de descrição em linguagem natural, exibindo os critérios traduzidos de forma editável antes de salvar.
- **FR-015**: O sistema MUST permitir criar audiências lookalike a partir de leads que converteram ou engajaram, com explicação dos atributos-base.

**Agendamento e ritmo**

- **FR-016**: O sistema MUST permitir disparo imediato (após aprovação) ou agendado para data e hora futuras, com fuso horário explícito.
- **FR-017**: O sistema MUST permitir configurar janelas de envio por dias da semana e faixas de horário, pausando fora da janela e retomando automaticamente.
- **FR-018**: O sistema MUST permitir configurar limites de envio por hora e por dia, respeitados pela fila de cada campanha.
- **FR-019**: O sistema MUST respeitar limites globais por conta de envio quando múltiplas campanhas compartilham a mesma conta, com fila justa e visível.
- **FR-020**: O sistema MUST exibir previsão de conclusão da campanha com base na audiência, ritmo e janelas configuradas.
- **FR-021**: O sistema MUST permitir pausar, retomar, alterar ritmo e cancelar a fila a qualquer momento, preservando o estado real de cada lead.
- **FR-022**: O sistema MUST permitir, opcionalmente, considerar o fuso horário do lead (quando conhecido) nas janelas de envio.
- **FR-079**: O sistema MUST permitir configurar follow-ups de e-mail por toque diretamente na campanha (intervalo entre toques, condição de envio, quantidade máxima), sem exigir a montagem de um journey; journeys ficam para sequências com ramificações condicionais.

**Criação assistida por IA**

- **FR-023**: O sistema MUST aceitar como fonte de criação: upload de material (PDF, apresentação, documento, imagem, vídeo), URL e prompt em linguagem natural.
- **FR-024**: O sistema MUST extrair e apresentar para confirmação: produto, oferta, benefícios, público-alvo e CTA, antes de gerar conteúdo.
- **FR-025**: O sistema MUST gerar pacote de campanha completo: título, objetivo, assunto, pré-header, corpo de e-mail, mensagem de WhatsApp, sugestão de segmento e de timing, e no mínimo duas versões em tons distintos.
- **FR-026**: O sistema MUST adaptar o conteúdo por canal (e-mail, WhatsApp, e texto para LinkedIn), sem copiar o mesmo texto entre canais.
- **FR-027**: O sistema MUST permitir gerar campanhas a partir do perfil comercial e do contexto de negócio já cadastrados da organização.
- **FR-028**: O sistema MUST permitir variação/adaptação de campanhas existentes (novo foco, tom, idioma) sempre como novo rascunho vinculado, nunca alterando a original.
- **FR-029**: O sistema MUST preservar rascunhos e informar falhas de geração de forma explicável, com possibilidade de nova tentativa.
- **FR-030**: O sistema MUST registrar a origem do conteúdo (gerado por IA, template, manual, migrado) para auditoria de cada mensagem enviada.

**Email Studio**

- **FR-031**: O sistema MUST oferecer editor visual de e-mail drag-and-drop completo — canvas com blocos (texto, imagem, botão, separador, colunas) movidos livremente, colunas e redimensionamento — com salvamento automático.
- **FR-032**: O sistema MUST gerar HTML responsivo por IA a partir de instrução textual, de material carregado ou de referência visual (captura de tela).
- **FR-033**: O sistema MUST suportar variáveis de personalização com fallback configurável por variável; envio de variável literal não resolvida é proibido.
- **FR-034**: O sistema MUST suportar conteúdo dinâmico por segmento e blocos condicionais dentro do e-mail.
- **FR-035**: O sistema MUST oferecer geradores de assunto, pré-header e CTA com múltiplas sugestões, e reescrita/revisão por IA do trecho selecionado.
- **FR-036**: O sistema MUST oferecer verificação de spam com score e motivos, verificação de links e pré-visualização desktop/mobile antes da aprovação.
- **FR-037**: O sistema MUST aplicar UTM automática aos links, com padrão configurável por campanha.
- **FR-038**: O sistema MUST manter banco de templates por objetivo, aplicáveis como ponto de partida de qualquer campanha.
- **FR-039**: O sistema MUST oferecer geração de imagens para campanha e upload de mídia própria, sujeitas a limites por plano.

**WhatsApp Studio**

- **FR-040**: O sistema MUST gerar mensagem de WhatsApp a partir da campanha, incluindo conversão automática de e-mail em mensagem curta.
- **FR-041**: O sistema MUST suportar variáveis dinâmicas por contato, botões/CTA e mídia (imagem, vídeo, documento) com preview realista da conversa.
- **FR-042**: O sistema MUST gerar templates no formato compatível com o padrão Meta (categoria, variáveis posicionais, botões válidos).
- **FR-043**: O sistema MUST suportar sequências de WhatsApp com intervalos configuráveis por passo, interrompidas por resposta do lead.
- **FR-044**: O sistema MUST suportar fallbacks comportamentais: WhatsApp após abertura sem clique, após clique sem resposta e como alternativa a falha de e-mail, sempre respeitando janela/ritmo/frequência.
- **FR-045**: O sistema MUST detectar e classificar respostas por IA (interessado, não interessado, dúvida, reunião, opt-out, fora de escopo), com confirmação humana em baixa confiança.
- **FR-046**: O sistema MUST suspender imediatamente todos os contatos futuros com um lead em todos os canais quando opt-out for detectado ou declarado.

**Personalização com IA**

- **FR-047**: O sistema MUST gerar personalização por empresa (introdução, proposta de valor, CTA) usando somente dados existentes na base do lead (enriquecimento, análise, engajamento), sinalizando o que for inferência.
- **FR-048**: O sistema MUST oferecer níveis de personalização configuráveis (saudação, introdução, proposta completa) com geração em lote, progresso visível e possibilidade de pausa.
- **FR-049**: O sistema MUST oferecer prévia da personalização renderizada para amostra de leads reais antes da aprovação.
- **FR-050**: O sistema MUST permitir edição por lead, com opção de aplicar somente àquele lead ou propagar como regra.
- **FR-051**: O sistema MUST aplicar versão base (sem personalização) a leads sem dados suficientes, sinalizados na lista.

**Automação**

- **FR-052**: O sistema MUST oferecer construtor visual de journeys com blocos de envio, espera, ramificação condicional (por comportamento, score e atributos do lead), atualização de estado e fim.
- **FR-053**: O sistema MUST suportar condições de parada global por lead: resposta, conversão ou opt-out interrompem o journey em todos os canais.
- **FR-054**: O sistema MUST suportar gatilhos de início: entrada no segmento, comportamento (abriu/clicou/respondeu), cruzamento de score e chamada externa autenticada.
- **FR-055**: O sistema MUST suportar campanhas recorrentes e baseadas em datas (reativação, aniversário, nurturing, abandono) com recálculo de audiência pelo segmento salvo e passagem pelas mesmas salvaguardas de exclusão.
- **FR-056**: O sistema MUST exibir estatísticas por bloco do journey (leads que passaram, onde estão retidos).

**AI Campaign Agent**

- **FR-057**: O sistema MUST aceitar objetivo em linguagem natural e propor plano completo de campanha (audiência, estratégia, conteúdos, timing, acompanhamento), com cada item independente para aceitar/editar/rejeitar.
- **FR-058**: O sistema MUST ativar campanhas propostas pelo agente somente após aprovação explícita, permanecendo o agente incapaz de disparar por conta própria.
- **FR-059**: O sistema MUST permitir que o agente monitore resultados e proponha alterações com justificativa, aplicáveis apenas com aprovação humana.

**Experimentação e otimização**

- **FR-060**: O sistema MUST suportar testes A/B por assunto, copy, CTA, horário e canal, com divisão configurável da audiência e métricas por variante.
- **FR-061**: O sistema MUST declarar vencedor segundo critério explícito configurado (métrica-objetivo, tamanho mínimo, confiança) e registrar a decisão.
- **FR-062**: O sistema MUST oferecer otimização contínua opcional por campanha, com efeitos registrados na timeline.
- **FR-063**: O sistema MUST detectar fadiga de audiência e aplicar política de frequência configurável (adiar, bloquear), com decisão registrada.

**Analytics**

- **FR-064**: O sistema MUST oferecer dashboard por campanha com funil completo e métricas por canal (entrega, abertura, clique, resposta, conversão, bounce, descadastro; WhatsApp: entrega/leitura/resposta).
- **FR-065**: O sistema MUST permitir cortes de performance por segmento, setor/CNAE, região, canal e mensagem/toque.
- **FR-066**: O sistema MUST manter timeline individual por lead com todos os toques, interações, classificações e decisões de automação.
- **FR-067**: O sistema MUST rotular métricas estimadas (sem confirmação oficial do canal) como estimadas.
- **FR-068**: O sistema MUST permitir registrar conversão com valor informado pelo usuário e exibir receita atribuída e ROI por campanha, distinguindo declarado de medido.
- **FR-069**: O sistema MUST oferecer visão consolidada de todas as campanhas com comparativo de performance.

**Marca e conformidade**

- **FR-070**: O sistema MUST permitir configurar Brand Voice (aprendida de materiais/textos aprovados/campanhas passadas, com exemplos positivos e negativos) aplicada como diretriz nas gerações.
- **FR-071**: O sistema MUST permitir configurar Brand Kit (logo, cores, fontes) aplicado por padrão em e-mails e imagens geradas.
- **FR-072**: O sistema MUST verificar consistência do conteúdo pronto com a marca (tom, terminologia, identidade) e apontar desvios com sugestão de correção.
- **FR-073**: O sistema MUST executar verificação de conformidade em toda campanha antes da aprovação (consentimento/opt-in, LGPD, mecanismo de descadastro em e-mail, risco de spam/banimento, dados sensíveis), com parecer em níveis ok/atenção/bloqueio; bloqueio impede aprovação.
- **FR-074**: O sistema MUST respeitar isolamento por organização em todos os dados do Studio (campanhas, segmentos, materiais, marca, templates, métricas).

**Diferenciais avançados**

- **FR-075**: O sistema MUST recomendar próxima melhor ação por lead com base na interação e classificação, de forma explicável.
- **FR-076**: O sistema MUST suportar handoff para vendas por detecção de intenção de compra, criando tarefa/oportunidade com contexto, mediante confirmação conforme configuração.
- **FR-077**: O sistema MUST responder perguntas em linguagem natural sobre a performance de uma campanha com diagnóstico fundamentado nos dados e sugestões acionáveis.
- **FR-078**: O sistema MUST gerar follow-ups baseados na interação anterior real do lead (abriu, clicou, respondeu, ficou silencioso).

### Key Entities *(include if feature involves data)*

- **Campanha (Studio)**: a unidade central — objetivo, estágio do funil, canais, estado (rascunho → revisão → aprovada → agendada → em execução → concluída/cancelada), origem (IA/material/prompt/template/duplicação/manual), aprovação (quem, quando, parecer de conformidade) e vínculos com audiência, agenda e conteúdos.
- **Conteúdo de campanha**: material versionado por canal (e-mail, WhatsApp, texto LinkedIn) com variantes e tons; personalizações por lead referenciadas como variações do conteúdo base; histórico de edições e origem (IA/manual).
- **Segmento**: conjunto nomeado e reutilizável de critérios sobre leads (empresa, qualidade, ciclo de vida, engajamento); audiência da campanha é um snapshot congelado de um segmento/seleção no momento da aprovação, com exclusões aplicadas e motivos.
- **Agenda**: início (imediato/agendado), janelas de envio (dias + faixas + fuso), limites por hora/dia, previsão de conclusão; estado da fila por lead.
- **Journey**: grafo de blocos (envio, espera, condição, atualização, fim) com gatilhos de entrada, condições de parada global e estatísticas por bloco.
- **Perfil de marca**: Brand Voice (diretrizes e exemplos) + Brand Kit (logo, cores, fontes) por organização.
- **Material de origem**: arquivo/URL/prompt carregado como base de geração, com extração confirmada (produto, oferta, benefícios, público, CTA).
- **Template**: item da biblioteca por objetivo/estágio do funil, com conteúdo por canal e variáveis declaradas.
- **Experimento**: teste A/B (dimensão testada, variantes, divisão, critério de vencedor, resultado) e otimização contínua (status, decisões).
- **Mensagem enviada**: instância por lead/canal/toque com estado real do canal, origem do conteúdo, variante do experimento e personalização aplicada.
- **Evento de interação**: entrega, abertura, clique, resposta, classificação de resposta, descadastro, bounce, conversão — alimentando funil, cortes e timeline do lead.
- **Parecer de conformidade**: resultado da verificação pré-aprovação (itens checados, nível, motivos, leads afetados).
- **Recomendação do agente/otimização**: sugestão com justificativa, dados que a motivam, status (proposta/aplicada/rejeitada) e aprovação humana quando aplicável.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das campanhas com conteúdo gerado por IA passam por revisão com aprovação humana explícita antes do primeiro envio — zero disparos sem aprovação, verificado por auditoria dos estados.
- **SC-002**: 100% dos disparos respeitam a audiência congelada aprovada — zero envios para leads fora da audiência ou com opt-out/supressão ativa.
- **SC-003**: 100% dos disparos respeitam janela de envio e limites por hora/dia configurados — zero envios fora da janela.
- **SC-004**: Um usuário consegue criar, revisar e agendar sua primeira campanha no Studio em até 10 minutos (fluxo guiado com IA em até 5 minutos após material/prompt pronto), medido em teste de usabilidade.
- **SC-005**: A geração do pacote completo de campanha (e-mail + WhatsApp + variantes) a partir de material ou prompt leva menos de 2 minutos para audiências típicas, com progresso visível.
- **SC-006**: Na prévia de personalização, a mensagem renderizada para um lead corresponde exatamente ao que ele receberá em 100% dos casos amostrados.
- **SC-007**: O dashboard da campanha reflete um evento de interação em até 5 minutos após sua ocorrência, com métricas estimadas rotuladas.
- **SC-008**: Em teste de usabilidade, 90% dos usuários conseguem montar um segmento salvo com 2+ critérios e usá-lo numa campanha sem ajuda externa.
- **SC-009**: Redução de 50% no tempo médio de criação de uma campanha multicanal comparado ao fluxo atual, medido com a mesma tarefa nos dois fluxos.
- **SC-010**: O Studio opera com contas de 50.000 leads por organização mantendo as operações de audiência (filtrar, contar, congelar) responsivas na percepção do usuário (sem travamentos perceptíveis).
- **SC-011**: 0 mensagens enviadas com variável literal não resolvida ou conteúdo retido pela verificação de conformidade em nível bloqueio.

## Assumptions

- **Coexistência e migração**: o Studio é a experiência nova e primária de criação; campanhas e automações existentes (ex.: suíte pós-enriquecimento) continuam operando durante a transição e aparecem no Studio ao menos em modo leitura/acompanhamento. Ao serem adotadas pelo Studio, as automações existentes ganham o modelo de guard-rails (aprovação do primeiro lote + salvaguardas + pausa por anomalia). A substituição definitiva das telas atuais é passo posterior.
- **Canais do escopo**: e-mail e WhatsApp são os canais de envio da v1, reutilizando as contas de envio e conexões já suportadas pela plataforma. LinkedIn entra como geração de texto para uso manual — automação de LinkedIn está fora do escopo.
- **Templates Meta**: a geração segue o formato compatível com o padrão de templates do Meta; o envio em v1 continua pelos meios de conexão atuais, com o formato correto servindo de base para migração futura ao protocolo oficial.
- **Gating por plano**: o acesso ao Studio é freemium — a base (criar, segmentar, agendar, aprovar, enviar, dashboards) serve a todos os planos; as capacidades de IA avançadas — geração por material/URL, personalização em lote, AI Campaign Agent, otimização contínua e analista de campanha — seguem o modelo de gating premium já praticado na plataforma (coerente com campanhas IA serem premium hoje), com limites de uso comunicados na interface. Armazenamento de materiais e geração de imagens têm cotas por plano.
- **Modelo de contato**: a personalização por pessoa usa os campos de contato existentes por lead (um contato principal por empresa); uma agenda de múltiplos contatos por empresa está fora do escopo desta feature.
- **Idiomas**: a interface do Studio é em português; tradução/multi-idioma aplica-se ao conteúdo das campanhas, não à interface.
- **Permissões**: qualquer usuário da organização pode criar, editar e aprovar campanhas no Studio — sem introduzir papéis/permissões nesta feature (alinhado ao princípio de simplicidade incremental); controle granular de aprovação por papel fica como evolução futura.
- **Conformidade**: mecanismos existentes de supressão, opt-out e retenção sanitária de conteúdo permanecem válidos e são integrados ao Studio (o Compliance Guard os consolida na revisão); a LGPD é tratada no âmbito de comunicação comercial com leads de negócio.
- **Métricas de canal**: abertura/entrega de e-mail seguem sendo estimadas por inferência do provedor; WhatsApp mantém confirmações do webhook da conexão. O Studio rotula a natureza de cada métrica.
- **Automação segura**: gatilhos externos (webhook) exigem autenticação e identificam um lead específico; journeys nunca criam audiências novas sem passar pelas salvaguardas de exclusão (US2).
