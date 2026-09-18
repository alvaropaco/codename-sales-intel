# Data Model: Métricas de Decisão de Contato no Lead

**Feature**: 003-contact-decision-metrics | **Date**: 2026-09-17

> **Nenhuma migração de schema.** Todas as entidades abaixo são *computed
> read-models*: derivadas on-read das evidências já persistidas
> (`Prospect`, `enrichmentSummary`, perfil do grafo). O contrato de API está em
> [contracts/api.md](./contracts/api.md).

## Entidades de entrada (existentes, somente leitura)

### Prospect (Prisma — campos usados)

| Campo | Tipo | Uso no painel |
|-------|------|---------------|
| `cnpj` | String? | Diferencia lead com/sem identificador (FR-018) |
| `cnpjEmail` | String? | Evidência de canal (classificado por `classifyEmailDomain`) |
| `cnpjPhones` | Json? (array) | Evidência de canal telefone |
| `cnpjOpenedAt` | DateTime? | Sinal "empresa recente" do Momento |
| `cnpjRawData` | Json? | Situação cadastral (`situacao_cadastral`; helper `isActive`) |
| `enrichmentStatus` | String | `pending/error` participa da regra de "sem dados" |
| `enrichmentSummary` | Json? | `website_active`, `corporate_email`, `tech_count`, `score_breakdown` |
| `enrichedAt` / `updatedAt` | DateTime | Datas de captura (freshness FR-016) |
| `creditRiskScore` / `creditRiskLevel` | Int? / String? | Fator risco da recomendação |
| `contactedChannels` / `lastContact` / `status` | Json / DateTime / String | Contexto "já contatado" (FR-015) |
| `domain` | String? | Sinal digital do Momento p/ leads sem CNPJ |

### Perfil do grafo (view `v_company_graph` via `enrichment-graph.js`)

| Campo | Uso no painel |
|-------|---------------|
| `profile.contact_points[]` `{type, value, confidence}` | Canais de Atingibilidade (email/phone/whatsapp, dedup por valor) |
| `profile.social` (mapa) | Sinal social do Momento |
| `profile.technologies[].category` | Stack de marketing/vendas/analytics do Momento |
| `enrichedAt` | Data de captura (freshness) |

## Entidades computadas (read-model — payload do endpoint)

### ContactDecision (raiz)

```
prospectId: string
generatedAt: ISODateTime
dataRestricted: boolean          // eco do gating de plano (trial)
freshness: Freshness
reachability: Reachability       // FR-002 — "consigo chegar?"
timing: Timing                   // FR-003 — "agora é hora?"
recommendation: Recommendation   // FR-004..FR-007
```

### Reachability

```
level: 'high' | 'medium' | 'low' | 'unknown'   // selo primário (FR-017)
score: number | null                            // 0–100, null quando unknown
usableChannel: boolean                          // existe ≥1 canal utilizável
recommendedChannel: 'email' | 'phone' | 'whatsapp' | null
channels: Array<{ type, classification: 'corporate'|'generic'|'third_party'|'unknown', confidence }>
evidence: Array<Evidence>
basis: Basis                                    // fontes consultadas
stale: boolean                                  // FR-016
```

Regra de estado: `unknown` (score null) somente quando não há **nenhuma** fonte
de evidência consultável (enriquecimento pendente/erro E sem canais de cadastro
E sem grafo) — FR-008. Enriquecimento concluído sem canal nenhum é dado real:
`level 'low'`, `usableChannel false`.

### Timing

```
level: 'high' | 'medium' | 'low' | 'unknown'
score: number | null
inactive: boolean | null        // situação cadastral irregular (null = desconhecida)
missingOfficialSignals: string[] // FR-018: p/ leads sem CNPJ — ex. ['situacao_cadastral','cnpj_age']
evidence: Array<Evidence>
basis: Basis
stale: boolean                  // FR-016
```

Sem CNPJ: computa sobre os sinais digitais e renormaliza os pesos (FR-018),
listando os sinais oficiais ausentes.

### Recommendation

```
verdict: 'contact_now' | 'contact_lower_priority' | 'do_not_prioritize'
reasons: Array<{ code, detail }>   // códigos estáveis — tabela abaixo
factors: { reachability, timing, fit, risk }   // cada um { weight, value|null, status: 'used'|'neutral'|'unknown' }
suggestedAction: 'enrich_lead' | 'start_email' | 'start_whatsapp' | 'defer' | null
contactedContext: { contacted: boolean, channels: string[], lastContact: ISODateTime | null } | null  // FR-015
```

**Gates (FR-014)**, aplicados após a média ponderada:
1. `timing.inactive === true` OU `risk level = 'high'` → teto `contact_lower_priority` (+ motivo `inactive_company` / `high_credit_risk`).
2. `timing.inactive === true` E risco alto → `do_not_prioritize`.
3. `usableChannel === false` → `do_not_prioritize` (+ `no_channel`, ação `enrich_lead`).

**Fatores**: atingibilidade (peso 40), momento (35), aderência (15, de
`score_breakdown.setor + porte` renormalizado; neutro 50 se ausente), risco
(10, `100 − creditRiskScore`; neutro 50 se ausente). Média renormalizada pelos
fatores com status `used` — fator `unknown` não penaliza.

### Evidence

```
{ key: string, label: string, detail: string, confidence?: number, date?: ISODateTime }
```

**Nunca contém valor de e-mail/telefone** (R7 do research) — apenas tipo,
classificação e confiança.

### Freshness

```
stale: boolean            // qualquer métrica com evidência > STALE_AFTER_DAYS
lastEvidenceAt: ISODateTime | null
thresholdDays: 90
```

## Constantes de scoring (exportadas do módulo, testáveis)

```js
REACH_WEIGHTS = { corporate_email: 40, generic_email: 10, phone: 25, whatsapp: 10, enriched_email: 15 }
TIMING_WEIGHTS = { active_status: 25, website_active: 20, corporate_email: 10, social: 10,
                   growth_stack: 15, tech_any: 5, recent: 10, momentum_positive: 5 }
TIMING_DIGITAL_SUBTOTAL = 65   // denominador da renormalização sem CNPJ (FR-018)
FACTOR_WEIGHTS = { reachability: 40, timing: 35, fit: 15, risk: 10 }
VERDICT_THRESHOLDS = { contact_now: 65, contact_lower_priority: 40 }
STALE_AFTER_DAYS = 90
LEVEL_THRESHOLDS = { high: 70, medium: 45 }   // high ≥70 · medium ≥45 · low >0
```

## Transições de estado (ciclo de vida do painel)

```
prospect.enrichmentStatus pendente/erro + zero evidências → métricas 'unknown' (FR-008)
novo fato de enriquecimento chega → polling do hook reconsulta endpoint → painel recalcula (FR-013)
evidência > 90 dias → stale=true por métrica, valor permanece (FR-016)
lead recebe contato → contactedContext vira preenchido (FR-015); veredito NÃO muda de forma
```

## Validações e invariantes (testáveis)

1. Payload jamais contém valor de e-mail/telefone (SC-006) — teste de contrato.
2. `score` só existe quando `level !== 'unknown'` (FR-008).
3. `verdict = 'contact_now'` implica `usableChannel && !inactive && riskLevel !== 'high'` (FR-014).
4. Lead sem CNPJ ⇒ `timing.missingOfficialSignals` não-vazio quando há qualquer cálculo (FR-018).
5. Determinismo: mesmas entradas → mesmo payload (sem timestamp de relógio dentro do cálculo; `generatedAt` é carimbo do endpoint).
6. Evidências citadas ⊆ fontes disponíveis no input (`basis`).
