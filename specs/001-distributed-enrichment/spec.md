# Feature Specification: Plataforma Distribuída de Enriquecimento de Leads

**Feature Branch**: `001-distributed-enrichment`

**Created**: 2026-09-16

**Status**: Draft

**Input**: "Infra inteira voltada pra enriquecimento, filtragem e qualificação de leads. Modelo de arquitetura multi-processos, escalável a milhares de processos simultâneos: ao entrar em enriquecimento, um lead dispara diversos processos independentes e paralelos (verificação de identidade, redes sociais, jurídico, financeiro, produtos/marketplace), executados por workers independentes que recebem pedidos por barramento de eventos, trabalham neles e salvam enriquecimento parcial e específico de forma independente." + documento de referência do usuário "B2Base — Distributed Lead Enrichment Platform" (41 seções).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Enriquecimento paralelo com resultados parciais independentes (Priority: P1)

Quando um lead entra em enriquecimento, o sistema cria um **job de enriquecimento** e o expande (fan-out) em múltiplas **tasks independentes** — uma para cada combinação de entidade associada ao lead (empresa, pessoas, domínio, e-mails, telefones) × capability de enriquecimento elegível (identidade, redes sociais, jurídico, financeiro, notícias, produtos...). As tasks são distribuídas pelo barramento de eventos da plataforma e consumidas por **workers especializados**, cada um responsável por uma única capability. Cada worker executa de forma independente e **persiste seu resultado parcial de forma independente**, com evidência da origem. O perfil do lead reflete o progresso em tempo real: o operador já vê e usa o lead parcialmente enriquecido sem esperar a conclusão do todo.

**Why this priority**: é o núcleo do pedido — descentralizar e deserializar o enriquecimento. Sem este motor básico (job → tasks → workers paralelos → resultados parciais), nenhuma das demais histórias tem valor.

**Independent Test**: disparar o enriquecimento de um lead com várias capabilities habilitadas e verificar que (a) múltiplas tasks executam concorrentemente, (b) cada resultado aparece no perfil do lead de forma independente, e (c) o lead fica utilizável antes da conclusão total do job.

**Acceptance Scenarios**:

1. **Given** um lead com uma empresa e duas pessoas associadas, **When** o enriquecimento é iniciado, **Then** um job é criado e tasks são geradas para cada entidade × capability elegível, publicadas no barramento de eventos.
2. **Given** tasks publicadas, **When** workers as consomem, **Then** cada worker executa independentemente (sem chamada síncrona a outro worker) e persiste o próprio resultado.
3. **Given** 7 de 10 tasks concluídas e 3 ainda em execução, **When** o perfil do lead é consultado, **Then** os 7 resultados parciais já estão visíveis no perfil e o job indica progresso parcial.
4. **Given** um job em que algumas tasks falharam e outras concluíram, **When** todas as tasks alcançam estado final, **Then** o job encerra com status coerente (concluído, parcial ou falhado) e percentuais por estado.

---

### User Story 2 — Execução resiliente, idempotente e limitada em tempo (Priority: P1)

Toda task possui timeout de execução, número máximo de tentativas e re-tentativa com espera crescente para falhas transitórias (rede, limite de taxa, indisponibilidade). Falha permanente (entrada inválida, não encontrado) não gera retry. A falha ou lentidão de uma task **não bloqueia as demais**. A redelivery da mesma mensagem (comportamento normal de um barramento) **não duplica fatos** — toda task é idempotente.

**Why this priority**: enriquecimento depende de fontes externas instáveis; sem resiliência e idempotência por task, os resultados parciais da US1 perdem confiabilidade e o dado corrompe.

**Independent Test**: forçar timeout e erro transitório em uma task e verificar retry com espera crescente até o limite; forçar falha permanente e verificar que o job prossegue com as demais; duplicar deliberadamente a entrega de todas as mensagens de um job e verificar zero fatos duplicados.

**Acceptance Scenarios**:

1. **Given** uma task cuja execução excede o timeout, **When** o worker detecta, **Then** a task é marcada como expirada e reenfileirada como nova tentativa, até o máximo de tentativas.
2. **Given** uma task com falha permanente, **When** o worker a reporta, **Then** a task é marcada como falha sem nova tentativa e o job segue com as demais tasks.
3. **Given** a mesma task entregue duas vezes (redelivery), **When** a segunda entrega é processada, **Then** nenhum fato duplicado é criado.
4. **Given** tentativas de task falhando por erro transitório, **When** novas tentativas são agendadas, **Then** a espera entre tentativas cresce progressivamente, com variação (jitter), e cessa no limite definido.

---

### User Story 3 — Isolamento por organização e respeito ao plano (Priority: P1)

Toda a execução é escopada por organização: tasks, resultados e evidências carregam o contexto do tenant e **nunca** são executáveis ou visíveis cross-tenant. A profundidade do enriquecimento obedece ao plano contratado: organização em trial recebe o conjunto básico de capabilities; plano premium recebe o conjunto profundo. Nenhuma resposta do sistema expõe informação ou capacidade além do plano.

**Why this priority**: princípio constitucional do projeto (multi-tenancy e gating por plano são inegociáveis) — sem isso a plataforma não pode operar com múltiplos clientes.

**Independent Test**: enriquecer leads de duas organizações simultaneamente e auditar o isolamento total entre elas; disparar enriquecimento de um lead de organização trial e verificar que nenhuma capability premium é agendada ou exposta.

**Acceptance Scenarios**:

1. **Given** leads de duas organizações distintas em enriquecimento simultâneo, **When** tasks são despachadas e resultados persistidos, **Then** nenhuma task, resultado ou evidência de uma organização é executável ou legível no contexto da outra.
2. **Given** uma organização no plano trial, **When** um job é criado, **Then** apenas capabilities do conjunto básico são geradas, e nenhuma resposta expõe sinal de capability premium.
3. **Given** uma organização no plano premium, **When** um job é criado, **Then** as capabilities profundas adicionais são geradas além do conjunto básico.
4. **Given** uma organização que atingiu sua cota de enriquecimento do período, **When** um novo job é solicitado, **Then** o sistema recusa ou adia com sinal claro, sem enfileirar indefinidamente.

---

### User Story 4 — Proteção de provedores externos (Priority: P2)

Provedores externos (APIs de busca, redes sociais, marketplaces, serviços de LLM, fontes de dados) têm **limite de concorrência e de taxa** respeitado centralmente (válido entre todas as instâncias de worker), além de **acompanhamento de saúde** e **circuit breaker**: quando a taxa de erro de um provedor sobe, o circuito abre, o despacho de novas tasks para aquele provedor para, e um mecanismo de verificação de saúde decide a reabertura. Um provedor degradado ou bloqueado não derruba a plataforma.

**Why this priority**: protege cota, custo e acesso a fontes externas (ex.: evita banimento por scraping agressivo), mas é uma camada de proteção acima da resiliência por task (US2) — o motor básico opera mesmo sem ela, com mais risco.

**Independent Test**: simular um provedor com erros consecutivos até o limiar e verificar que o circuito abre e novas tasks daquele provedor não são despachadas; simular recuperação e verificar reabertura; verificar que as demais capabilities seguem executando normalmente durante o bloqueio.

**Acceptance Scenarios**:

1. **Given** um provedor com taxa de erro acima do limiar, **When** novas tasks para ele chegam, **Then** o despacho é suspenso (circuito aberto) e as tasks aguardam ou falham rápido com causa explícita "provedor indisponível".
2. **Given** circuito aberto, **When** a verificação de saúde indica recuperação, **Then** o circuito fecha e o despacho retoma.
3. **Given** a concorrência máxima de um provedor atingida, **When** novas tasks chegam, **Then** elas são enfileiradas respeitando o limite, em qualquer número de instâncias de worker.
4. **Given** um provedor bloqueado, **When** o resto da plataforma opera, **Then** as demais capabilities concluem normalmente e o job pode terminar parcial.

