# Feature Specification: Outreach Multi-tenant — Mensagens pelo Template do Tenant

**Feature Branch**: `007-outreach-tenant-templates`

**Created**: 2026-09-21

**Status**: Draft

**Input**: Bug crítico multi-tenant: as funcionalidades de outreach por email e por WhatsApp estão enviando mensagens com texto fixo/hardcoded da plataforma, ignorando o template configurado pelo cliente. Exemplo real enviado a um lead: "Olá NOVAURORA, tudo bem? Sou da Jefferson Torres. Obter resposta e agendar uma conversa curta (15 min) por WhatsApp com os decisores dos 249 leads pré-qualificados por enriquecimento de CNPJ, priorizando entender a necessidade do lead antes de qualquer proposta." — quando o template configurado pelo tenant era "Olá {{firstName}}, tudo bem? Estamos apresentando algumas soluções da MB para corte, dobra e automação industrial...". A mensagem expôs contexto interno da plataforma (objetivo da campanha, contagem de leads, descrição de público) e tratou o nome da empresa-alvo como se fosse pessoa de contato.

## Clarifications

### Session 2026-09-21

- Q: Quando um lead não tem pessoa de contato identificada (nem representante ou sócio conhecido), como a mensagem enviada deve tratá-lo na saudação? → A: Saudação genérica sem nome (ex.: "Olá, tudo bem?") — nunca usa nome de empresa como pessoa; a mensagem segue normalmente.
- Q: O que a plataforma deve fazer com as campanhas já criadas cujos templates embutem texto interno (como as que originaram o incidente) no momento em que a correção entra? → A: Retê-las (bloquear novos envios) e sinalizar ao tenant, oferecendo rederivar a mensagem base do perfil comercial ou permitir edição manual antes da reativação — nunca correção silenciosa nem disparo continuado.
- Q: Em uma campanha com IA, quando a organização ainda não configurou nenhum template de mensagem explícito, como o sistema deve obter a mensagem base que será enviada? → A: Compor a mensagem base automaticamente a partir do perfil comercial da organização (nome, proposta de valor, CTA), em linguagem voltada ao lead — o fluxo 1-clique é preservado.
- Q: Antes de uma campanha com IA começar a disparar automaticamente, o tenant precisa aprovar a mensagem base gerada? → A: Sim — aprovação obrigatória da mensagem base (uma aprovação única por campanha, não por lead) antes do disparo começar; sem aprovação, nenhum envio parte; a personalização por lead segue automática após a aprovação.
- Q: Além da auditoria padrão do que foi enviado, a plataforma precisa oferecer algo específico para o tenant identificar os leads que receberam as mensagens incorretas do incidente? → A: Não — basta o histórico de envios das campanhas retidas permanecer consultável por lead (conteúdo exato enviado); nenhum relatório dedicado de incidente.
- Q: (adição de escopo solicitada pelo usuário durante o planejamento) O que acontece quando o cliente inicia a conexão da conta de WhatsApp dele? → A: O sistema exibe um modal/box de confirmação alertando que o uso automatizado pode levar ao bloqueio da conta pelo WhatsApp; a conexão só prossegue após confirmação explícita (US6, FR-013, FR-014).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mensagens de outreach usam o template do tenant (Priority: P1)

O operador de uma organização configura os templates de mensagem da sua campanha (assunto e corpo de email, mensagem de WhatsApp) com placeholders como `{{firstName}}` e `{{companyName}}`. Todo envio — manual, automatizado (disparado por enriquecimento) ou assistido por IA — usa esse template como base do conteúdo entregue ao lead. Texto de objetivo de campanha, estratégia, público-alvo e metas internas nunca chegam ao lead: são insumos internos de composição, não conteúdo de mensagem.

**Why this priority**: É o próprio bug: a plataforma está enviando aos leads de clientes um texto que expõe o funil interno da B2Base e quebra a experiência white-label multi-tenant. Enquanto isso ocorrer, o produto é inutilizável para outreach real.

