# Quickstart: Métricas de Decisão de Contato no Lead

**Feature**: 003-contact-decision-metrics

Guia de validação ponta a ponta. Referências: [contracts/api.md](./contracts/api.md)
(conteúdo do payload e garantias), [data-model.md](./data-model.md) (regras e
constantes), [../spec.md](../spec.md) (critérios de aceite).

## Pré-requisitos

- Node.js + dependências da raiz instaladas (`pnpm install`).
- Postgres com a base da plataforma e ao menos um lead de cada perfil abaixo
  (fixtures de teste cobrem os casos sem banco).
- Para validação via HTTP: servidor da plataforma rodando com sessão válida
  (cookie Firebase) de uma organização com leads.

## 1. Testes do módulo (porta de entrada — constituição III)

```bash
pnpm test test/contact-decision.test.js
```

Esperado: suíte verde cobrindo, no mínimo:

| Cenário | Requisito |
|---------|-----------|
| E-mail corporativo próprio → atingibilidade alta, canal recomendado = email | FR-002 |
| Único e-mail de provedor gratuito/contabilidade → classificação `generic`/`third_party` | FR-002 |
| Lead enriquecido sem canal nenhum → `usableChannel=false`, veredito `do_not_prioritize`, ação `enrich_lead` | FR-004/FR-005 |
| Sem nenhuma fonte consultável → `level='unknown'`, `score=null` | FR-008 |
| Situação cadastral suspensa → gate impede `contact_now` (+ motivo `inactive_company`) | FR-014 |
| Risco de crédito alto → teto `contact_lower_priority` (+ motivo `high_credit_risk`) | FR-014 |
| Inativa E risco alto → `do_not_prioritize` | FR-014 |
| Lead sem CNPJ → momento renormalizado + `missingOfficialSignals` preenchido | FR-018 |
| Evidência com data > 90 dias → `stale=true` por métrica, valor preservado | FR-016 |
| Lead contatado → `contactedContext` preenchido, veredito inalterado | FR-015 |
| Payload sem nenhum valor de e-mail/telefone (auditoria por regex) | FR-011/SC-006 |
| Fatores ausentes (sem perfil, sem risco) → renormalização, status `neutral`/`unknown` | edge case da spec |

## 2. Suíte completa + build

```bash
pnpm test                      # plataforma inteira continua verde
pnpm run build --prefix apps/web   # build do web (typecheck incluído no gate atual)
```

## 3. Validação por HTTP (opcional, ambiente com dados)

```bash
# com sessão válida:
curl -s --cookie "$SESSION" http://localhost:3000/api/prospects/<LEAD_ID>/contact-decision | jq '.data'
```

Checklist de inspeção:

- [ ] 200 com shape do contrato (`reachability`, `timing`, `recommendation`, `freshness`).
- [ ] Lead de outra organização → 404 (isolamento, FR-012).
- [ ] Corpo da resposta **não contém** `@` de e-mail nem dígito de telefone real (FR-011).
- [ ] Lead com grafo indisponível → 200 com `basis.graph_available=false` e métricas parciais (FR-013).

## 4. Validação na tela (manual, desktop)

Abrir a tela de detalhes de um lead enriquecido e conferir:

- [ ] As três métricas antigas (Potencial, Prontidão, Lançamento) **não aparecem** (FR-001/SC-004).
- [ ] Dois cards: selo qualitativo em destaque (ex.: "Alta"), score 0–100 secundário, evidências listadas (FR-002/FR-003/FR-006/FR-017).
- [ ] Recomendação única em 3 níveis com motivos e ação sugerida (FR-004/FR-005); decomposição de fatores visível (FR-007).
- [ ] Chip "Oportunidade" ausente da seção; risco de crédito presente (FR-009/FR-010).
- [ ] Lead recém-importado sem enriquecimento → "sem dados suficientes" com orientação, sem números (FR-008).
- [ ] Lead já contatado → aviso "já contatado (canal · data)" junto ao veredito (FR-015).
- [ ] Organização trial → métricas visíveis; ações sobre canais continuam bloqueadas/mascaradas (FR-011).
- [ ] Disparar enriquecimento na tela → painel atualiza no polling sem reload manual (FR-013).
- [ ] Erro simulado do endpoint → seção com erro + retry, demais seções intactas (FR-013).

## 5. Resultado das auditorias automatizadas (executadas na implementação)

- **SC-004** ✓ — zero métricas antigas renderizadas em `apps/web/src/components/lead/` (o header do detalhe exibia `opportunityScore` como "Potencial comercial" e foi substituído pelo selo do veredito; a única menção restante é o comentário que documenta a substituição).
- **SC-006** ✓ — `computeContactDecision` executado sobre fixtures com e-mails/telefones sensíveis: zero ocorrências dos valores no payload (auditoria por string/regex, também coberta por teste em `test/contact-decision.test.js`).
- **FR-012** ✓ — rota com `requireRequestOrgId` + `findFirst({ id, orgId })` → 404 cross-tenant.
- **Gates** ✓ — `pnpm test` 234/234 (30 novos testes do painel) e build do web verde.