---

### User Story 5 — Dependências entre tasks e geração dinâmica (Priority: P2)

Uma task pode declarar **dependência** de outra: enquanto as dependências não concluem com sucesso, ela permanece bloqueada (não despachada). Um resultado pode **gerar novas tasks** no mesmo job (ex.: a identidade da empresa descobre o domínio → gera tasks de domínio; o domínio revela perfis sociais → gera tasks sociais). A expansão é limitada (profundidade e quantidade por job) para evitar loops infinitos de descoberta.

**Why this priority**: transforma o fan-out estático da US1 em um grafo de enriquecimento expansível — é onde está grande parte do valor de descoberta — mas depende do motor básico e da resiliência (US1/US2) prontos primeiro.

**Independent Test**: executar um job cuja capability X produz um dado que habilita a capability Y; verificar que Y não executa antes de X concluir e que novas tasks são criadas a partir do resultado de X, respeitando os limites de expansão.

**Acceptance Scenarios**:

1. **Given** uma task Y dependente da task X, **When** X não concluiu, **Then** Y permanece bloqueada e não é despachada.
2. **Given** X concluída com sucesso, **When** o resultado é processado, **Then** Y é despachada e recebe como entrada o dado produzido por X.
3. **Given** um resultado que revela novas oportunidades de enriquecimento, **When** o scheduler o processa, **Then** novas tasks são criadas no mesmo job, com rastreabilidade da origem (qual resultado as gerou).
4. **Given** uma expansão que excederia o limite de profundidade ou quantidade do job, **When** a nova task seria criada, **Then** a criação é recusada e registrada.
5. **Given** uma dependência que falhou permanentemente, **When** avaliada, **Then** a task dependente é cancelada (ou marcada não-executável) com causa registrada — nunca fica bloqueada para sempre.

---

### User Story 6 — Evidência, dado bruto e dado normalizado (Priority: P2)

Todo fato proveniente de fonte externa carrega **evidência**: tipo de fonte, provedor, URL (quando houver), timestamp de coleta, confiança e referência ao dado bruto. O **dado bruto** (respostas de API, HTML, JSON, documentos) é retido separado do **dado normalizado** (fatos canônicos), permitindo responder "de onde veio isso, quando, por quem, com quanta confiança" e reprocessar o bruto com um parser novo **sem reconsultar o provedor**.

**Why this priority**: é a base de confiança do produto (venda B2B exige rastreabilidade) e gera economia operacional relevante (reparse sem recaptura); a US1 já exige evidência mínima (fonte + timestamp), e esta história completa o modelo com retenção de bruto, separação de camadas e reprocessamento.

**Independent Test**: concluir um enriquecimento e auditar qualquer fato até sua evidência completa; evoluir um parser e reprocessar o bruto retido, gerando fato novo sem nenhuma chamada externa nova.

**Acceptance Scenarios**:

1. **Given** um fato exposto no perfil do lead, **When** auditado, **Then** o sistema responde: origem, quando foi coletado, qual provedor/worker gerou, e com quanta confiança.
2. **Given** uma resposta grande de um provedor, **When** persistida, **Then** o bruto é armazenado em repositório de objetos com referência registrada no resultado — não no armazenamento primário.
3. **Given** dado bruto retido, **When** reprocessado com um parser/extractor novo, **Then** um novo fato é derivado sem nova consulta ao provedor externo.
4. **Given** dois provedores retornando valores distintos para o mesmo atributo, **When** ambos são persistidos, **Then** as duas versões coexistem como fatos distintos com suas evidências e confianças (a resolução de conflito é responsabilidade da agregação/qualificação, não do worker).

---

### User Story 7 — Qualificação desacoplada do enriquecimento (Priority: P3)

A qualificação é um componente **separado** do enriquecimento: consome os fatos agregados (e os eventos de resultado) e produz score, sinais e razões, recalculando-se incrementalmente conforme novos resultados parciais chegam. Ela não conhece workers individuais — apenas fatos. Falha na qualificação não afeta a execução do enriquecimento.

