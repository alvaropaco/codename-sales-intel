# Research: Onboarding Conversacional com IA (Ava)

**Feature**: 004-ai-onboarding | **Date**: 2026-09-18

Decisões técnicas do plan, no formato Decisão / Racional / Alternativas.

## D1 — Motor da conversa: roteiro determinístico + LLM apenas na extração

**Decision**: A sequência das 12 perguntas, chips, validações e skips é um
**roteiro determinístico** implementado como dado puro (`apps/web/src/lib/
avaScript.ts`) interpretado pela orquestração React. As reações de
reconhecimento entre respostas são **templates variados** (paráfrases
pré-escritas, escolha aleatória). O LLM entra somente na extração de ativos
(D3/D4), onde é insubstituível.

**Rationale**: A spec (Assumptions) deixa aberto roteiro vs. LLM e exige o
comportamento observável: ordem fixa das 12 perguntas, chips determinísticos,
validação, skips. Roteiro garante isso 100% testável e sem latência/falha de
rede no loop principal (SC-001 < 3 min; resposta de chip percebida ≤ 2,5 s —
um roundtrip de LLM por resposta colocaria isso em risco). A "sensação de IA
real" exigida pela spec (FR-009) vem do pacing: reações variadas + indicador
"···" de 800–1600 ms entre mensagens. A extração é o momento "mágico" real de
IA e lá o LLM justifica a latência.

**Alternatives considered**:
- *LLM conduz a conversa inteira (free-form)*: rejeitado — ordem das perguntas
  viraria não-determinística, chips/impossível garantir, testes frágeis, custo
  de latência por turno; violaria FR-003 (12 perguntas na ordem exata).
- *LLM só para reações de reconhecimento*: rejeitado em v1 — +1 endpoint e
  roundtrip por resposta (11× por onboarding) para ganho estético marginal;
  templates variados entregam o mesmo efeito percebido. Fica documentado como
  evolução natural quando a API real existir.

## D2 — Extração de ativos roda no backend, em endpoint stateless

**Decision**: Novo endpoint `POST /api/onboarding/ava/extract` no
`server-prod.js` (guard global `/api` já ativo): recebe `siteUrl`, `catalogUrl`
e `files[]` via multipart (multer `memoryStorage`), processa tudo em memória,
chama o LLM e devolve `{ businessContext, extractedFrom, warnings }`. **Nada é
persistido** — nem arquivos, nem resultado (estado do app é decisão da spec).

**Rationale**: Parsing de PDF/DOCX/PPTX e fetch de site externo não são viáveis
ou são ruins no browser (peso no cliente, CORS ao buscar sites de terceiros,
dependências pesadas de PDF). O backend já tem o cliente LLM (`llm-client.js`)
e o padrão de módulo plano testável com DI. Stateless + idempotente respeita a
constituição II sem criar persistência — a "API real" futura apenas passa a
persistir o mesmo payload.

**Alternatives considered**:
- *Extração 100% client-side (pdfjs no browser)*: rejeitado — bundle pesado,
  fetch de sites de terceiros bloqueado por CORS, duplicaria lógica que depois
  migra para o backend.
- *Extrair no próprio fluxo do chat via SSE/long-polling incremental*: rejeitado
  — complexidade sem necessidade; um POST por envio de ativo basta (usuário pode
  enviar site e arquivos e continuar conversando enquanto o "···" gira).

## D3 — Parsing de documentos e sites

**Decision**:
- **PDF**: `pdf-parse` (texto; PDFs só de imagem resultam em texto vazio →
  warning "não consegui absorver", edge case da spec).
- **DOCX/PPTX**: `jszip` + extração determinística de nós de texto
  (`word/document.xml → <w:t>`, `ppt/slides/slideN.xml → <a:t>`); TXT lido
  direto. PPT legado (binário) → warning de formato.
- **HTML do site/catálogo**: `fetch` (Node 20+ nativo, timeout 10 s, User-Agent
  identificável) + sanitização própria (remove `script`/`style`/`noscript`,
  tags → espaço, entidades básicas decodificadas, colapso de whitespace). Sem
  dependência de DOM/cheerio.
- **Limites**: 5 arquivos × 20 MB (validados no multer e revalidados no
  handler); texto por fonte capado em ~12 mil chars antes do LLM (~30 mil no
  total combinado).

**Rationale**: Menor número de dependências que resolve o formato prometido na
spec (Assumptions: PDF, PPT/PPTX, DOC/DOCX, TXT). `jszip` é o mesmo mecanismo
usado implicitamente por qualquer leitor de OOXML; extração de nós de texto é
determinística e testável com fixtures pequenas.

