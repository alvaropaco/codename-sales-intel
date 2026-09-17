# Feature Specification: Perfil Completo do Lead Enriquecido

**Feature Branch**: `002-enriched-lead-detail`

**Created**: 2026-09-17

**Status**: Draft

**Input**: "Precisamos melhorar a UI com os detalhes do lead enriquecido... ao invés de abrir uma aba lateral e depois um modal ao clicar em 'Ver grafo de enriquecimento completo', ao clicar no lead que foi enriquecido deve aparecer em uma nova tela com os detalhes completos do lead, com todas as informações capturadas, redes de contato, grafo de relacionamento, endereços, telefones e até um mapa 3D mostrando onde está localizado cada um dos endereços encontrados. Precisamos criar uma UI e experiência muito mais completa pro usuário."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Tela dedicada de detalhes completos ao clicar no lead (Priority: P1)

Quando um operador clica em um lead enriquecido — nas listas de dashboard, prospecção ou pipeline — o sistema abre uma **tela dedicada de detalhes completos do lead**, ocupando toda a área de trabalho, em vez do fluxo atual de painel lateral seguido de modal. A tela apresenta o lead em profundidade: identidade e firmografia, inteligência de enriquecimento (potencial, prontidão, lançamento), presença digital, contatos, endereços, pessoas, indicadores financeiros, grafo de relacionamento e mapa de localização, organizados em seções navegáveis. A tela possui **endereço próprio na aplicação** (deep link), e o botão de voltar retorna ao contexto de origem (lista com seus filtros). Hoje o operador precisa de dois cliques e dois overlays empilhados (painel lateral → botão "Ver grafo de enriquecimento completo" → modal) para ver o retrato completo; passa a ser um clique direto para uma página completa.

**Why this priority**: é o núcleo do pedido — a experiência de detalhe é a porta de entrada para todo o valor gerado pelo enriquecimento. Sem a tela dedicada, as demais histórias (grafo interativo, mapa 3D) não têm onde viver.

**Independent Test**: clicar em um lead enriquecido em cada lista de origem e verificar que uma tela completa é aberta com URL própria, todas as seções renderizadas e retorno funcional à lista de origem.

**Acceptance Scenarios**:

1. **Given** um lead com enriquecimento concluído listado no dashboard, **When** o operador clica no lead, **Then** uma tela dedicada de detalhes é aberta (sem painel lateral nem modal), exibindo as seções de informação do lead.
2. **Given** a tela de detalhes aberta, **When** o operador copia o endereço da página e o abre em nova aba da mesma organização, **Then** a tela de detalhes do mesmo lead é aberta diretamente pelo deep link.
3. **Given** o operador chegou à tela a partir da lista de prospecção com filtros ativos, **When** ele usa o botão de voltar, **Then** retorna à lista de prospecção com o contexto de navegação preservado.
4. **Given** um lead cuja fonte de grafo de enriquecimento está indisponível, **When** a tela de detalhes é aberta, **Then** as demais seções carregam normalmente e a seção indisponível exibe estado de degradação claro (sem quebrar a tela).

---

### User Story 2 — Perfil de inteligência completo, não apenas contadores (Priority: P2)

Na tela de detalhes, o operador vê **todas as informações capturadas** pelo enriquecimento — não apenas resumos numéricos. Hoje o painel lateral mostra "Tecnologias detectadas: 0", "E-mail corporativo: Não" e booleans soltos; a nova tela passa a exibir o conteúdo em si: tecnologias detectadas como lista nomeada, presença digital detalhada (domínio, site, protocolos, redes sociais encontradas), firmografia completa, quadro societário e pessoas associadas, indicadores financeiros, e o histórico de scores (potencial, prontidão, lançamento, risco de crédito, oportunidade). Cada informação relevante exibe sua **proveniência**: fonte do dado, nível de confiança e data de captura, quando disponíveis.

**Why this priority**: o valor do enriquecimento distribuído (spec 001) só se realiza quando o operador consegue consumir os fatos capturados; contadores escondem exatamente o que foi pago para descobrir.

