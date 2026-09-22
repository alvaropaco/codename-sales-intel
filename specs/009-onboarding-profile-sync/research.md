# Research: Onboarding Salvo na Conta + Região de Interesse

**Feature**: 009-onboarding-profile-sync | **Date**: 2026-09-22

## Superfície existente (reconhecimento)

- **Endpoint**: `GET/PUT /api/settings/commercial-profile` (`server-prod.js`) —
  org-scoped via `requireRequestOrgId`; o `PUT` faz `upsert` em
  `prisma.commercialSettings` + atualiza `organization.name` a partir de
  `companyName`. **Atenção**: `normalizeCommercialProfilePayload` normaliza TODOS
  os campos do payload — campos ausentes viram `null`/`[]` e **sobrescrevem** o
  que já existe. É por isso que a mescla precisa acontecer antes de salvar.
- **Cliente web**: `saveCommercialProfile`/`fetchCommercialProfile`
  (`services/api.ts`); `CommercialProfile` já carregado no `App` na montagem.
- **Schema**: `CommercialSettings` já tem `onboardingCompleted` (flag do
  onboarding antigo em etapas) e todas as colunas de destino do mapeamento
  (exceto CRM e registro de respostas).
- **Valores do formulário**: `targetSizes` usa `small|medium|large`;
  `targetSegments`/`targetLocations` são tags livres; `salesTeamSize` texto livre.

## Decisões

### D1 — Mescla do perfil no cliente antes de salvar (FR-011/FR-003)

**Decision**: no momento da confirmação, o `App` mescla o perfil carregado
(`fetchCommercialProfile` já em memória) com os valores novos derivados das
respostas e envia o objeto **completo** ao `PUT`. O onboarding não envia
payload parcial.

**Rationale**: preserva CNAEs, ticket médio, ciclo de venda, statuses, faixas
de idade, CTA, tom — campos que a conversa não cobre — sem alterar a semântica
do endpoint (sem modo "partial update" novo, sem segunda rota). Corrida
irrelevante: o onboarding roda em tela fullscreen antes de qualquer edição do
Settings.

**Alternatives considered**: endpoint novo de "sync parcial" — mais superfície
para o mesmo efeito (YAGNI); merge no servidor por flag no body — espalha
política de escrita no backend.

### D2 — Mapeamento determinístico respostas → perfil (FR-002)

**Decision**: função **pura** `buildCommercialProfilePayload(result, current)`
no serviço de onboarding (testável), com a tabela:

| Resposta | Destino no perfil |
|---|---|
| empresa | `companyName` (e o endpoint já atualiza o nome da organização) |
| setor | `targetSegments` (valor único como veio) |
| tamanho do time | `salesTeamSize` |
| mercado-alvo | `targetSizes`: Pequenas→`small`, Médias→`medium`, Grandes→`large`; B2C/Órgãos públicos só no registro |
| regiões de interesse | `targetLocations` (rótulos como veio; "Outro" entra como texto) |
| site institucional | `websiteUrl` |
| contexto de negócio (produtos) | `productDescription` (`"Nome — descrição"`, junção com `"; "`) |
| proposta de valor extraída | `valueProposition` |
| modelo de negócio extraído | `businessModel` |
| diferenciais extraídos | `differentiators` |
| CRM declarado | `crmName` (novo; `__none__` → `null`) |
| todas as respostas | `onboardingAnswers` (novo; registro completo) |
| conclusão | `onboardingCompleted: true` |

**Rationale**: transformação pura = testes diretos e zero lógica escondida na
UI; os valores de porte coincidem com os `sizeOptions` do formulário
(`small|medium|large`), então o Settings e a prospecção leem sem tradução.

**Alternatives considered**: mapear no servidor (payload cru + tradução lá) —
esconderia regra de negócio do lugar onde o roteiro vive e dificultaria os
testes; novas colunas por pergunta — explosão de schema sem uso imediato.

### D3 — Registro completo das respostas em JSON (FR-003)