**Why this priority**: a plataforma já possui score construído durante o enriquecimento; esta história garante que o novo motor o alimente por eventos sem acoplamento. Valor alto, mas só se materializa depois que fatos fluem (US1).

**Independent Test**: concluir uma task de enriquecimento e verificar que a qualificação é recalculada a partir dos fatos persistidos, sem referência direta ao worker que os gerou; induzir falha na qualificação e verificar que o enriquecimento segue intacto.

**Acceptance Scenarios**:

1. **Given** novos fatos persistidos por um job, **When** processados, **Then** a qualificação recalcula score, sinais e razões com timestamp, rastreáveis aos fatos que os originaram.
2. **Given** um resultado parcial ainda em andamento, **When** a qualificação roda, **Then** o score reflete os fatos disponíveis até aquele momento.
3. **Given** falha no motor de qualificação, **When** ocorre, **Then** tasks e workers de enriquecimento continuam executando sem impacto.

---

### User Story 8 — Observabilidade de execução (Priority: P3)

Cada task é observável: duração, status, provedor utilizado, tentativa, erro, latência de fila e de execução. O rastreamento distribuído propaga o contexto (job, task, lead, organização) através do barramento, conectando o resultado final à cadeia completa de execução. Operadores acompanham a saúde da frota de workers e dos provedores por métricas agregadas e logs estruturados suficientes para diagnóstico sem acesso a dados de cliente.

**Why this priority**: operar milhares de tasks simultâneas exige enxergar o sistema; porém o motor opera mesmo sem o pacote completo de observabilidade, que é construído junto com o runtime dos workers.

**Independent Test**: executar uma carga de enriquecimento e verificar métricas por capability/provedor (duração, taxa de erro, tentativas, latência de fila) e traces que conectam job → task → resultado com contexto de organização.

**Acceptance Scenarios**:

1. **Given** tasks em execução, **When** métricas são consultadas, **Then** estão disponíveis duração, status, tentativas e erros, agregados por capability e provedor.
2. **Given** um resultado persistido, **When** rastreado, **Then** o trace conecta job, task e resultado com o contexto de organização e lead.
3. **Given** um incidente em um provedor, **When** diagnosticado pelos logs, **Then** é possível identificar causa e alcance sem acessar dados de conteúdo de clientes.

---

### Edge Cases

- **Provedor fora do ar por período longo** (circuito aberto persistente): as tasks daquele provedor expiram com causa clara ("provedor indisponível") e o job termina parcial — nunca fica pendente indefinidamente.
- **Worker morre no meio da execução**: a task é recuperada por timeout de execução e reprocessada por outra instância, sem duplicar fatos (idempotência).
- **Redelivery em massa** (após partição/restart do barramento): a idempotência por task garante zero duplicação de fatos.
- **Task dependente de dependência permanentemente falha**: dependente é cancelada com causa registrada, sem ficar bloqueada para sempre.
- **Geração dinâmica em loop** (A gera B, B gera A): limites de profundidade e de quantidade de tasks por job interrompem a expansão e registram a recusa.
- **Job sem nenhuma task aplicável** (ex.: lead sem dados mínimos ou plano sem capabilities elegíveis): encerra imediatamente como concluído-sem-resultados, com motivo registrado — nunca fica pendente para sempre.
- **Conflito de fatos entre fontes**: versões coexistem com evidências e confianças próprias; a agregação/qualificação decide o valor exposado.
- **Payload de task inválido ou malicioso**: o worker valida (organização, capability, tipo de entidade, schema de entrada) e rejeita como falha permanente, sem executar; segredos nunca trafegam na mensagem.
- **Tempos de execução heterogêneos** (verificação de domínio em segundos vs. varredura jurídica em minutos): tasks longas não bloqueiam o processamento das demais nem o event loop do worker.

## Requirements *(mandatory)*

### Functional Requirements