**Independent Test**: Com um template configurado pela organização, disparar uma campanha (em qualquer fluxo) para leads fixture e verificar que cada mensagem recebida corresponde ao template renderizado — sem nenhuma frase de objetivo interno, contagem de leads ou descrição de público.

**Acceptance Scenarios**:

1. **Given** uma organização com template de WhatsApp configurado, **When** uma campanha assistida por IA é disparada e a personalização por IA falha para um lead, **Then** o lead recebe exatamente o template da organização renderizado (nunca um texto sintetizado pela plataforma).
2. **Given** uma campanha multicanal com templates de email e WhatsApp configurados, **When** os disparos acontecem nos dois canais, **Then** as mensagens de ambos os canais respeitam os respectivos templates da organização.
3. **Given** um objetivo de campanha com texto interno (ex.: "Obter resposta e agendar uma conversa curta (15 min) com os decisores dos 249 leads pré-qualificados..."), **When** qualquer mensagem é composta, **Then** esse texto não aparece, total nem parcialmente, na mensagem enviada.
4. **Given** duas organizações com templates diferentes, **When** cada uma dispara campanhas, **Then** cada envio usa exclusivamente o template e o contexto comercial da organização correspondente.

---

### User Story 2 - Saudação com a pessoa de contato correta (Priority: P1)

O placeholder de nome (`{{firstName}}`) resolve para a pessoa de contato do lead quando ela é conhecida. Quando o lead não tem pessoa de contato identificada, a saudação degrada graciosamente (mensagem sem nome) — o nome da empresa nunca é tratado como se fosse uma pessoa ("Olá NOVAURORA").

**Why this priority**: Faz parte do mesmo incidente: saudar a empresa como pessoa denuncia automação e mina a credibilidade do cliente diante do lead.

**Independent Test**: Para um lead com pessoa de contato conhecida e outro sem, disparar mensagens e verificar que a primeira saúda a pessoa pelo nome e a segunda usa saudação sem nome — em ambos os canais.

**Acceptance Scenarios**:

1. **Given** um lead com pessoa de contato registrada, **When** a mensagem é composta, **Then** `{{firstName}}` contém o nome (primeiro nome) da pessoa de contato.
2. **Given** um lead sem pessoa de contato e sem representante conhecido, **When** a mensagem é composta, **Then** a saudação não usa nome de empresa como pessoa (ex.: "Olá, tudo bem?").
3. **Given** um lead sem pessoa de contato, **When** a mensagem é composta, **Then** nome de empresa pode aparecer apenas em placeholders explícitos de empresa (`{{companyName}}`), com contexto de empresa na frase.

---

### User Story 3 - Fallback da IA nunca inventa texto de plataforma (Priority: P2)

Quando a personalização por IA está indisponível, falha, excede limites do canal ou é rejeitada por política de conteúdo, a mensagem final é o template configurado pela organização (ou, em fluxos de campanha com IA sem template explícito, uma mensagem composta apenas a partir do perfil comercial da organização, em linguagem voltada ao lead). A plataforma nunca substitui silenciosamente por um texto genérico seu nem por texto sintetizado com conteúdo interno.

**Why this priority**: O fallback é o caminho silencioso pelo qual o bug escapa em volume: qualquer falha transitória de IA hoje vira uma leva de mensagens incorretas. Corrigir o caminho principal (US1) sem fechar o fallback deixa o incidente recorrente.

**Independent Test**: Simular indisponibilidade da personalização por IA e disparar uma campanha: todas as mensagens enviadas no período correspondem ao template da organização renderizado.

**Acceptance Scenarios**:

1. **Given** personalização por IA indisponível, **When** o disparo segue, **Then** cada mensagem é o template da organização renderizado com os dados do lead.
2. **Given** uma mensagem personalizada que excede o limite de comprimento do canal, **When** o sistema a ajusta, **Then** a versão enviada continua baseada no template/na personalização aprovada, sem introduzir texto alheio ao contexto da organização.
3. **Given** uma mensagem rejeitada por política de conteúdo, **When** o sistema substitui, **Then** a substituição é o template da organização (e o fato fica registrado), nunca um texto sintético da plataforma.
4. **Given** uma campanha com IA sem template explícito da organização, **When** a mensagem base é composta, **Then** ela usa apenas o perfil comercial da organização em linguagem de lead — sem instruções internas, contagem de leads ou descrição de público-alvo.

