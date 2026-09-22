# Feature Specification: Onboarding Salvo na Conta + Região de Interesse

**Feature Branch**: `009-onboarding-profile-sync`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Vejo que o fluxo de onboarding deu certo, mas as informações capturadas do onboarding não foram salvas no Settings da conta do cliente. Nenhuma informação foi salva, ou seja, as respostas do onboarding simplesmente foram perdidas. Adicionalmente a isso temos que adicionar uma pergunta ao flow do onboarding que é a região em que ele tem interesse, se é o Brasil todos ou algumas regiões específicas."

## Contexto (o problema hoje)

A conversa de onboarding com a Ava (features 004/008) termina bem: resumo
confirmado, transição ao dashboard. **Mas nada do que foi conversado sobrevive**
à sessão — as respostas vivem apenas no estado efêmero do aplicativo (decisão
de escopo da 004: "pronto para conectar a uma API real", com a persistência
como passo seguinte). O Settings da conta continua vazio; recarregar a página
apaga tudo; o onboarding re-aparece no próximo acesso. Para o cliente, as
respostas foram perdidas — e a plataforma perde a matéria-prima que alimenta a
prospecção (segmentos, portes, localizações, contexto de negócio).

Em paralelo, falta capturar uma dimensão essencial para a prospecção: **a
região de interesse** — o cliente quer prospectar o Brasil todo ou regiões
específicas? Hoje essa informação só existiria se ele preenchesse o formulário
avançado de Settings por conta própria.

Esta feature fecha o ciclo: **cada resposta do onboarding nasce na conta** —
visível e editável no Settings — e o fluxo passa a capturar a região de
interesse.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — O que foi conversado nasce na conta (Priority: P1)

Ao confirmar o resumo, **todas** as respostas da conversa são salvas na conta
do cliente: as informações do perfil comercial (empresa, setor, tamanho do
time, portes do mercado-alvo, regiões, site) aparecem preenchidas no Settings,
o contexto de negócio extraído dos ativos (produtos, proposta de valor,
modelo, diferenciais) passa a constar no perfil, e o registro completo das
respostas — incluindo as puladas e as que não têm campo próprio no formulário
— fica guardado no perfil da conta. Recarregar a página, fechar o navegador ou
entrar de outro dispositivo **não perde nada**: o onboarding concluído não
re-aparece e o dashboard já nasce configurado.