**Job e fan-out**

- **FR-001**: O sistema MUST criar um job de enriquecimento para cada lead enriquecido, com ciclo de vida (pendente, em execução, parcial, concluído, falhado) e permitir múltiplos jobs por lead ao longo do tempo.
- **FR-002**: O sistema MUST expandir cada job em tasks independentes por combinação de entidade associada ao lead × capability elegível, publicando-as no barramento de eventos.
- **FR-003**: O sistema MUST permitir a execução concorrente de tasks independentes, sem ordem imposta entre elas.
- **FR-004**: O sistema MUST persistir o resultado de cada task de forma independente, parcial e incremental, sem aguardar a conclusão do job.
- **FR-005**: O perfil do lead MUST refletir os resultados parciais assim que persistidos.
- **FR-006**: O sistema MUST expor, a qualquer momento, o percentual de conclusão do job (concluídas, falhadas, pendentes, em execução, bloqueadas).

**Tasks**

- **FR-007**: Toda task MUST carregar contexto completo: organização, job, lead, entidade (tipo e identificador), capability, entrada, prioridade, tentativa atual e timeout.
- **FR-008**: Toda task MUST ser idempotente, com chave determinística (organização + entidade + capability + provedor + hash da entrada) que impeça fatos duplicados em caso de redelivery.
- **FR-009**: Toda task MUST ter timeout máximo de execução e número máximo de tentativas.
- **FR-010**: O sistema MUST retentar falhas transitórias (falha de rede, limite de taxa atingido, indisponibilidade do lado da fonte) com espera crescente entre tentativas (com variação para evitar sincronização de retentativas) e MUST NÃO retentar falhas permanentes (entrada inválida, não encontrado, acesso não autorizado).
- **FR-011**: Toda task MUST suportar prioridade (faixas de mais alta a mais baixa), executando prioridades maiores primeiro dentro da mesma fila.
- **FR-012**: O sistema MUST suportar declaração de dependências entre tasks; task dependente só é despachada após todas as dependências concluírem com sucesso (ou serem explicitamente marcadas como não-bloqueantes).
- **FR-013**: O sistema MUST suportar geração dinâmica de tasks a partir de resultados (expansão dirigida por eventos), com limites de profundidade e de quantidade por job.

**Workers e capabilities**

- **FR-014**: Cada worker MUST implementar exatamente uma capability de enriquecimento bem definida e ser stateless (nenhum estado em memória entre tasks).
- **FR-015**: Workers MUST se comunicar apenas via barramento de eventos; é proibida chamada síncrona entre workers e a orquestração de um worker por outro.
- **FR-016**: Adicionar uma nova capability MUST NOT exigir modificação de workers existentes nem do núcleo do agendador (registro/plugabilidade de capabilities).
- **FR-017**: Todo worker MUST validar a task recebida (organização, capability, tipo de entidade, schema de entrada) antes de executar; credenciais e segredos MUST NÃO trafegar na mensagem da task.
- **FR-018**: Toda task MUST ser confirmada (ack) no barramento somente após a persistência bem-sucedida do resultado.
- **FR-019**: O runtime dos workers MUST ser um componente compartilhado (SDK) que provê conexão ao barramento, consumo durável, validação, idempotência, retry, timeout, ack, publicação de resultado, logs, métricas e rastreamento — de modo que um worker novo contenha apenas lógica de negócio.

**Provedores**

- **FR-020**: O sistema MUST separar capability de provedor: uma capability pode ser atendida por múltiplos provedores (API, buscador, scraper, LLM...), substituíveis sem mudança na arquitetura de enriquecimento.
- **FR-021**: O sistema MUST manter um registro operacional de provedores (saúde, limites, uso corrente, latência média, taxa de erro) e selecionar provedor por disponibilidade, saúde, limite, latência e custo.
- **FR-022**: O sistema MUST aplicar limite de taxa e concorrência máxima por provedor, com controle centralizado válido entre todas as instâncias de worker.
- **FR-023**: O sistema MUST implementar circuit breaker por provedor: degradação → abertura do circuito → suspensão do despacho → verificação de saúde → recuperação.
- **FR-024**: Falha ou bloqueio de um provedor ou worker MUST NÃO afetar a execução das demais capabilities.