---

### User Story 4 - Saneamento de campanhas existentes (Priority: P2)

Campanhas já criadas cujos templates de mensagem foram sintetizados com conteúdo interno (como as que originaram o incidente) são identificadas pela plataforma. Nenhum novo envio ocorre a partir de template poluído: as campanhas afetadas são impedidas de disparar e sinalizadas ao tenant para revalidação (ou têm a mensagem base rederivada do perfil comercial, ficando claro o que mudou).

**Why this priority**: Sem saneamento, campanhas ativas criadas antes da correção continuam disparando o conteúdo incorreto mesmo depois do fix — o incidente persiste em produção.

**Independent Test**: Com campanhas fixture contendo templates sintéticos poluídos, executar o saneamento e verificar que nenhuma delas dispara conteúdo poluído e que todas ficam sinalizadas/auditadas.

**Acceptance Scenarios**:

1. **Given** uma campanha ativa cujo template embute texto interno, **When** o saneamento roda, **Then** a campanha não envia novas mensagens até ser revalidada ou ter o template rederivado.
2. **Given** campanhas afetadas identificadas, **When** o tenant as consulta, **Then** ele consegue ver quais foram afetadas e o que precisa rever.
3. **Given** uma campanha legítima configurada manualmente pelo tenant, **When** o saneamento roda, **Then** ela não é alterada (falso positivo zero).

---

### User Story 5 - Previsibilidade e auditoria do que é enviado (Priority: P3)

O tenant visualiza, antes do disparo, a prévia da mensagem renderizada com dados de um lead real da sua organização. Cada mensagem enviada fica registrada com o conteúdo exato, o canal, o lead e a origem da composição (template do tenant, personalização de IA ou fallback), auditável pelo tenant.

**Why this priority**: Confiança: depois de um incidente desse tipo, o cliente precisa poder conferir exatamente o que saiu e o porquê — e prever o que vai sair. Não bloqueia a correção, mas é o que fecha o ciclo de confiança.

**Independent Test**: Gerar prévia de uma campanha e comparar com as mensagens efetivamente enviadas: o conteúdo base é idêntico; cada envio tem registro auditável com origem da composição.

**Acceptance Scenarios**:

1. **Given** uma campanha configurada, **When** o tenant pede prévia, **Then** a mensagem exibida é renderizada com dados de um lead real da organização.
2. **Given** mensagens já enviadas, **When** o tenant consulta o histórico, **Then** cada item mostra o conteúdo exato enviado e a origem da composição (template / IA / fallback).
3. **Given** uma prévia aprovada, **When** o disparo acontece, **Then** o conteúdo base enviado é igual ao da prévia (diferenciando apenas a personalização por lead, quando houver, que também fica registrada).
4. **Given** uma campanha com IA recém-criada com mensagem base composta, **When** o tenant ainda não aprovou a mensagem base, **Then** nenhum disparo inicia e a campanha fica aguardando aprovação.

---

### User Story 6 - Aviso de risco antes de conectar a conta de WhatsApp (Priority: P2)

Quando o operador inicia a conexão da conta de WhatsApp da organização, o sistema exibe um modal de alerta/box de confirmação informando que o uso automatizado de mensagens pode levar ao **bloqueio da conta pelo WhatsApp**, e a conexão só prossegue após confirmação explícita. O alerta aparece tanto na primeira conexão quanto em reconexões.

**Why this priority**: Protege o cliente da perda do canal de vendas e a plataforma de expectativa não gerenciada; é do mesmo domínio do produto (outreach via WhatsApp), mas independente do bug de templates e não bloqueia a correção principal.

**Independent Test**: Iniciar a conexão de WhatsApp e verificar que o alerta aparece antes de qualquer etapa de conexão, que cancelar não conecta nada e que confirmar prossegue com o fluxo normal de conexão.

**Acceptance Scenarios**:

1. **Given** uma organização sem WhatsApp conectado, **When** o operador inicia a conexão, **Then** o alerta de risco é exibido antes de qualquer etapa do fluxo de conexão.
2. **Given** o alerta aberto, **When** o operador confirma, **Then** o fluxo de conexão prossegue normalmente.
3. **Given** o alerta aberto, **When** o operador cancela, **Then** nenhuma sessão é criada e o estado de conexão permanece inalterado.
4. **Given** uma conta previamente conectada que foi desconectada, **When** o operador reconecta, **Then** o alerta de risco é exibido novamente.

---

### Edge Cases

- Lead sem pessoa de contato e sem representante/sócio conhecido → saudação sem nome, nunca nome de empresa como pessoa.
- Template do tenant com placeholder inexistente/desconhecido → o placeholder não vaza cru na mensagem final e o tenant é sinalizado para corrigir o template.
- Organização sem nenhum template configurado em fluxo que exige template → o disparo não inicia; o sistema orienta a configuração antes de enviar.
- Personalização por IA indisponível, lentíssima ou com resposta inválida → fallback ao template do tenant, sem interromper o disparo dos demais leads.
- Mensagem personalizada excedendo o limite de comprimento do canal → ajuste mantendo a base do template do tenant.
- Template do tenant violando política de conteúdo → mensagem bloqueada ou substituída pelo template aprovado, com registro.
- Campanha legada poluída com disparos agendados para logo após o deploy → saneamento impede novos envios antes do próximo ciclo.
- Dois tenants simultâneos com perfis comerciais diferentes → cada envio usa exclusivamente o contexto da organização do lead (nenhum vazamento cruzado).
- Tenant cancela o alerta de risco de conexão do WhatsApp → nenhuma sessão é criada e o estado de conexão permanece inalterado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todo envio de outreach (email e WhatsApp), em qualquer fluxo (manual, automatizado ou assistido por IA), DEVE usar como base de conteúdo o template de mensagem configurado pela organização do tenant.
- **FR-002**: Objetivo de campanha, estratégia, público-alvo, contagem de leads e metas internas DEVEM ser tratados exclusivamente como insumos internos de composição e NUNCA aparecerem, total ou parcialmente, na mensagem enviada ao lead.
- **FR-003**: O placeholder de primeiro nome DEVE resolver para a pessoa de contato do lead quando conhecida; na ausência, o sistema NÃO DEVE tratar nome de empresa como pessoa e DEVE degradar para saudação sem nome.
- **FR-004**: Placeholders não resolvidos NÃO DEVEM aparecer na mensagem final; o tenant DEVE ser sinalizado quando o template dele referenciar placeholders desconhecidos.
- **FR-005**: Quando a personalização por IA falhar, estiver indisponível, exceder limites ou ser rejeitada por política de conteúdo, a mensagem final DEVE ser o template da organização renderizado — nunca texto genérico da plataforma nem texto sintetizado com conteúdo interno.
- **FR-006**: Em fluxos de campanha com IA sem template explícito do tenant, a mensagem base DEVE ser composta apenas a partir do perfil comercial da organização, em linguagem voltada ao lead.
- **FR-007**: Mensagens DEVEM respeitar os limites de comprimento do canal; o ajuste DEVE preservar a base do template do tenant.
- **FR-008**: O sistema DEVE identificar campanhas existentes com template sintetizado a partir de conteúdo interno, retê-las (impedir novos envios) e sinalizá-las ao tenant; a reativação exige ação do tenant — rederivação da mensagem base a partir do perfil comercial (oferecida como atalho, nunca imposta) ou edição manual — com registro do que mudou; campanhas configuradas manualmente NÃO DEVEM ser alteradas.
- **FR-009**: O tenant DEVE poder visualizar prévia da mensagem renderizada com dados de um lead real da sua organização antes do disparo; em campanhas com IA, a mensagem base gerada DEVE ser aprovada explicitamente pelo tenant (aprovação única por campanha, não por lead) antes do início do disparo — sem aprovação, nenhum envio parte.
- **FR-010**: Cada mensagem enviada DEVE ser registrada com conteúdo exato, canal, lead e origem da composição (template do tenant, personalização de IA ou fallback), auditável pelo tenant — incluindo os envios de campanhas retidas pelo saneamento, para que o tenant identifique os leads que receberam conteúdo incorreto (sem relatório dedicado de incidente).
- **FR-011**: Templates, perfil comercial, leads e envios DEVEM permanecer isolados por organização; nenhuma mensagem pode ser composta com contexto comercial de outra organização.
- **FR-012**: Disparo que exige template NÃO DEVE iniciar sem template configurado; o sistema DEVE orientar o tenant a configurar antes de enviar.
- **FR-013**: O sistema DEVE exibir, antes de iniciar qualquer conexão de conta de WhatsApp (primeira conexão ou reconexão), um alerta de risco informando que o uso automatizado de mensagens pode resultar no bloqueio da conta pelo WhatsApp.
- **FR-014**: A conexão de WhatsApp DEVE prosseguir somente após confirmação explícita do tenant no alerta; o cancelamento NÃO DEVE criar sessão nem alterar o estado de conexão.