**Independent Test**: abrir a tela de um lead com enriquecimento profundo concluído e verificar que cada categoria de fato capturado (tecnologias, redes sociais, contatos, financeiro, pessoas) aparece como conteúdo listado, com fonte e confiança visíveis.

**Acceptance Scenarios**:

1. **Given** um lead com 5 tecnologias e 3 redes sociais capturadas, **When** a tela de detalhes é aberta, **Then** as tecnologias e redes sociais são exibidas nomeadas (não apenas "5" e "3"), cada uma com sua confiança quando disponível.
2. **Given** um lead com fatos de múltiplas capabilities, **When** o operador inspeciona um fato, **Then** consegue ver a fonte e o nível de confiança daquele dado.
3. **Given** um lead com enriquecimento parcial em andamento, **When** a tela é aberta, **Then** os fatos já capturados são exibidos e um indicador de progresso sinaliza que o enriquecimento continua.
4. **Given** uma categoria de dado sem nenhuma captura (ex.: nenhum indicador financeiro), **When** a tela é aberta, **Then** a seção correspondente exibe estado vazio informativo ("nenhum dado capturado ainda") em vez de ficar oculta ou quebrada.

---

### User Story 3 — Redes de contato acionáveis (Priority: P2)

A tela reúne em uma seção de **redes de contato** todos os canais de contato do lead: e-mails (corporativo e capturados), telefones (com ação direta de abrir conversa no WhatsApp), redes sociais (perfis com link para abertura) e endereços (com opção de copiar). Cada canal apresenta sua confiança e fonte quando disponível. O operador executa a ação de contato sem sair da tela: copiar e-mail ou telefone com um clique, iniciar conversa de WhatsApp, abrir perfil social em nova aba. Organizações no plano trial continuam vendo os canais mascarados, com o mesmo estado de bloqueio já usado na plataforma (valor oculto + indicação de restrição do plano).

**Why this priority**: transformar dado enriquecido em ação comercial é o objetivo final da tela; contatos são o canal de ação mais imediato.

**Independent Test**: abrir a tela de um lead premium com contatos capturados e executar cada ação (copiar e-mail, abrir WhatsApp, abrir rede social) sem recarregar a tela; repetir com uma organização trial e verificar que nenhum valor mascarado é revelado.

**Acceptance Scenarios**:

1. **Given** um lead com e-mail e telefones capturados, **When** o operador clica em um telefone, **Then** a conversa de WhatsApp com aquele número é iniciada; **When** clica no e-mail, **Then** o endereço é copiado (ou a ação de e-mail é iniciada) sem sair da tela.
2. **Given** um lead com perfis sociais capturados, **When** o operador clica em um perfil, **Then** a rede social abre em nova aba.
3. **Given** uma organização trial, **When** a seção de contatos é renderizada, **Then** valores restritos aparecem mascarados com indicação de plano, e nenhuma ação de cópia/abertura expõe o valor real.
4. **Given** um lead sem nenhum canal de contato capturado, **When** a tela é aberta, **Then** a seção exibe estado vazio com orientação (ex.: "nenhum contato capturado — dispare um novo enriquecimento").

---

### User Story 4 — Grafo de relacionamento interativo (Priority: P3)

A seção de **rede de relacionamentos** da tela apresenta o grafo do lead de forma **interativa**: a empresa no centro conectada a pessoas, domínio, contatos, redes sociais e entidades relacionadas. O operador pode arrastar/pan e dar zoom no grafo, clicar em um nó para ver seus detalhes (tipo, rótulo, confiança, fatos associados) e destacar as conexões do nó selecionado. O grafo substitui o modal atual renderizado como imagem estática, e o botão "Ver grafo de enriquecimento completo" deixa de existir como fluxo separado. Quando o grafo não está disponível (lead sem CNPJ, fonte indisponível, plano sem acesso), a seção explica o motivo e sugere a ação possível (ex.: disparar enriquecimento).