**Resultados, evidência e dados**

- **FR-025**: Todo resultado MUST referenciar organização, job, lead, entidade, capability, provedor e worker gerador, com duração, timestamp e versão do worker.
- **FR-026**: Todo fato de fonte externa MUST ter evidência: tipo de fonte, provedor, URL quando houver, timestamp de coleta, confiança e referência ao dado bruto.
- **FR-027**: O sistema MUST reter o dado bruto separado do dado normalizado; brutos grandes vão para repositório de objetos com referência no registro do resultado.
- **FR-028**: O sistema MUST permitir reprocessar dado bruto retido, gerando novos fatos sem nova consulta ao provedor externo.
- **FR-029**: Valores conflitantes de fontes distintas MUST coexistir como fatos + evidências distintos; a resolução de conflito pertence à agregação/qualificação.

**Qualificação**

- **FR-030**: A qualificação MUST ser um componente separado do enriquecimento, alimentada por fatos agregados e eventos de resultado, produzindo score, sinais e razões com timestamp.
- **FR-031**: Falha na qualificação MUST NÃO afetar workers nem tasks de enriquecimento.

**Multi-tenant, plano e cotas**

- **FR-032**: Toda entidade (job, task, resultado, evidência, fato) MUST ser escopada por organização, com isolamento garantido nas camadas de aplicação e de persistência; nenhuma task é executável cross-tenant.
- **FR-033**: As capabilities elegíveis de um job MUST respeitar o plano da organização (trial = conjunto básico; premium = conjunto profundo); nenhuma resposta do sistema pode expor capacidade além do plano contratado.
- **FR-034**: O sistema MUST respeitar cotas por organização sobre volume de enriquecimento por período, recusando ou adiando excedentes com sinal claro.

**Operação**

- **FR-035**: Toda task MUST ser observável: duração, status, provedor, worker, tentativa, erro, latência de fila e de execução; os fluxos MUST expor métricas e logs estruturados suficientes para diagnóstico sem acesso a dados de cliente.
- **FR-036**: O rastreamento distribuído MUST propagar contexto (job, task, lead, organização) através do barramento de eventos.
- **FR-037**: O sistema MUST suportar escalabilidade horizontal independente por tipo de worker, orientada pela profundidade das filas, com reinício de workers sem indisponibilidade.
- **FR-038**: O sistema MUST ser projetado para dezenas a milhares de tasks simultâneas (meta de referência: 10.000+ tasks concorrentes e 100+ instâncias de worker) sem degradação de throughput.

### Key Entities *(include if feature involves data)*

