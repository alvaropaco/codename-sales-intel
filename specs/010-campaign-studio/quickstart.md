# Quickstart — Validação do Campaign Studio (010)

Guia de validação ponta a ponta. A implementação só está "done" quando os
cenários abaixo passam. Referências: [rest-api.md](./contracts/rest-api.md),
[jobs-queues.md](./contracts/jobs-queues.md), [data-model.md](./data-model.md).

## Pré-requisitos

```bash
pnpm install                      # dependências (inclui as novas: @dnd-kit/core, mjml, pdf-parse, mammoth)
pnpm run db:migrate               # migração Prisma com os modelos Studio (nunca db push)
pnpm run db:generate
```

Variáveis de ambiente (além das existentes do repo):

| Var | Papel |
|---|---|
| `STUDIO_STORAGE_DIR` | volume para binários de material (default: `./.data/studio`) |
| `AI_CAMPAIGN_LLM_MODEL` | modelo premium de composição (já existe) |
| `LITELLM_URL` | gateway LLM (já existe) |

Ambiente de teste: usar **fixtures** de leads/materiais (constituição V —
nunca contas reais de produção). Para envio real em dev, contas de teste
(Gmail app-password/Resend + sessão WAHA de teste).

## Build & suíte automatizada

```bash
pnpm test                 # inclui as novas suítes test/studio-*.test.js
pnpm --filter web build   # shell /studio compila
pnpm run dev              # plataforma + web
```

Suítes mínimas esperadas (task list detalha):

- `test/studio-segments.test.js` — critérios → contagem; catálogo fechado
  rejeita campo/op inválido; NL → critérios (mock LLM).
- `test/studio-approval-flow.test.js` — máquina de estados: draft→review→
  approve; compliance `block` impede; aprovar congela snapshot; leads novos
  no segmento NÃO entram; edição pós-run exige pausa.
- `test/studio-scheduler.test.js` — janela fora de horário não envia; cota
  por hora respeitada; previsão de conclusão; opt-out no meio da fila barra
  o envio.
- `test/studio-journey.test.js` — e-mail→wait→condição abriu/não abriu→
  WhatsApp; resposta para tudo; webhook inicia para lead da org.
- `test/studio-personalization.test.js` — lote com fallback para lead sem
  dados; edição por lead não vaza para os demais; preview == render de envio.
- `test/studio-experiments.test.js` — divisão determinística 20/80; vencedor
  por critério; otimização contínua desligada mantém split estático.
- `test/studio-compliance.test.js` — e-mail sem descadastro → `block`;
  opt-out listado com motivo; LGPD: lead sem base sinalizado.
- `test/studio-guardrails.test.js` — automação opt-in: 1º lote exige
  aprovação; anomalia (bounce alto simulado) pausa com motivo.

## Cenários manuais (o fluxo da spec, na ordem)

### C1 — Criação, revisão e aprovação (US1/US2/US3 — o MVP)

1. Acesse `/studio` → **tema dark, shell próprio** (fora das tabs atuais).
2. Crie segmento "Indústria SP score alto" (`industry contém indústria` +
   `state = SP` + `opportunityScore ≥ 70`) → contagem e amostra visíveis.
3. Nova campanha manual → audiência = segmento salvo → veja **excluídos com
   motivo** (coloque um lead na supressão antes: ele aparece e não é
   incluível). Cole também uma lista de 2 CNPJs existentes + 1 inexistente
   → 2 resolvidos, 1 em `unmatched`, nenhum prospect criado.
4. Escreva e-mail (assunto/corpo/CTA) + mensagem WhatsApp → preview
   desktop/mobile e preview WhatsApp realista.
5. **Submit review** → Compliance Guard roda → approve → **agende para
   amanhã 9h–12h, 5/hora**.
6. Confirme: nada envia antes; às 9h a fila inicia respeitando 5/h; às 12h
   pausa ("fora da janela"); 9h do dia seguinte retoma sozinha. A previsão
   de conclusão exibida no agendamento se mantém coerente.
7. Adicione um lead novo no segmento **depois** da aprovação → ele NÃO
   recebe (snapshot congelado).

✅ Critério: SC-001/002/003 e cenários US1–US3.

### C2 — Campaign from Material (US4)

1. Upload de um PDF de oferta fictícia → extração mostra
   produto/oferta/benefícios/público/CTA → confirme (edite um campo).
2. Componha pacote com tons `formal` + `comercial` → 2 variantes por canal
   (e-mail ≠ WhatsApp), queda em **revisão**, nada dispara.

✅ Critério: FR-024/025/026.

### C3 — Personalização com dados do B2Base (US7)

1. Numa campanha com leads de ≥2 setores, rode personalização `intro`.
2. Preview de 10 leads: cada intro cita o setor correto; lead sem dados →
   `base_fallback` sinalizado (nada inventado).
3. Edite a variação de 1 lead → não muda os demais; opção "propagar regra"
   aparece.

✅ Critério: FR-047–FR-051, SC-006.

### C4 — Journey com fallback WhatsApp (US8/US6)

1. Monte: e-mail → wait 2d → condição `abriu e não clicou` → WhatsApp →
   condição `respondeu` → fim; parada global por resposta.
2. Simule interações (fixtures): leads seguem ramos corretos; resposta
   cancela WhatsApp; canvas mostra contagem por bloco.
3. Chame o webhook do journey com `prospectRef` de um lead da org → lead
   inicia o fluxo; token inválido → 401/404 sem vazar existência.

✅ Critério: FR-052–FR-056, FR-043/044.

### C5 — Analytics e A/B (US10/US11)

1. Rode A/B de assunto 20/80; veja métricas por variante; declare vencedor
   pelo critério → decisão registrada na timeline.
2. Dashboard: funil enviado→entregue→aberto→clicado→respondido com aberturas
   rotuladas **estimadas**; corte por segmento; timeline do lead mostra
   todos os toques multi-canal em ordem.

✅ Critério: FR-060–FR-069, SC-007.

### C6 — Guard-rails da automação existente (clarify Q1)

1. Adote uma suíte `on_enrichment` existente no Studio → primeira liberação
   exige aprovação de amostra.
2. Simule pico de bounce → suíte pausa com `anomalyReason` + notificação;
   retomada exige ação humana.

✅ Critério: FR-003 (exceção de guard-rails), decisão de clarify.

### C7 — Gating e multi-tenancy (constituição IV)

1. Org trial: cria/agenda/envia campanha manual (base funciona); rota
   `[premium]` (ex.: compose por material) → 403 `PREMIUM_REQUIRED`.
2. Org A não vê nenhuma entidade da org B em nenhum endpoint (`orgId`
   em toda query).

✅ Critério: FR-074, D13.

## Sinais de conclusão

- [ ] `pnpm test` verde com as suítes `studio-*`
- [ ] C1–C7 executados manualmente com resultado esperado
- [ ] Métricas `studio_*` visíveis em `/metrics` após C1/C4
- [ ] Nenhuma alteração quebradora em `outreach-*`/`whatsapp-*`/NATS
      (suítes existentes seguem verdes — regressão coberta por `pnpm test`)