**Why this priority**: complementa a leitura linear do perfil com a visão relacional; é diferencial de experiência, mas não bloqueia a operação comercial básica que as histórias P1/P2 já entregam.

**Independent Test**: abrir a tela de um lead com grafo disponível, interagir (zoom, pan, clique em nós) e verificar destaque de conexões e painel de detalhe; abrir o mesmo lead sem CNPJ e verificar o estado explicativo.

**Acceptance Scenarios**:

1. **Given** um lead com grafo contendo empresa, pessoas, domínio e contatos, **When** o operador clica em um nó, **Then** os detalhes do nó são exibidos e suas conexões são destacadas em relação ao restante do grafo.
2. **Given** um grafo com mais nós do que a área visível, **When** o operador usa zoom e pan, **Then** consegue inspecionar todos os nós e arestas sem perda de legenda/identificação.
3. **Given** um lead sem CNPJ ou com fonte de grafo indisponível, **When** a seção de grafo é renderizada, **Then** um estado explicativo com ação sugerida é exibido, e o restante da tela permanece funcional.

---

### User Story 5 — Mapa 3D de localização dos endereços (Priority: P3)

A tela apresenta uma seção de **localização** com um mapa 3D interativo que plota **cada endereço encontrado** para o lead (sede, filiais, endereços capturados em fatos). O mapa permite rotação e inclinação da cena, e cada endereço aparece como marcador clicável que revela um cartão com o endereço completo, o tipo de local e a confiança da geolocalização. Para que isso seja possível, o sistema determina as **coordenadas geográficas** de cada endereço capturado (geocodificação) e as mantém associadas ao endereço. Endereços que não puderam ser geocodificados seguem listados na seção de endereços, sinalizados como "sem localização no mapa". Quando nenhum endereço é geocodificável, a seção exibe estado vazio orientativo.

**Why this priority**: é o elemento de maior impacto visual e diferencial da experiência ("até um mapa 3D"), mas depende dos endereços e sua geocodificação; entrega valor após o núcleo da tela estar de pé.

**Independent Test**: abrir a tela de um lead com endereço geocodificável e verificar que o mapa 3D plota o marcador, permite rotação/inclinação e exibe o cartão do endereço ao clicar; verificar que endereço não geocodificado aparece na lista com sinalização.

**Acceptance Scenarios**:

1. **Given** um lead com um endereço de sede geocodificável, **When** a seção de localização é aberta, **Then** o mapa 3D exibe um marcador na posição do endereço e o operador consegue rotacionar/inclinar a cena.
2. **Given** um lead com dois endereços (sede e filial), **When** o operador clica em cada marcador, **Then** o cartão com o endereço completo e tipo correspondente é exibido.
3. **Given** um endereço capturado que não pôde ser geocodificado, **When** a tela é aberta, **Then** o endereço consta na lista de endereços com a sinalização "sem localização no mapa" e não aparece no mapa.
4. **Given** um lead sem nenhum endereço geocodificável, **When** a seção de localização é renderizada, **Then** um estado vazio orientativo é exibido sem quebrar a página.
5. **Given** uma organização trial, **When** a seção de localização é renderizada, **Then** apenas informações não restritas pelo plano são exibidas (endereço da firmografia permanece visível conforme comportamento atual de mascaramento).

---

### Edge Cases

