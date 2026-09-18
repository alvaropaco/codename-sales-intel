# Feature Specification: Onboarding Conversacional com IA (Ava)

**Feature Branch**: `004-ai-onboarding`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Transformar o onboarding em um onboarding baseado em IA, sem campos e formulários. No primeiro acesso, o usuário cai direto em uma tela de chat com a IA (Ava), que faz perguntas relevantes para preencher os dados de cadastro e configurações da conta. Ao final, resumo completo e transição automática para o dashboard; sidebar passa a exibir workspace com nome da empresa e e-mail, e CRM com badge verde. Tudo persistido no estado — pronto para conectar a uma API real."

## Contexto (o problema hoje)

O primeiro acesso à plataforma cai em um assistente de configuração em formato
de **formulário em etapas** (modal com 5 passos e mais de uma dezena de campos
abertos: nome da empresa, segmentos, CNAEs, regiões, porte, ticket médio,
ciclo de venda, proposta de valor...). A experiência é burocrática e impessoal:
o usuário digita muito, entende pouco do porquê de cada pergunta e abandona no
meio. Os dados coletados alimentam a inteligência da plataforma, mas a coleta
não conversa com o usuário — ela o interroga.

A proposta é substituir o formulário por uma **conversa com a Ava**, a IA de
onboarding: o usuário cai direto em um chat, responde poucas e progressivas
perguntas — a maioria com um clique — e sai do onboarding com a conta
configurada e o dashboard personalizado. Menos atrito, mais sensação de produto
inteligente desde o primeiro segundo.

## Clarifications

### Session 2026-09-18

- Q: Em que momento da experiência a Ava deve pedir os ativos de negócio (site institucional, materiais de apresentação e catálogo de produtos)? → A: Dentro da conversa principal: viram 3 perguntas adicionais (12 no total — ordem: 10. site institucional, 11. materiais de apresentação, 12. catálogo de produtos online), todas puláveis.
- Q: Nesta primeira entrega, o que a plataforma deve fazer com os ativos de negócio informados (site, pitch deck, PDFs, catálogo) — apenas coletar, ou já extrair os dados do negócio por IA durante o onboarding? → A: Já extrair nesta iteração: a Ava processa site e materiais durante a própria conversa, confirma na conversa o que absorveu e popula o contexto de negócio (efêmero, no estado, como o restante desta iteração).
- Q: Quem deve receber a nova conversa de onboarding — apenas contas recém-criadas, ou também usuários existentes que ainda não concluíram o onboarding atual? → A: Todos que não concluíram o onboarding veem a conversa; a Ava pré-preenche/propõe o que já sabe da conta (empresa, e-mail) para acelerar quem já existe.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Primeiro acesso cai direto na conversa com a Ava (Priority: P1)

Um usuário recém-autenticado, que ainda não concluiu o onboarding, ao entrar na
plataforma **não vê nenhum formulário**: vê uma tela de chat. A Ava se
apresenta (diz o nome e, em uma ou duas frases, que vai configurar a conta
dele juntos) e conduz **12 perguntas progressivas, uma por vez** — 9 de
configuração da conta, nesta ordem:

1. Nome
2. Empresa
3. Cargo
4. Setor
5. Tamanho do time
6. Objetivo principal
7. CRM em uso
8. Mercado-alvo
9. E-mail

E, em seguida, 3 de ativos de negócio: 10. site institucional, 11. materiais de
apresentação (pitch deck, apresentações, documentos, PDFs), 12. catálogo de
produtos online (detalhes na User Story 5). A cada resposta, a Ava reconhece
brevemente o que ouviu antes de fazer a pergunta seguinte. Nada além das 12
perguntas é exigido para concluir; delas, apenas nome, empresa e e-mail são
obrigatórias.

**Why this priority**: é o coração da feature — sem a conversa guiada que
substitui o formulário no primeiro acesso, não há onboarding conversacional.

**Independent Test**: criar uma conta nova, acessar a plataforma e percorrer a
conversa da Ava até a décima segunda pergunta sem encontrar nenhum formulário
tradicional.

**Acceptance Scenarios**:

1. **Given** usuário autenticado que ainda não concluiu o onboarding, **When** acessa a plataforma, **Then** vê a tela de conversa com a Ava (nenhum formulário tradicional é exibido) e a Ava se apresenta e faz a primeira pergunta (nome).
2. **Given** conversa em andamento, **When** o usuário responde uma pergunta, **Then** a Ava registra a resposta, reage brevemente ao que foi dito e faz a próxima pergunta da sequência — sempre uma pergunta por vez.
3. **Given** as 12 perguntas na ordem definida, **When** o usuário responde todas, **Then** nenhuma pergunta extra é exigida para concluir o onboarding.
4. **Given** conta existente que nunca concluiu o onboarding, **When** acessa a plataforma, **Then** vê a mesma conversa, com as respostas já conhecidas da conta (empresa, e-mail) pré-preenchidas para confirmar.

---

### User Story 2 — Responder sem digitar: chips, texto natural e "···" (Priority: P2)

A conversa minimiza digitação. As perguntas de escolha (cargo, setor, tamanho
do time, objetivo principal, CRM em uso, mercado-alvo) aparecem como **chips
clicáveis** — um toque responde. O mercado-alvo aceita **múltiplas seleções**;
as demais são de seleção única. Todas as perguntas de chips oferecem uma opção
"Outro" que abre texto livre. As perguntas abertas (nome, empresa, e-mail) usam
um **campo de texto natural com Enter para enviar**. Quando a conta já tem
e-mail conhecido, a pergunta de e-mail chega **pré-preenchida para confirmar**.
Entre a resposta do usuário e a próxima mensagem da Ava, aparece o **indicador
de digitação animado (···)**, dando sensação de conversa viva.

**Why this priority**: é o que torna a experiência "zero digitação quando
possível" e a sensação de IA real — o valor percebido da feature depende disso,
mas só faz sentido sobre a conversa já existente (US1).

**Independent Test**: percorrer o onboarding respondendo todas as perguntas de
chips com um clique e as abertas com Enter, observando o indicador "···" entre
cada resposta.

**Acceptance Scenarios**:

1. **Given** pergunta de escolha (ex.: setor), **When** o usuário clica em um chip, **Then** a resposta fica marcada como selecionada e a conversa segue sem nenhuma digitação.
2. **Given** pergunta de mercado-alvo, **When** o usuário clica em vários chips, **Then** todas as seleções são aceitas e confirmadas juntas como resposta.
3. **Given** nenhuma opção de chip se aplica, **When** o usuário escolhe "Outro", **Then** um campo de texto livre é aberto para a resposta.
4. **Given** pergunta aberta (nome, empresa ou e-mail), **When** o usuário digita a resposta e aperta Enter, **Then** a resposta é enviada e a conversa segue.
5. **Given** conta com e-mail já conhecido, **When** chega a pergunta de e-mail, **Then** o campo aparece pré-preenchido com o e-mail da conta para confirmar (sem exigir redigitação).
6. **Given** resposta enviada, **When** a Ava prepara a próxima mensagem, **Then** o indicador de digitação animado (···) é exibido até a mensagem aparecer.

---

### User Story 3 — Resumo do que foi configurado e transição automática (Priority: P2)

Ao fim das 12 perguntas, a Ava exibe um **resumo completo** — nome, empresa,
cargo, setor, tamanho do time, objetivo principal, CRM, mercado-alvo e e-mail,
além dos ativos de negócio informados (site, materiais, catálogo) — do que foi
configurado, e pergunta se está correto. O usuário pode **ajustar
qualquer item** (a Ava refaz apenas aquela pergunta e atualiza o resumo) ou
confirmar. Após a confirmação, a Ava se despede e a aplicação faz a **transição
automática para o dashboard**, sem nenhum clique ou passo extra.

**Why this priority**: fecha o ciclo com confiança (o usuário revisa o que a
conta recebeu) e entrega a promessa de sair do onboarding direto no produto.
Depende da conversa (US1) para existir.

**Independent Test**: concluir as 12 perguntas, conferir o resumo, ajustar um
item, confirmar e verificar a chegada automática ao dashboard.

**Acceptance Scenarios**:

1. **Given** as 12 perguntas respondidas ou puladas, **When** a conversa termina, **Then** um resumo completo de tudo o que foi configurado é exibido pelo chat.
2. **Given** o resumo exibido, **When** o usuário pede ajuste de um item, **Then** a Ava refaz somente aquela pergunta e o resumo é atualizado.
3. **Given** o resumo confirmado, **When** a Ava encerra a conversa, **Then** a aplicação transiciona automaticamente para o dashboard, sem clique adicional.

---

### User Story 4 — A plataforma reflete a conta configurada (Priority: P3)

Concluído o onboarding, a aplicação reflete imediatamente a conta configurada:
o **workspace na sidebar mostra o nome da empresa e o e-mail do usuário**; o
**CRM informado aparece no rodapé da sidebar com badge verde** (quando nenhum
CRM foi informado, o rodapé mostra estado neutro com caminho para configurar
depois). Tudo é **persistido no estado do aplicativo** por meio de uma fronteira
de serviço única e coesa, com contrato de dados estável — pronta para ser
trocada por uma API real sem alterar nenhuma tela.

**Why this priority**: materializa o resultado do onboarding no produto e
prepara a integração real, mas só é observável depois que a conversa (US1–US3)
funciona.

**Independent Test**: concluir o onboarding e, no dashboard, verificar nome da
empresa e e-mail na sidebar e o badge verde do CRM no rodapé; navegar entre
telas e conferir que os dados permanecem.

**Acceptance Scenarios**:

1. **Given** onboarding concluído, **When** o dashboard aparece, **Then** a sidebar exibe o workspace com o nome da empresa e o e-mail do usuário.
2. **Given** CRM informado durante a conversa, **When** o dashboard aparece, **Then** o rodapé da sidebar exibe o CRM com badge verde.
3. **Given** onboarding concluído sem CRM informado, **Then** o rodapé da sidebar exibe estado neutro (sem badge verde) com indicação de que o CRM pode ser configurado depois.
4. **Given** onboarding concluído, **When** o usuário navega entre as telas na mesma sessão, **Then** os dados configurados permanecem visíveis (workspace, e-mail e CRM).

---

### User Story 5 — Ava enriquece o contexto de negócio com os ativos da empresa (Priority: P2)