- **Lead**: alvo comercial; pode referenciar múltiplas entidades (pessoas, empresa(s), domínios, contatos).
- **Entity**: objeto do mundo real associado ao lead — tipos iniciais: pessoa, empresa, domínio, e-mail, telefone, produto, artigo, perfil social — com atributos próprios.
- **EnrichmentJob**: operação completa de enriquecimento de um lead; ciclo de vida com estado intermediário "parcial"; um lead pode ter vários jobs ao longo do tempo; agrega percentuais de conclusão.
- **EnrichmentTask**: unidade fundamental de execução distribuída (job + entidade + capability + entrada + prioridade + tentativas + timeout); estados incluem bloqueada (por dependência), em retentativa, expirada; idempotente por chave determinística.
- **EnrichmentResult**: resultado parcial persistido independentemente por worker; contém dados normalizados, confiança, referências de contexto e metadados de execução (duração, versão do worker).
- **Evidence**: prova de origem de cada fato — tipo de fonte, provedor, URL, timestamp de coleta, confiança, referência ao bruto.
- **RawRecord**: dado bruto retido de provedores (armazenado em repositório de objetos), reprocessável sem nova consulta externa.
- **Capability**: função de enriquecimento bem definida e registrável (ex.: verificar e-mail, buscar redes sociais da empresa, buscar processos jurídicos), implementada por workers; extensível sem alterar o núcleo.
- **Provider**: fonte ou mecanismo externo de captura (API de dados, buscador, scraping, LLM...), com status operacional, limites e saúde monitorados.
- **QualificationResult**: score, sinais e razões derivados dos fatos agregados, com timestamp.
- **Organization (tenant)**: escopo de isolamento de dados e de plano/cotas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um lead em enriquecimento exibe os primeiros resultados parciais no perfil em até 60 segundos após o início, mesmo quando o enriquecimento completo leva minutos.
- **SC-002**: O sistema sustenta pelo menos 10.000 tasks simultâneas com 100+ instâncias de worker mantendo a fila em avanço contínuo (throughput sem degradação).
- **SC-003**: A falha total de um provedor reduz o throughput das demais capabilities em no máximo 5%.
- **SC-004**: Redelivery deliberada de 100% das mensagens de um job de teste produz zero fatos duplicados.
- **SC-005**: 100% dos fatos expostos possuem evidência auditável (origem, momento, gerador, confiança).
- **SC-006**: O operador visualiza, em tempo real, o percentual de conclusão e o status agregado de todas as tasks de qualquer job.
- **SC-007**: Uma nova capability é adicionada sem qualquer alteração em workers existentes ou no núcleo do agendador (validado por exercício de extensão em ambiente de teste).
- **SC-008**: Um job com 80% das tasks concluídas e 20% de falhas permanentes deixa o lead utilizável — perfil parcial acessível e score calculado sobre os fatos disponíveis.
- **SC-009**: Em carga mista multi-tenant, a auditoria de isolamento registra zero vazamentos cross-tenant.
- **SC-010**: Uma organização trial não dispara nem recebe exposição de capabilities premium (zero vazamentos em qualquer resposta).
- **SC-011**: O reprocessamento de dado bruto retido gera fato novo com zero chamadas externas novas (validado com a evolução de pelo menos um extractor sem recaptura).

## Assumptions

- O barramento de eventos da plataforma (NATS JetStream, já em uso com contratos versionados `*.v1`) será o mecanismo de transporte das tasks e eventos; contratos novos nascem versionados e os consumidores são idempotentes (Princípio II da constituição).
- O PostgreSQL (via Prisma) permanece o armazenamento primário de estado (jobs, tasks, resultados); o repositório de objetos compatível com S3 recebe os brutos; o Redis já presente na stack pode servir ao limite de taxa distribuído quando necessário.
- Os workers vivem no monorepo atual (um repositório, múltiplos deployáveis), evoluindo o padrão existente (`company-enrichment-worker` em Python e módulos Node de enriquecimento); extração de novos serviços Python só quando a carga justificar (Princípio VI — YAGNI).
- O enriquecimento atual (CNPJ/company enrichment + score) coexiste com o novo motor e migra gradualmente para ele — sem big-bang; a qualificação existente é a base da US7.
- A infraestrutura de deploy existente (CI → GHCR → ArgoCD) é reutilizada; Kubernetes/KEDA e mecanismos similares de autoscaling por fila entram quando a operação real da fila justificar (fases do documento de referência), nunca por padrão.
- As fontes de dados são públicas (OSINT), licenciadas ou fornecidas pelo próprio cliente; o tratamento segue a LGPD e as práticas de privacidade já adotadas pela plataforma.
- As metas numéricas (10.000+ tasks concorrentes, 100+ workers, 60s para primeiro parcial) derivam do documento de referência do usuário e podem ser recalibradas no plan com base em custos e infraestrutura real.
- Otimização por orçamento de enriquecimento (custo/latência/valor estimados por capability para seleção dinâmica de tasks) é reconhecida como direção futura no documento de referência, porém está FORA do escopo desta feature — os ganhos chegam primeiro pela prioridade e gating por plano.