- **Lead não enriquecido clicado**: a tela dedicada abre em estado de pendência, com o que já se sabe do lead (firmografia da importação) e chamada clara para disparar o enriquecimento; a tela não fica vazia nem volta automaticamente para a lista. (Suposição: a tela dedicada torna-se o destino único do clique em lead, aposentando o fluxo painel+modal — ver Assumptions.)
- **Enriquecimento em andamento**: a tela reflete progresso parcial e atualiza à medida que fatos chegam, sem exigir recarregamento manual.
- **Fonte do grafo indisponível** (serviço de enriquecimento fora do ar): as seções dependentes degradam com mensagem clara; seções independentes (firmografia local, scores, contatos do cadastro) seguem funcionais.
- **Deep link de outra organização**: retorna "não encontrado" — nunca vaza a existência do lead nem seus dados cross-tenant.
- **Lead sem CNPJ**: seções que dependem do grafo (relacionamentos, mapas derivados de fatos do grafo) exibem estado explicativo; dados de cadastro local seguem visíveis.
- **Muitos endereços/nós** (lead com filiais múltiplas e grafo grande): o mapa e o grafo permanecem utilizáveis (agrupamento ou limite com indicação), sem travar a navegação.
- **Falha de rede ao carregar a tela**: estado de erro com retry por seção, sem recarregar a página inteira.
- **Valores ambíguos ou de baixa confiança**: a tela distingue visualmente dados de alta e baixa confiança para o operador não tomar decisão com dado frágil sem saber.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST abrir uma tela dedicada de detalhes completos do lead (tela inteira, sem painel lateral nem modal empilhado) quando o operador clica em um lead nas listas de dashboard, prospecção e pipeline.
- **FR-002**: A tela de detalhes MUST possuir endereço próprio na aplicação (deep link), acessível diretamente por URL.
- **FR-003**: A tela MUST oferecer retorno ao contexto de origem (lista de onde o operador veio), preservando a navegação anterior.
- **FR-004**: A tela MUST apresentar as informações do lead organizadas em seções completas: visão geral e status, inteligência de enriquecimento (potencial, prontidão, lançamento, risco, oportunidade), firmografia, presença digital, tecnologias, redes de contato, endereços, pessoas/quadro societário, indicadores financeiros, grafo de relacionamento, localização (mapa) e evidências/proveniência.
- **FR-005**: O sistema MUST exibir o conteúdo capturado de cada categoria (tecnologias, redes sociais, contatos, pessoas, indicadores) como itens nomeados, em vez de apenas contadores ou valores booleanos.
- **FR-006**: Cada fato relevante MUST exibir proveniência quando disponível: fonte, nível de confiança e data de captura.
- **FR-007**: A seção de redes de contato MUST oferecer ações diretas: copiar e-mail/telefone, iniciar conversa de WhatsApp para um telefone e abrir perfil de rede social em nova aba.
- **FR-008**: A seção de grafo de relacionamento MUST ser interativa: pan, zoom, seleção de nó com destaque das conexões e exibição de detalhes do nó selecionado.
- **FR-009**: O botão "Ver grafo de enriquecimento completo" e o fluxo painel lateral → modal MUST deixar de existir como caminho para o detalhe do lead, substituídos pela tela dedicada.
- **FR-010**: O sistema MUST determinar as coordenadas geográficas de cada endereço capturado (geocodificação) e associá-las ao endereço de forma persistente.
- **FR-011**: A seção de localização MUST exibir um mapa 3D interativo com um marcador por endereço geocodificado, suportando rotação e inclinação da cena, e exibir cartão de detalhes ao selecionar um marcador.
- **FR-012**: Endereços não geocodificados MUST permanecer visíveis na lista de endereços, sinalizados como "sem localização no mapa".
- **FR-013**: Todas as seções MUST respeitar o mascaramento por plano: organizações trial veem valores restritos mascarados com estado de bloqueio consistente com o padrão atual da plataforma, e nenhuma ação (cópia, abertura de link, mapa) pode revelar valor mascarado.
- **FR-014**: O acesso à tela MUST respeitar o isolamento por organização: deep links de leads de outra organização retornam "não encontrado".
- **FR-015**: Cada seção MUST ter estados independentes de carregamento, erro (com nova tentativa) e vazio; a falha de uma seção não impede a renderização das demais.
- **FR-016**: A tela MUST permitir disparar/reprocessar o enriquecimento do lead e acessar as ações comerciais do lead (avançar status no pipeline, iniciar outreach) sem sair dela.
- **FR-017**: A tela MUST refletir enriquecimento parcial em andamento (fatos já capturados visíveis + indicador de progresso), atualizando sem exigir recarregamento manual.
- **FR-018**: O sistema MUST sinalizar visualmente a diferença entre dados de alta e baixa confiança em todas as seções.