Além das perguntas de configuração da conta, a Ava coleta os **ativos de
negócio** da empresa: o **site institucional**, os **materiais de apresentação**
(pitch deck, apresentações, documentos, PDFs) enviados como anexos na própria
conversa e a existência de um **catálogo de produtos online** (com o endereço,
quando existir). Ainda durante a conversa, a plataforma extrai desses ativos os
**dados do negócio** — o que a empresa vende, para quem, com que proposta de
valor e diferenciais — e a Ava **confirma o que absorveu** ("li seu pitch deck:
vocês vendem X para Y..."), **enriquecendo o contexto de negócio do usuário no
B2Base**. As informações de produtos absorvidas ficam disponíveis para os fluxos
de **outreach por e-mail e WhatsApp**, que passam a falar a língua do que o
cliente realmente vende.

**Why this priority**: transforma o onboarding de mero cadastro em fundação da
inteligência da plataforma — sem contexto de negócio, os fluxos de IA
posteriores (campanhas, outreach) partem do zero. Depende da conversa
(US1–US2) para existir.

**Independent Test**: percorrer o onboarding informando um site, anexando um
pitch deck e indicando um catálogo online, e verificar que a Ava confirma na
conversa os dados de negócio extraídos e que eles aparecem no contexto
configurado da conta.

**Acceptance Scenarios**:

1. **Given** as 9 perguntas de configuração concluídas, **When** chega a vez dos ativos de negócio (pergunta 10), **Then** a Ava pede o site institucional (resposta em texto com validação de endereço, pulável).
2. **Given** pedido de materiais, **When** o usuário anexa arquivos (pitch deck, apresentação, documento, PDF), **Then** a Ava confirma o recebimento de cada arquivo dentro da conversa.
3. **Given** pergunta sobre catálogo, **When** o usuário indica que possui catálogo online, **Then** a Ava pede o endereço do catálogo; quando indica que não possui, a conversa segue normalmente.
4. **Given** site e/ou materiais e/ou catálogo informados, **When** o usuário envia um ativo, **Then** a Ava processa o conteúdo e confirma na conversa o que absorveu (ex.: produtos e proposta de valor identificados), e o contexto de negócio da conta é enriquecido com os dados extraídos.
5. **Given** contexto de negócio enriquecido, **When** um fluxo de outreach por e-mail ou WhatsApp é preparado, **Then** as informações de produtos da empresa estão disponíveis para uso na mensagem.

---

### Edge Cases

- **Resposta inválida ou vazia** (ex.: e-mail malformado, campo obrigatório vazio): a Ava pede a correção de forma conversacional ("esse e-mail parece incompleto, confere pra mim?"), sem mensagens de erro técnicas e sem travar a conversa.
- **Usuário quer corrigir uma resposta anterior** no meio da conversa: a Ava permite voltar e refazer a pergunta anterior (não é preciso recomeçar do zero).
- **Recarregar ou fechar a tela no meio da conversa**: nesta iteração, sem persistência além do estado, a conversa recomeça do início no próximo acesso (limitação documentada em Assumptions).
- **Usuário abandona e volta na mesma sessão**: a conversa retoma de onde parou.
- **CRM fora da lista de opções ou usuário sem CRM**: opções "Outro" e "Ainda não uso CRM" levam ao estado neutro no rodapé da sidebar (sem badge verde), nunca a um erro.
- **E-mail da conta sintético** (contas criadas por telefone, sem e-mail real): a Ava pede um e-mail real em vez de sugerir o e-mail da conta.
- **Nome de empresa vazio ou genérico demais**: a Ava confirma ("a empresa é 'Minha Empresa' mesmo?") antes de seguir.
- **Site institucional inacessível ou endereço inválido**: a Ava avisa de forma conversacional e permite corrigir ou pular, sem bloquear.
- **Material ilegível, corrompido ou sem texto extraível** (ex.: PDF só de imagens): a Ava informa que não conseguiu absorver o conteúdo e sugere outro formato, sem travar a conversa.
- **Catálogo online atrás de login ou indisponível**: registrado com o endereço informado e extração marcada como pendente; nunca bloqueia.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST abrir, para todo usuário com onboarding ainda não concluído — incluindo contas existentes que nunca o concluíram —, diretamente a conversa com a Ava; nenhum formulário tradicional pode ser exibido como porta de entrada.
- **FR-002**: A Ava MUST se apresentar pelo nome e explicar em uma ou duas frases o que vai fazer antes da primeira pergunta.
- **FR-003**: A Ava MUST conduz exatamente 12 perguntas progressivas, uma por vez, na ordem: (1–9, configuração da conta) nome, empresa, cargo, setor, tamanho do time, objetivo principal, CRM em uso, mercado-alvo, e-mail; (10–12, ativos de negócio) site institucional, materiais de apresentação, catálogo de produtos online.
- **FR-004**: As perguntas de escolha (cargo, setor, tamanho do time, objetivo principal, CRM em uso, mercado-alvo) MUST ser apresentadas como chips clicáveis, respondíveis com um toque.
- **FR-005**: A pergunta de mercado-alvo MUST aceitar múltipla seleção de chips; as demais perguntas de escolha são de seleção única.
- **FR-006**: Toda pergunta de chips MUST oferecer a opção "Outro", que abre campo de texto livre para resposta fora da lista.
- **FR-007**: As perguntas abertas (nome, empresa, e-mail) MUST usar campo de texto natural com envio pela tecla Enter.
- **FR-008**: Quando a conta já possui dados conhecidos (ex.: e-mail, nome da empresa), as perguntas correspondentes MUST chegar pré-preenchidas com esses dados para confirmação com um toque — em especial para contas existentes que veem a conversa.
- **FR-009**: O sistema MUST exibir indicador de digitação animado (···) entre a resposta do usuário e a próxima mensagem da Ava, em todas as transições da conversa.
- **FR-010**: O sistema MUST validar conversacionalmente as respostas essenciais — nome e empresa não vazios, e-mail com formato válido — solicitando correção em linguagem natural, sem mensagens de erro técnicas.
- **FR-011**: O sistema MUST permitir pular as perguntas não essenciais (todas exceto nome, empresa e e-mail), com opção de pular explícita em cada uma.
- **FR-012**: O sistema MUST permitir corrigir a resposta da pergunta anterior durante a conversa, sem recomeçar.
- **FR-013**: A Ava MUST exibir, ao final da conversa, um resumo completo do configurado — as 9 informações da conta e os ativos de negócio informados (site, materiais, catálogo), marcando o que foi pulado como não informado.
- **FR-014**: A partir do resumo, o usuário MUST poder ajustar qualquer item, com a Ava refazendo apenas a pergunta correspondente e atualizando o resumo.
- **FR-015**: Após a confirmação do resumo, o sistema MUST transicionar automaticamente para o dashboard, sem clique adicional.
- **FR-016**: Após a conclusão, o workspace na sidebar MUST exibir o nome da empresa e o e-mail do usuário.
- **FR-017**: Após a conclusão, o CRM informado MUST aparecer no rodapé da sidebar com badge verde; quando não informado, o rodapé MUST exibir estado neutro com caminho para configurar depois.
- **FR-018**: Todas as respostas do onboarding MUST ser persistidas no estado do aplicativo através de uma única fronteira de serviço com contrato de dados estável, de forma que a substituição por API real não exija mudanças nas telas.
- **FR-019**: O onboarding concluído MUST NOT ser re-exibido durante a mesma sessão; enquanto não houver persistência além do estado, recarregar a aplicação antes de concluir recomeça a conversa.
- **FR-020**: O fluxo atual de formulário em etapas MUST deixar de ser o fluxo do primeiro acesso, substituído integralmente pela conversa (o formulário detalhado permanece disponível em Configurações para dados avançados).
- **FR-021**: A Ava MUST pedir o site institucional da empresa (pergunta 10), com resposta em texto, validação de endereço e opção de pular.
- **FR-022**: A Ava MUST oferecer o envio de materiais de apresentação (pergunta 11) — pitch deck, apresentações, documentos, PDFs — como anexos na própria conversa, confirmando o recebimento de cada arquivo.
- **FR-023**: A Ava MUST perguntar, com chips, se o usuário possui catálogo de produtos online (pergunta 12); em caso positivo, MUST pedir o endereço do catálogo.
- **FR-024**: O sistema MUST extrair, durante a própria conversa, dos ativos informados (site institucional, materiais anexados, catálogo online) os dados do negócio — produtos, proposta de valor, diferenciais, mercado — e a Ava MUST confirmar em linguagem natural o que absorveu de cada ativo, enriquecendo o contexto de negócio do usuário na plataforma.
- **FR-025**: O contexto de negócio enriquecido, incluindo as informações de produtos, MUST ficar disponível para os fluxos de outreach por e-mail e WhatsApp.
- **FR-026**: A coleta dos ativos de negócio (site, materiais, catálogo) MUST ser opcional e pulável, sem bloquear a conclusão do onboarding; materiais fora dos limites aceitos recebem feedback conversacional.

### Key Entities *(include if feature involves data)*

- **Sessão de onboarding**: o estado da conversa — pergunta atual, perguntas respondidas/puladas, respostas dadas, se já foi concluída. Pertence a um único usuário.
- **Respostas do onboarding**: as 9 informações coletadas (nome, empresa, cargo, setor, tamanho do time, objetivo principal, CRM em uso, mercado-alvo, e-mail), cada uma com o valor informado e como foi respondida (chip, texto livre ou pulada).
- **Perfil da conta resultante**: a configuração da conta derivada das respostas — identidade do usuário (nome, e-mail, cargo), empresa (nome, setor, tamanho) e preferências de uso (objetivo principal, CRM, mercado-alvo).
- **Workspace (organização)**: a organização do usuário, exibida na sidebar pelo nome da empresa configurado.
- **CRM declarado**: o CRM informado na conversa e seu status de exibição na sidebar (conectado, com badge verde, ou não configurado).
- **Ativos de negócio**: os materiais que a empresa compartilha na conversa — site institucional, arquivos de apresentação (pitch deck, apresentações, documentos, PDFs) e catálogo de produtos online (existência + endereço).
- **Contexto de negócio enriquecido**: os dados extraídos dos ativos — produtos, proposta de valor, diferenciais, mercado — que alimentam os fluxos de IA da plataforma (outreach por e-mail e WhatsApp).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário novo conclui o onboarding conversacional — do primeiro acesso à chegada no dashboard — em menos de 3 minutos.
- **SC-002**: Pelo menos 7 das 12 perguntas são respondíveis sem digitar nenhuma letra (apenas chips) — as 6 de escolha da configuração da conta mais a pergunta de catálogo.
- **SC-003**: Nenhum formulário tradicional é exibido no primeiro acesso (0 telas de formulário no fluxo).
- **SC-004**: A transição do fim da conversa para o dashboard acontece automaticamente, em até 5 segundos após a confirmação do resumo, sem nenhum clique.
- **SC-005**: Entre cada resposta e a próxima mensagem da Ava, o indicador de digitação aparece em 100% das transições, mantendo a sensação de conversa viva.
- **SC-006**: Após a conclusão, o dashboard reflete nome da empresa, e-mail e CRM sem recarregar a página.
- **SC-007**: Ao menos 80% dos novos usuários concluem o onboarding na primeira sessão (taxa de conclusão superior à do formulário atual).
- **SC-008**: Os três ativos de negócio (site, materiais, catálogo) são informáveis sem sair da conversa — os materiais anexados no próprio chat — e cada anexo recebe confirmação da Ava.
- **SC-009**: Usuários que informam ativos de negócio saem do onboarding com dados do negócio extraídos no contexto da conta (produtos e proposta de valor presentes), com a Ava confirmando na conversa o que absorveu de cada ativo — prontos para uso em outreach por e-mail e WhatsApp.

## Assumptions

- **Persona**: "Ava" é o nome da IA de onboarding. Esta spec não fixa se o
  diálogo é guiado por roteiro determinístico ou por modelo de linguagem — o
  comportamento exigido é observável (sequência das 12 perguntas, chips,
  indicador de digitação, resumo); a decisão de implementação fica para o plan.
- **Persistência**: nesta iteração, os dados vivem no estado do aplicativo,
  atrás de uma fronteira de serviço única — decisão explícita do solicitante
  ("pronto para conectar a uma API real"). A integração com a API/persistência
  definitiva do backend é o passo seguinte, fora do escopo desta spec.
  Consequência aceita: recarregar a página no meio do onboarding recomeça a
  conversa, e o contexto de negócio extraído (mesmo com extração acontecendo na
  conversa) também é efêmero, regenerável refazendo o onboarding.
- **Perguntas essenciais**: nome, empresa e e-mail são obrigatórias; as outras
  6 podem ser puladas com a opção explícita de pular.
- **"CRM conectado"** nesta iteração significa CRM declarado na conversa e
  exibido como conectado (badge verde); a integração técnica real com APIs de
  CRM é escopo futuro e não faz parte desta feature.
- **Formulário avançado**: o formulário detalhado de perfil comercial
  (CNAEs, ticket médio, ciclo de venda, proposta de valor etc.) continua
  acessível em Configurações; o onboarding conversacional coleta o essencial
  para a conta nascer configurada.
- **Idioma**: toda a conversa da Ava e as opções de chips em PT-BR,
  consistente com o restante da plataforma.
- **E-mail sugerido**: quando a conta foi criada com e-mail real, a pergunta de
  e-mail chega pré-preenchida; contas criadas por telefone (sem e-mail real)
  recebem a pergunta vazia.
- **Formatos e limites de materiais** (padrão razoável, ajustável no plan):
  PDF, PPT/PPTX, DOC/DOCX e TXT, até 5 arquivos de até 20 MB cada; excedentes
  recebem recusa conversacional explicando o limite.
- **Ativos de negócio são opcionais**: nada além de nome, empresa e e-mail
  bloqueia a conclusão do onboarding; quem pular site, materiais e catálogo
  conclui normalmente (o contexto de negócio fica sem enriquecimento).