**Why this priority**: é a promessa central da conversa ("sua conta nasce
configurada") hoje quebrada — sem persistência, o onboarding é teatro.

**Independent Test**: concluir o onboarding com conta nova, recarregar a
página e verificar no Settings que empresa, setor, tamanho do time, portes,
site e contexto de negócio estão preenchidos — e que o onboarding não
re-aparece.

**Acceptance Scenarios**:

1. **Given** onboarding concluído com resumo confirmado, **When** o usuário abre o Settings, **Then** o perfil comercial reflete as respostas (empresa, setor, tamanho do time, portes desejados, site institucional) e o contexto de negócio extraído (descrição de produto, proposta de valor, modelo, diferenciais).
2. **Given** onboarding concluído, **When** o usuário recarrega a aplicação, **Then** os dados persistem, o onboarding não é re-exibido e o dashboard mantém workspace, e-mail e CRM configurados.
3. **Given** respostas sem campo correspondente no formulário avançado (ex.: objetivo principal, CRM declarado, catálogo informado, e-mail confirmado), **When** a conversa é concluída, **Then** essas respostas ficam registradas no perfil da conta (registro completo do onboarding), nada é descartado.
4. **Given** falha de conexão ao salvar no momento da confirmação, **When** o salvamento falha, **Then** a Ava avisa de forma conversacional e o usuário pode tentar de novo — nenhuma resposta é perdida e a conversa não trava.

---

### User Story 2 — Pergunta de região de interesse (Priority: P1)

A conversa ganha uma pergunta nova, logo após o mercado-alvo: **"Quais regiões
do Brasil você quer prospectar?"** — respondível com um toque em chips de
múltipla escolha: **Todo o Brasil** (opção exclusiva), **Norte**, **Nordeste**,
**Centro-Oeste**, **Sudeste**, **Sul** — mais a opção **Outro** com texto livre
e a opção de pular. Escolher "Todo o Brasil" limpa as regiões específicas
selecionadas. A resposta entra no resumo final e é salva nas **localizações-alvo**
do perfil comercial, passando a orientar a prospecção.

**Why this priority**: dimensão central de filtragem da prospecção que hoje não
é capturada na entrada do cliente; com a persistência (US1), nasce direto no
perfil.

**Independent Test**: percorrer o onboarding, responder a pergunta de região
com 2 regiões + "Todo o Brasil" e conferir no resumo e no Settings
(localizações-alvo) o resultado.

**Acceptance Scenarios**:

1. **Given** a conversa na pergunta seguinte ao mercado-alvo, **When** a pergunta de região aparece, **Then** são oferecidos os chips "Todo o Brasil", "Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul" e "Outro", com seleção múltipla e opção de pular.
2. **Given** regiões específicas selecionadas, **When** o usuário clica em "Todo o Brasil", **Then** as seleções específicas são limpas (a escolha do país inteiro é exclusiva).
3. **Given** a região respondida ou pulada, **When** o resumo final é exibido, **Then** as regiões escolhidas (ou "Não informado") constam do resumo.
4. **Given** onboarding concluído com regiões informadas, **When** o Settings é aberto, **Then** as localizações-alvo contêm exatamente as regiões escolhidas.

---

### User Story 3 — A conta configurada permanece entre sessões (Priority: P2)

Com o perfil persistido, a identidade visual da conta passa a derivar do que
está **salvo**, não do estado efêmero da conversa: o CRM declarado no
onboarding fica registrado na conta e o badge verde da sidebar sobrevive ao
recarregamento; o nome da empresa do workspace vem do perfil salvo. Contas
existentes que nunca concluíram o onboarding veem o fluxo novo (com a pergunta
de região); contas que já concluíram não o revêem.

**Why this priority**: consolida a persistência no dia a dia do produto
(recarregar não pode desligar o badge do CRM), mas depende de US1.

**Independent Test**: concluir o onboarding declarando um CRM, recarregar a
aplicação e verificar que o badge verde do CRM permanece na sidebar e o
workspace mantém o nome da empresa.

**Acceptance Scenarios**:

1. **Given** onboarding concluído com CRM declarado, **When** a aplicação é recarregada, **Then** o rodapé da sidebar mantém o CRM com badge verde (derivado do perfil salvo).
2. **Given** onboarding concluído sem CRM (ou "Ainda não uso"), **When** a aplicação é recarregada, **Then** a sidebar mantém o estado neutro de CRM.
3. **Given** conta existente com onboarding ainda não concluído, **When** acessa a plataforma, **Then** vê a conversa com a Ava — agora com 13 perguntas, incluindo região de interesse — e os dados conhecidos pré-preenchidos.
4. **Given** conta com onboarding já concluído (flag salvo na conta), **When** acessa a plataforma, **Then** vai direto ao dashboard, sem re-exibir a conversa.

---

### Edge Cases

- **Salvamento falha por rede/erro no momento da confirmação**: aviso conversacional na voz da Ava ("não consegui salvar agora — tenta de novo?"), respostas intactas, possibilidade de tentar novamente; nunca silêncio nem perda.
- **Usuário fecha a aba entre o resumo e o salvamento**: o flag de conclusão só existe se o salvamento teve sucesso — no próximo acesso, a conversa recomeça (limitação já documentada na 004) e conclui normalmente.
- **Editou o Settings depois do onboarding**: o formulário avançado continua sendo a fonte da verdade — editar um campo lá não é sobrescrito por nada; o onboarding só escreve uma vez, ao concluir.
- **Onboarding refeito** (via revise ou nova sessão após reset): o novo salvamento atualiza o perfil com os valores mais recentes da conversa.
- **Mercado-alvo "Consumidor final (B2C)" / "Órgãos públicos"**: não correspondem a porte de empresa — ficam no registro completo de respostas; portes só recebem os valores de empresas.
- **Região "Outro" com texto livre**: o texto digitado entra nas localizações-alvo como veio (ex.: "Grande São Paulo").
- **Conta existente com perfil comercial já preenchido** que conclui o onboarding: os campos conversados sobrescrevem o perfil (o cliente acabou de confirmar o resumo); campos que a conversa não cobre (CNAEs, ticket médio, etc.) são preservados.
- **Sessão expira entre o resumo e o salvamento**: mesmo tratamento de falha conversacional; ao autenticar de novo, o onboarding re-aparece (não concluído) e o usuário refaz em ~2 min.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Ao confirmar o resumo, o sistema MUST salvar na conta todas as respostas do onboarding — respondidas, puladas e o contexto de negócio extraído dos ativos — de forma que nenhuma informação conversada se perca ao recarregar, fechar o navegador ou trocar de dispositivo.
- **FR-002**: O sistema MUST mapear as respostas para o perfil comercial: empresa → nome da organização; setor → segmentos-alvo; tamanho do time → time comercial; portes do mercado-alvo (pequenas/médias/grandes empresas) → portes desejados; regiões de interesse → localizações-alvo; site institucional → site público; contexto de negócio extraído → descrição de produto, proposta de valor, modelo de negócio e diferenciais; CRM declarado → CRM da conta.
- **FR-003**: O sistema MUST manter no perfil da conta um registro completo das respostas do onboarding (incluindo as sem campo próprio: nome, cargo, objetivo principal, e-mail confirmado, catálogo, materiais informados, opções puladas).
- **FR-004**: A conclusão com salvamento bem-sucedido MUST marcar o onboarding como concluído **na conta** — em novos acessos o onboarding não é re-exibido.
- **FR-005**: Se o salvamento falhar, o sistema MUST avisar de forma conversacional e permitir nova tentativa, preservando integralmente as respostas; a conclusão (transição ao dashboard) só acontece com o salvamento bem-sucedido.
- **FR-006**: A conversa MUST incluir a pergunta de região de interesse como a 9ª pergunta (logo após o mercado-alvo, antes do e-mail), totalizando 13 perguntas.
- **FR-007**: A pergunta de região MUST oferecer seleção múltipla com as opções "Todo o Brasil", "Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul" e a opção "Outro" (texto livre), além de poder ser pulada.
- **FR-008**: A opção "Todo o Brasil" MUST ser exclusiva: ao selecioná-la, eventuais regiões específicas selecionadas são limpas.
- **FR-009**: A região escolhida MUST constar do resumo final e ser salva nas localizações-alvo do perfil comercial.
- **FR-010**: Após a conclusão, o workspace, o e-mail e o CRM exibidos na sidebar MUST derivar do perfil salvo na conta (não do estado efêmero), mantendo o comportamento visual já entregue (badge verde quando há CRM declarado; neutro quando não).
- **FR-011**: O formulário avançado do Settings MUST continuar editável e ser preservado: o onboarding escreve o perfil uma única vez, ao concluir, sem sobrescrever campos que a conversa não cobre.
- **FR-012**: Todo o comportamento já entregue da conversa (roteiro das demais perguntas, chips, validação conversacional, pre-fill, indicador "···", resumo ajustável, inserção ordenada de mensagens de status, teto de extração) MUST permanecer inalterado.

### Key Entities *(include if feature involves data)*

- **Perfil comercial da conta** (já existe): as preferências de prospecção da organização — empresa, segmentos-alvo, portes, localizações-alvo, site, contexto de negócio (produto, proposta, modelo, diferenciais) e o estado do onboarding (concluído ou não). Recebe os valores da conversa e alimenta a prospecção e a IA.
- **Registro de respostas do onboarding** (novo, dentro do perfil): o registro completo e imutável da conversa — cada pergunta, o valor dado (ou pulada) e quando — garantindo que nenhuma informação sem campo próprio se perca.
- **CRM declarado** (novo no perfil): o CRM informado na conversa, persistido para o badge da sidebar sobreviver às sessões.
- **Sessão de onboarding** (já existe): inalterada em forma; passa a ter 13 perguntas e a entregar o resultado para salvamento na conta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das conclusões de onboarding resultam em perfil comercial persistido — zero casos de respostas perdidas (Settings reflete a conversa).
- **SC-002**: Após concluir e recarregar, 100% das contas mantêm workspace, CRM e estado de onboarding concluído — a conversa não re-aparece.
- **SC-003**: A região de interesse aparece nas localizações-alvo do Settings em 100% das conclusões que a informarem, e no resumo em 100% das conversas.
- **SC-004**: O salvamento é percebido como parte natural do fim da conversa (sem passo extra; falhas são avisadas conversacionalmente em 100% dos casos, com zero perda de respostas).
- **SC-005**: Zero regressão: as suítes existentes da conversa e da plataforma continuam passando sem alteração de comportamento observável.

## Assumptions

- **E-mail informado na conversa**: fica registrado nas respostas salvas; não altera a credencial/identidade de acesso da conta (troca de e-mail de acesso é outro fluxo, fora de escopo).
- **Nome do usuário**: permanece personalização da conversa e entra no registro de respostas; a conta não tem hoje campo de perfil de usuário — sem coluna própria.
- **Regiões**: as 5 macro-regiões do Brasil + "Todo o Brasil" (exclusiva) + "Outro" livre; valores em linguagem natural, compatíveis com as localizações-alvo do formulário avançado.
- **Materiais anexados**: os arquivos em si continuam não sendo re-armazenados — o que persiste é o contexto de negócio extraído deles (padrão da 004).
- **Contas existentes**: as que nunca concluíram o onboarding vêem o fluxo novo (13 perguntas) com pré-preenchimento; as que já concluíram não são re-importunadas.
- **Ordem do fluxo**: a pergunta de região entra como 9ª (após mercado-alvo, antes do e-mail) por serem temas vizinhos (a quem se vende → onde se vende); a supersedência da ordem das "exatamente 12 perguntas" da 004 é intencional e documentada.
- **Idioma e persona**: novos textos em PT-BR, na voz da Ava.
- **Migração de dados**: uma única migração de schema para os campos novos do perfil (CRM declarado + registro de respostas), via caminho oficial de migrações do projeto.