### Key Entities *(include if feature involves data)*

- **Lead**: empresa prospectada; possui identidade (nome, CNPJ, domínio), firmografia (segmento, porte, faturamento, natureza jurídica, abertura), status do pipeline e status de enriquecimento (pendente, em andamento, concluído, parcial, erro) com fonte e versão.
- **Perfil de enriquecimento**: conjunto de fatos capturados para o lead, organizado por categoria (presença digital, tecnologias, contatos, pessoas, financeiro, social), cada fato com valor, confiança, fonte e data; alimenta todas as seções da tela.
- **Rede de relacionamento (grafo)**: nós (empresa, pessoas, domínio, contatos, redes sociais) e arestas (relações entre eles), com rótulo, tipo e confiança; base da seção interativa de grafo.
- **Endereço**: local associado ao lead (sede, filial, endereço capturado em fatos) com representação textual, tipo, confiança e coordenadas geográficas resultantes da geocodificação.
- **Ponto de contato**: canal de comunicação do lead (e-mail, telefone, perfil social) com valor, confiança e fonte; sujeito a mascaramento por plano.
- **Evidência**: registro da origem de um fato (tipo de fonte, URL, data de captura, confiança) exibido na seção de proveniência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O detalhe completo do lead é alcançado em **1 clique** a partir de qualquer lista (redução dos 2 cliques e 2 overlays atuais), com a tela renderizada com dados essenciais em até 2 segundos em conexão típica.
- **SC-002**: 100% das categorias de fatos capturados pelo enriquecimento estão visíveis como conteúdo na tela (não como contador) — verificado por auditoria contra os fatos persistidos de leads de referência.
- **SC-003**: O mapa 3D plota todos os endereços geocodificados do lead em até 3 segundos após a abertura da seção de localização.
- **SC-004**: Em teste de usabilidade, 90% dos operadores localizam o telefone e o endereço de um lead em menos de 15 segundos na primeira visita à tela.
- **SC-005**: Auditoria de respostas confirma zero exposição de valores mascarados a organizações trial em qualquer seção da tela, incluindo ações de cópia e links.
- **SC-006**: 95% dos acessos por deep link de leads da própria organização abrem a tela diretamente, sem erro e sem necessidade de navegação manual.

## Assumptions

- **Destino único do clique em lead**: a tela dedicada torna-se o destino padrão ao clicar em qualquer lead (enriquecido ou não). Leads sem enriquecimento veem a mesma estrutura com estado de pendência e chamada para enriquecer; o fluxo atual de painel lateral + modal é aposentado para o detalhe do lead. Isso evita manter dois caminhos de UX para o mesmo objetivo.
- **Desktop-first**: a plataforma é uma aplicação web de uso comercial em desktop; a v1 foca nessa experiência, com responsividade básica (sem quebrar em telas menores), sem design dedicado a mobile.
- **Geocodificação entra no escopo**: os endereços hoje existem apenas como dados brutos de importação/enriquecimento, sem coordenadas estruturadas; determinar e persistir coordenadas é requisito desta feature (FR-010), pois o mapa 3D depende delas.
- **Mascaramento atual permanece**: e-mails, telefones e sócios seguem mascarados para trial; endereço/cidade/UF permanecem visíveis (comportamento atual). O mapa exibe apenas o que não é restrito ao plano.
- **Novas dependências de frontend exigem justificativa**: a constituição do projeto exige justificativa para novas dependências; a escolha de bibliotecas de mapa 3D e grafo interativo (não existem hoje no frontend) acontece no `$speckit-plan`, não nesta spec.
- **Fontes de dados existentes**: a tela consome os dados já produzidos pelo enriquecimento (resumo do lead, grafo via fonte existente, fatos do motor v2); nenhuma nova capability de enriquecimento é criada nesta feature — apenas a geocodificação de endereços é nova como dado.
- **Confiabilidade do dado**: fatos sem confiança declarada são exibidos como neutros (sem selo), não como alta confiança.