**Alternatives considered**:
- *cheerio para HTML*: rejeitado — para input de LLM, strip simples é
  suficiente; cheerio adicionaria superfície de dependência sem ganho
  mensurável aqui.
- *Apache Tika/unoserv externo*: rejeitado — serviço novo para instalar/operar
  (constituição VI), custo operacional alto para 4 formatos.
- *Enviar os bytes ao LLM (multimodal)*: rejeitado — o modelo do gateway
  (`qwen/qwen2.5-7b-instruct` default) é text-only.

## D4 — Prompt de extração e formato de saída

**Decision**: Uma chamada `callLlm({ jsonMode: true, model: premiumModel(),
timeoutMs: 60000 })` por requisição (todas as fontes combinadas em um único
prompt rotulado por fonte), pedindo JSON
`{ products: [{name, description}], valueProposition, businessModel,
differentiators: [], targetMarket, confidence }`. O shape espelha os campos que
`org-context.js` (`buildOrgContext`) já renderiza para os fluxos de IA
(proposta de valor, diferenciais, o que vende) — o contexto extraído é
**drop-in** para o outreach e-mail/WhatsApp quando a persistência real existir.
Falha/timeout do LLM → HTTP 200 com `warnings` ("não consegui processar agora —
segue sem enriquecimento") e `businessContext` nulo; a conversa nunca trava
(edge cases da spec).

**Rationale**: `premiumModel()` porque extração estruturada de documento é a
tarefa de maior valor do fluxo (mesma escolha de `ai-campaign.js`); o
`llm-client.js` já faz fallback automático para o modelo default se o override
falhar. `jsonMode` + `parseJsonLoose` (já exportados) evitam parsing frágil.

**Alternatives considered**:
- *Chamada por arquivo (N chamadas)*: rejeitado — mais lento e mais caro; o
  prompt por fonte rotulada numa chamada única chega ao mesmo resultado.
- *Modelo default (7B) para tudo*: rejeitado para extração — qualidade de
  extração estruturada de PDF é sensível ao modelo; aceitável só como fallback.

## D5 — Testes no web: vitest (dev dependency)

**Decision**: Adicionar `vitest` como devDependency de `apps/web` (ambiente
node, sem DOM), testando os módulos puros: `avaScript.ts` (ordem, chips,
obrigatórias, validação de e-mail/URL), `services/onboarding.ts` (transições,
skip, conclusão, sessionStorage com storage injetável) e `avaReactions.ts`.

**Rationale**: A constituição III é não-negociável ("teste antes do merge") e o
web hoje tem infra zero — sem teste, metade da feature (toda a lógica da
conversa) entraria sem porta de entrada. Vitest reutiliza o toolchain Vite/TS
existente (`tsc && vite build` continua intocado), roda ESM/TS nativamente e é
dev-only (zero impacto de bundle). Testes de componente/DOM ficam fora do v1
(YAGNI) — a lógica pura cobre os FRs; a UI é validada pelo quickstart.

**Alternatives considered**:
- *Mover lógica da conversa para módulo JS na raiz e testar com node --test*:
  rejeitado — forçaria CommonJS/duplicação de tipos entre mundo server e SPA
  apenas para evitar um devDependency.
- *jest + ts-jest*: rejeitado — configuração mais pesada e mais lenta para o
  mesmo resultado.
- *Playwright e2e*: rejeitado em v1 — custo alto; quickstart cobre o caminho
  ponta a ponta manualmente.

## D6 — Estado do onboarding no web e "fronteira de serviço"

**Decision**: `services/onboarding.ts` expõe uma interface única
(`createOnboardingService({ storage })`) com implementação **em memória +
sessionStorage** (injetável — permite teste e a futura troca por client HTTP sem
mudar telas, FR-018). `useAvaOnboarding` consome o serviço e expõe estado +
ações ao `AvaOnboarding.tsx`. Na conclusão, `App` recebe `OnboardingResult`
(companyName, email, crm, businessContext) no seu estado — Sidebar/Layout leem
daí. Sem zustand/redux (padrão do repo: useState/useEffect).

**Rationale**: A spec manda persistir no estado com fronteira de serviço única
e contrato estável. Um serviço injetável é exatamente o seam para a API real.
`sessionStorage` do flag de conclusão implementa o FR-019 ("não re-exibe na
mesma sessão") sem backend.

**Alternatives considered**:
- *Context provider global para o onboarding*: rejeitado — o estado só é
  relevante dentro da conversa; o App só precisa do resultado.
- *Persistir em zustand (nova dep)*: rejeitado — violaria YAGNI; o repo nunca
  usou store externo.

## D7 — Gate do primeiro acesso

**Decision**: `App.tsx` passa a decidir por: `!commercialProfile?.onboardingCompleted
&& !onboardingDoneThisSession → <AvaOnboarding onComplete=...>`. O
`OnboardingModal` é removido do render e deletado; o heurístico atual
(companyName vazio / sem segmentos etc.) deixa de existir como gatilho — o flag
do servidor + sessão mandam. Pre-fill (FR-008): o roteiro hidrata as perguntas
de e-mail e empresa com `session.email` / `commercialProfile.companyName`
(quando existirem) e a Ava as oferece como sugestão confirmável.

**Rationale**: Um único critério de entrada (decisão da clarificação Q3),
sem dois fluxos vivendo juntos (FR-020). Base existente com flag falso voa pela
conversa via pre-fill. Consequência aceita e documentada na spec: enquanto a
API real não persistir a conclusão, usuários sem flag reveem a conversa em nova
sessão do browser.

**Alternatives considered**:
- *Manter o heurístico de campos vazios como gatilho adicional*: rejeitado —
  reabriria o chat para quem já se configurou e criaria duplo critério.

## D8 — Reações, pacing e indicador de digitação

**Decision**: Cada resposta do usuário dispara: (1) bolha do usuário aparece
instantâneo; (2) `TypingIndicator` por 800–1600 ms (aleatório nesse intervalo);
(3) mensagem de reação (template variado, com dados da resposta — ex.:
"Boa, {firstName}!") e, quando houver próxima pergunta, novo "···" curto
(600–1000 ms) antes dela. Na extração de ativos, o "···" permanece até o
endpoint responder (com teto de espera: >30 s → mensagem honesta de espera).

**Rationale**: Entrega o FR-009/SC-005 (indicador em 100% das transições) e a
sensação de conversa viva sem custo de LLM; o jitter aleatório é o que separa
"parece robô" de "parece pessoa".

**Alternatives considered**:
- *Delays fixos*: rejeitado — cadência fixa é o maior entregador de "script".
- *Streaming de caracteres da resposta da Ava*: rejeitado em v1 — efeito
  colateral em acessibilidade/scroll; o "···" já cumpre a spec.

## D9 — Observabilidade e privacidade da extração

**Decision**: Endpoint instrumentado com prom-client: `b2base_ava_extract_
duration_seconds` (histograma), `b2base_ava_extract_files_total` (counter por
status: ok/unsupported/failed) e `b2base_ava_extract_llm_failures_total`.
Logs estruturados registram apenas metadados (tamanhos, mime, status, duração,
orgId) — **nunca** o texto extraído nem o conteúdo dos documentos.

**Rationale**: Constituição VII (fluxos críticos novos expõem métricas) e V
(materiais de cliente são sensíveis — processados em memória e descartados).

## D10 — Conteúdo do roteiro (chips e opções)

**Decision**: Listas de opções das 6 perguntas de chips + catálogo (PT-BR),
ancoradas no vocabulário que a plataforma já usa (`targetSegments`,
`salesTeamSize` etc. do `CommercialSettings`): cargo (Fundador/CEO, Comercial,
Marketing, Operações, Outro), setor (Tecnologia/SaaS, Serviços, Indústria,
Varejo/E-commerce, Saúde, Educação, Financeiro, Imobiliário, Outro), tamanho do
time (Só eu, 2–5, 6–20, 21–50, 51+), objetivo principal (Gerar mais leads,
Automatizar prospecção, Enriquecer minha base, Fechar mais vendas, Organizar
meus contatos, Outro), CRM (Ainda não uso, Pipedrive, HubSpot, RD Station,
Salesforce, Kommo, Outro), mercado-alvo (multi: Pequenas empresas, Médias
empresas, Grandes empresas, Consumidor final, Setor específico…, Outro) e
catálogo (Tenho catálogo online / Ainda não tenho). Texto exato dos prompts e
reações definido nas tasks (fonte da verdade: `avaScript.ts`).

**Rationale**: Reaproveita o léxico existente (facilita o mapeamento futuro
para `CommercialSettings`) e cobre "Outro" com texto livre (FR-006) e skip
(FR-011) em todas as não-obrigatórias.

## Open items para `$speckit-tasks`

- Texto final dos prompts/reações da Ava (PT-BR) — copy no arquivo de roteiro.
- Lista definitiva de CRMs/chips pode ser ajustada na review do roteiro.
- Ponto de integração futuro (fora do escopo): persistir `OnboardingResult` em
  `Organization` + `CommercialSettings` + flag `onboardingCompleted` quando a
  API real entrar; o shape de `businessContext` já é drop-in para
  `org-context.js`.
