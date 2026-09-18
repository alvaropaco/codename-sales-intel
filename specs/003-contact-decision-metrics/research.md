# Research: Métricas de Decisão de Contato no Lead

**Feature**: 003-contact-decision-metrics | **Date**: 2026-09-17

Research conduzido por inspeção direta do código-fonte (nenhuma unknown exigiu
pesquisa externa). Cada decisão segue o formato Decision / Rationale /
Alternatives considered.

## R1. Onde computar as métricas? (server-side vs. worker NATS vs. frontend)

**Decision**: módulo puro server-side na plataforma (`contact-decision.js`),
computado **on-read** por um endpoint dedicado, a partir das evidências já
persistidas.

**Rationale**:
- A constituição (III) exige testes como porta de entrada — o runner de teste
  (`node --test`) vive na plataforma; o frontend web não tem runner.
- Funciona **imediatamente para todos os leads existentes** (inclusive os que
  nunca mais serão reenriquecidos), atendendo à assunção da spec de
  "substituição de superfície" — os dados antigos continuam nos serviços.
- O cálculo usa dados que só o servidor tem sem mascarar: qualidade do domínio
  do e-mail (`classifyEmailDomain`), situação cadastral em `cnpjRawData`,
  canais reais do grafo. Computar no frontend forçaria a lógica a ler valores
  mascarados de trial (impossível classificar) ou exigiria expor dados brutos.
- Aderência ao perfil comercial e risco de crédito já estão disponíveis
  server-side (`enrichmentSummary.score_breakdown`, `creditRiskScore/Level`).
- Precedente arquitetural direto: `opportunity-score.js` é exatamente isso —
  módulo determinístico puro na raiz + integração nas esteiras.

**Alternatives considered**:
- *Persistir os scores no worker Python (`scoring.py`)*: exigiria novo campo no
  resultado v1/v2 do NATS **e** reenriquecimento de toda a base existente para
  aparecer algo na tela — contradiz a spec e cria trabalho de migração. Rejeitado.
- *Computar no frontend (TS puro em `apps/web`)*: sem runner de teste
  (constituição III); precisaria classificar e-mails mascarados de trial;
  duplicaria lógica de domínio (free vs. accounting) já existente no servidor.
  Rejeitado.
- *Reutilizar `commercial_potential` do worker*: é uma das métricas que a
  spec aposenta; rejeitado por definição.

## R2. De onde vêm as evidências? (inventário verificado no código)

**Decision**: mapeamento fixo de evidência → fonte, tudo já persistido:

| Evidência | Fonte | Chave |
|-----------|-------|-------|
| E-mail do cadastro CNPJ | Prisma `Prospect` | `cnpjEmail` |
| Telefones do cadastro | Prisma `Prospect` | `cnpjPhones` (Json array) |
| E-mail corporativo (site próprio) | `enrichmentSummary` | `corporate_email` (bool) |
| Site ativo | `enrichmentSummary` | `website_active` (bool) |
| Contagem de tecnologias | `enrichmentSummary` | `tech_count` |
| Decomposição de sinais (fit = setor+porte, momentum) | `enrichmentSummary` | `score_breakdown` |
| Contatos enriquecidos (email/phone/whatsapp + confiança) | Grafo | `profile.contact_points[]` (`type`, `value`, `confidence`) |
| Redes sociais | Grafo | `profile.social` (chaves) |
| Categorias de tecnologia (marketing/analytics/crm/communications) | Grafo | `profile.technologies[].category` |
| Situação cadastral | Prisma `Prospect` | `cnpjRawData` (BrasilAPI: `situacao_cadastral`, id 2 = ATIVA — helper `isActive` existente) |
| Idade do CNPJ | Prisma `Prospect` | `cnpjOpenedAt` |
| Risco de crédito | Prisma `Prospect` | `creditRiskScore`, `creditRiskLevel` |
| Histórico de contato (FR-015) | Prisma `Prospect` | `contactedChannels`, `lastContact`, `status` |
| Datas de captura (freshness FR-016) | Prospect/Grafo | `enrichedAt` (prospect), `enrichedAt` (linha do grafo), `updatedAt` (cadastro) |

**Rationale**: nenhuma capability nova de enriquecimento (assunção da spec);
tudo verificado presente em `nats-enrichment.js#buildEnrichmentSummary`,
`enrichment-graph.js#fetchCompanyGraph`, `prisma/schema.prisma` (modelo
`Prospect`, linhas 92–148) e `lead-enrichment.js` (merge de
`score_breakdown`/`lead_enrichment`).

## R3. Como classificar a qualidade do canal de e-mail?

**Decision**: reutilizar `classifyEmailDomain` de `opportunity-score.js`, que já
implementa exatamente a taxonomia da spec (FR-002): domínio **corporativo
próprio** vs. **provedor gratuito** (`FREE_EMAIL_DOMAINS`) vs. **contabilidade
terceirizada** (`ACCOUNTING_EMAIL_DOMAINS` — ex. `@contabilizei.com.br`).

**Rationale**: evita duplicar a regra de negócio mais sensível da
atingibilidade; os sets já cobrem o mercado BR; testado em
`test/opportunity-score.test.js`.

**Alternatives considered**: classificação nova com verificação de MX — o
worker Python já tenta MX no enriquecimento (`summary.corporate_email` é o
proxy persistido); verificar MX on-read acrescentaria latência de rede a um
cálculo que deve ser puro. Rejeitado.