**Decision**: coluna nova `onboardingAnswers Json?` guarda o mapa integral
`{ [questionId]: { value, via, answeredAt } }` + `completedAt`. Respostas sem
campo próprio (nome, cargo, objetivo, e-mail confirmado, catálogo, materiais)
e as puladas (`value: null, via: 'skipped'`) ficam registradas — "nenhuma
informação perdida" vira garantia estrutural.

**Rationale**: 1 coluna resolve o requisito inteiro sem explosão de schema;
dados do próprio org, dentro do perfil, fora de logs (constituição V/VII).

**Alternatives considered**: coluna por resposta — rigidez e migrações futuras
a cada pergunta nova; só o mapeamento sem registro — viola FR-003.

### D4 — Pergunta de região como 9ª pergunta com opção exclusiva (FR-006/007/008)

**Decision**: nova questão `regioesInteresse` (`multi-chips`, pulável, com
"Outro") entre mercado-alvo (8) e e-mail (→10ª); opções `todo-brasil` (rótulo
"Todo o Brasil", **exclusiva**), `Norte`, `Nordeste`, `Centro-Oeste`, `Sudeste`,
`Sul`. A exclusividade é propriedade do roteiro (`exclusiveValue` na questão,
espelhada na mensagem de chips): na UI, selecionar a exclusiva limpa as demais;
no dado, `validateAnswer` segue aceitando qualquer multi seleção não vazia. O
fluxo passa a 13 perguntas; `order` e `SUMMARY_LABELS` renumerados.

**Rationale**: reutiliza todo o mecanismo de multi-chips existente (uma
propriedade nova, sem componente novo); a semântica de exclusividade é do
domínio (país inteiro ⊃ regiões) e pertence ao roteiro.

**Alternatives considered**: pergunta `chips` de seleção única "Brasil todo vs
regiões" + follow-up — 2 interações onde 1 resolve; UF por UF — granularidade
sem demanda (macro-regiões cobrem o pedido; "Outro" escapa quando precisar).

### D5 — Sidebar deriva do perfil salvo (FR-010)

**Decision**: `App` passa a priorizar o perfil persistido na montagem:
`crmName` salvo → badge verde; `companyName` salvo → workspace (fallback atual
mantido). O resultado efêmero da conversa continua alimentando a transição
imediata pós-conclusão (sem espera de refetch).

**Rationale**: hoje o badge morre no recarregamento (estado efêmero); com o
CRM persistido (D3/D2), a fonte da verdade vira a conta — mesmo visual, base
durável.

**Alternatives considered**: refetch obrigatório pós-onboarding — atrito e
estado a mais; manter como está — FR-010 não atendido.

### D6 — Falha de salvamento: retry conversacional na camada de exibição (FR-005)

**Decision**: `onComplete` vira operação async; em erro, o chat exibe bolha da
Ava ("não consegui salvar suas respostas agora — sua conexão parece instável,
tenta de novo? 🙂"), o resumo permanece com o botão de confirmação reabilitado
("Tentar de novo") e **nenhuma resposta é descartada** (serviço intacto). Sucesso
→ despedida + dashboard como hoje.

**Rationale**: mantém o serviço determinístico (sem I/O novo nele); o estado de
"salvando/erro" é de UI; FR-005 garantido sem estados novos no contrato do
onboarding.

**Alternatives considered**: fila de retry automática em background — imperceptível
e pode mascarar falha; bloquear confirmação preventivamente — pior UX.

## Consequências para as tarefas

- Migração Prisma única (`crmName`, `onboardingAnswers`) antes de qualquer
  código que as leia; `db:deploy` aplica no pipeline.
- Testes primeiro: tabela de mapeamento (D2) e merge (D1) em
  `onboarding.profile.test.ts`; roteiro 13 perguntas + exclusividade em
  `avaScript.test.ts`; serviço com a nova questão em `onboarding.test.ts`.
- `normalizeCommercialProfilePayload`/`empty`/`format` + tipos recebem os 2
  campos novos (idempotentes ao payload atual).