### Key Entities *(include if feature involves data)*

- **Organização (tenant)**: dona do perfil comercial, dos templates e de todas as campanhas; nenhuma composição de mensagem pode usar insumos de outra organização.
- **Perfil comercial da organização**: nome comercial, proposta de valor, oferta, CTA desejado e tom — insumo para composição e personalização, nunca corpo literal de mensagem.
- **Template de mensagem**: conteúdo configurado pelo tenant por canal (assunto/corpo de email; mensagem de WhatsApp), com placeholders de lead (`{{firstName}}`, `{{companyName}}` etc.).
- **Campanha de outreach**: objetivo interno, oferta, canais, templates por canal e situação de saneamento (apta para disparo ou retida para revalidação).
- **Lead/Prospect**: empresa-alvo e sua pessoa de contato (nome usado na saudação); sem contato conhecido, habilita saudação sem nome.
- **Sessão de WhatsApp da organização**: estado de conexão da conta do tenant (conectada/desconectada); só é criada após confirmação explícita do alerta de risco.
- **Registro de envio**: conteúdo exato entregue, canal, lead, momento e origem da composição — base de auditoria do tenant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das mensagens enviadas após a correção contêm apenas texto derivado do template da organização (ou personalização de IA sobre ele); zero mensagens com texto interno de objetivo, estratégia, público-alvo ou contagem de leads.
- **SC-002**: 100% dos envios para leads com pessoa de contato conhecida saúdam a pessoa pelo nome; zero mensagens tratando nome de empresa como pessoa.
- **SC-003**: Em 100% das falhas de personalização por IA, a mensagem final corresponde ao template da organização renderizado.
- **SC-004**: Zero novos envios a partir de template sintético poluído após o saneamento; 100% das campanhas afetadas identificadas e retidas/sinalizadas antes do próximo ciclo de disparo; zero campanhas legítimas alteradas.
- **SC-005**: O conteúdo base de cada mensagem enviada é idêntico à prévia correspondente (100% de igualdade, salvo personalização por lead registrada).
- **SC-006**: Zero incidentes recorrentes de suporte do tipo "mensagem enviada expondo contexto interno da plataforma" após o deploy.
- **SC-007**: 100% das tentativas de conexão de conta de WhatsApp passam pelo alerta de risco; zero conexões concluídas sem confirmação explícita do tenant.

## Assumptions

- O perfil comercial por organização já existe e permanece como insumo de composição/personalização — muda o uso (nunca corpo literal), não a existência.
- Os placeholders atuais (`{{firstName}}`, `{{companyName}}`, `{{industry}}`, cidade etc.) continuam suportados nos dois canais.
- A correção vale igualmente para email e WhatsApp, incluindo os fluxos automatizados disparados por enriquecimento.
- Saneamento de dados de campanhas existentes faz parte do escopo desta feature (não é apenas código novo).
- Mensagens já enviadas não são retratáveis; o escopo cobre prevenção de novos envios incorretos e auditoria do histórico.