## R4. Como o endpoint obtém o perfil do grafo sem acoplamento?

**Decision**: reutilizar `enrichment-graph.js#fetchCompanyGraph(cnpj)`
internamente (mesma função que serve `GET /api/enrichment/graph/:cnpj`), com
try/catch: falha → `graphProfile = null` e as métricas computam só com evidências
do prospect, marcando `basis.graph_available = false`.

**Rationale**: FR-013 (falha de uma fonte não derruba a seção) sem segundo
salto HTTP; `fetchCompanyGraph` já é idempotente e lê a view `v_company_graph`.

**Alternatives considered**: chamar o próprio endpoint HTTP do grafo (loopback) —
acoplamento desnecessário e latência dupla; rejeitado.

## R5. Fórmulas e pesos (determinísticos, testáveis)

**Decision**: pesos fixos documentados (soma 100 por métrica), constantes
exportadas para teste. Ver detalhamento completo em [data-model.md](./data-model.md)
§ Scoring. Resumo:

- **Atingibilidade (0–100)**: e-mail corporativo próprio 40 · e-mail
  genérico/terceirizado 10 · telefone 25 · WhatsApp 10 · e-mail adicional de
  enriquecimento (PDL) 15 · dedup por valor normalizado.
- **Momento (0–100)**: situação cadastral ativa 25 (irregular → 0 + flag
  `inactive`) · site ativo 20 · e-mail corporativo 10 · social 10 · stack de
  marketing/vendas/analytics 15 · tecnologias em geral 5 · empresa/domínio
  recente 10 · `score_breakdown.momentum` positivo 5. **Sem CNPJ (FR-018)**:
  renormaliza sobre os pesos digitais (65 — 100 menos os sinais oficiais: situação cadastral 25 + recentidade 10) e lista
  `missing_official_signals`.
- **Recomendação**: média ponderada dos fatores disponíveis — atingibilidade 40,
  momento 35, aderência 15 (de `score_breakdown.setor+porte`, neutro 50 quando
  ausente), risco 10 (`100 − creditRiskScore`, neutro 50 quando ausente).
  Vereditos: ≥65 `contact_now` · ≥40 `contact_lower_priority` · senão
  `do_not_prioritize`. **Gates (FR-014)**: empresa inativa OU risco alto → teto
  `contact_lower_priority`; inativa E risco alto OU nenhum canal utilizável →
  `do_not_prioritize` (com motivo/ação).

**Rationale**: pesos desproporcionais ao que decide a prática comercial (canal
antes de tudo; momento como segundo fator), gates duros para os dois cenários em
que "abordar agora" seria erro (empresa morta, risco alto). Renormalização por
fatores disponíveis evita penalizar leads sem perfil configurado (edge case da
spec). Todos os limiares são constantes nomeadas e exportadas — testáveis sem
rede nem banco.

**Alternatives considered**: médias simples (ignora que sem canal não há
contato); ML/LLM — viola determinismo e custo; rejeitados.

## R6. Freshness (FR-016) — qual data usar?

**Decision**: `lastEvidenceAt` por métrica = mais recente entre as datas de
captura das evidências que a sustentam (`prospect.enrichedAt`, linha
`enrichedAt` do grafo, `prospect.updatedAt` para o cadastro CNPJ). Selo de
desatualização quando `hoje − lastEvidenceAt > 90 dias` (constante
`STALE_AFTER_DAYS = 90`). O selo é **por fator/métrica** (edge case "idades
mistas" da spec), nunca oculta valor.

**Rationale**: a plataforma não persiste timestamp por fato individual no
perfil do grafo (somente `observed_at` opcional em fatos brutos); usar as
datas das esteiras é fiel o suficiente para um limiar de 90 dias e evita nova
persistência. Constante simples, sem env config (YAGNI).

## R7. Trial (FR-011) — como garantir zero vazamento?

**Decision**: o endpoint **nunca inclui valores de contato na resposta** —
apenas existência, classificação (corporate/free/third_party), tipo de canal e
confiança. A computação usa os dados não mascarados do servidor, mas o payload
emitido é inócuo por construção; `maskProspectForTrial`/`maskCompanyGraphForTrial`
permanecem intocados nos endpoints existentes. `dataRestricted` é ecoado no
payload para o frontend saber que as ações continuam bloqueadas.

**Rationale**: auditar "o que a resposta contém" (SC-006) fica trivial — um
teste de contrato assegura que nenhum campo carrega valor de e-mail/telefone.
Alternativa (mascarar depois de montar o payload) espalharia risco; rejeitada.

## R8. Frontend — como a seção consome o novo endpoint?

**Decision**: `useLeadDetail.ts` ganha a seção `decision` (estado próprio
loading/ready/empty/error + retry, idêntico às demais), com polling no mesmo
interval do enriquecimento ativo (`FR-013`/`FR-017` da spec 002 já implementado
no hook). `LeadIntelligence.tsx` é reescrito para receber `prospect` +
`decision` + `graph` e renderizar: dois cards (selo qualitativo primário +
score secundário + evidência + selo de stale), bloco de recomendação (veredito,
motivos com códigos mapeados para PT-BR, ação sugerida, contexto "já contatado"
FR-015), decomposição de fatores (FR-007), chip de risco de crédito mantido
(FR-010), chip "Oportunidade" removido da seção (FR-009).

**Rationale**: segue o padrão de seções independentes já estabelecido pela
tela (spec 002); falha do endpoint de decisão não derruba as demais seções.
