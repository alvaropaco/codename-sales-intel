# Quickstart: Validar o Onboarding Conversacional (Ava)

**Feature**: 004-ai-onboarding | Validação ponta a ponta da spec.

## Pré-requisitos

- Node.js + pnpm (padrão do repo).
- Gateway LiteLLM **opcional** para a extração de ativos:
  `LITELLM_URL` (default `http://localhost:4000`) e opcionalmente
  `LITELLM_API_KEY`/`LITELLM_MODEL`. Sem gateway, a extração devolve
  `LLM_UNAVAILABLE` e a conversa segue — cenário válido de teste de degradação.

## Setup

```bash
pnpm install                       # inclui as novas deps: multer, pdf-parse, jszip (raiz), vitest (web)
pnpm test                          # testes da plataforma (node --test), inclui test/ava-extract.test.js
cd apps/web && pnpm vitest run     # testes da lógica da conversa (roteiro, serviço, validação)
cd ../.. && pnpm run dev           # web (Vite) + server, padrão do repo
```

## Cenário 1 — Conversa completa (US1, US2, US3)

1. Conta nova (ou limpe `sessionStorage` + use conta com
   `commercialProfile.onboardingCompleted = false`).
2. **Esperado**: cai direto no chat da Ava — nenhum formulário (FR-001/SC-003).
   Ava se apresenta e pergunta o **nome**.
3. Digite o nome e **Enter** → "···" animado aparece antes de cada mensagem da
   Ava (FR-009/SC-005); reação curta + pergunta **empresa**.
4. Responda **empresa** (texto) → pergunta **cargo** com **chips**: clique em um
   chip — zero digitação (FR-004/SC-002).
5. **setor**, **tamanho do time**, **objetivo principal** — todas por chip.
6. **CRM** → escolha "Pipedrive" (chip).
7. **mercado-alvo** → clique **vários** chips (multi, FR-005) e confirme.
8. **e-mail** → com conta de e-mail real, o campo vem **pré-preenchido**
   (FR-008); Enter confirma.
9. **site institucional** → informe uma URL válida (ex.: `https://example.com`).
10. **materiais** → anexe um PDF de teste (crie um com `docs/` ou qualquer PDF
    textual) → a Ava confirma o recebimento do arquivo (FR-022) e mostra "···"
    enquanto processa; ao final **confirma o que absorveu** (produtos/proposta
    — FR-024).
11. **catálogo** → chip "Ainda não tenho" (FR-023).
12. **Esperado**: **resumo completo** das 12 informações, com puladas marcadas
    (FR-013). Clique em **ajustar** um item → a Ava refaz só aquela pergunta e
    atualiza o resumo (FR-014). Confirme → **transição automática ao
    dashboard**, sem clique extra (FR-015/SC-004).

## Cenário 2 — Pós-onboarding (US4)

No dashboard, **sem recarregar**:
- Sidebar mostra **nome da empresa + e-mail** no workspace (FR-016/SC-006).
- Rodapé da sidebar mostra **Pipedrive com badge verde** (FR-017).
- Navegue entre abas → dados persistem na sessão (FR-019).
- Recarregue a página → a conversa **recomeça** (limitação aceita da iteração —
  estado apenas; com flag de conclusão gravado em `sessionStorage`, se você só
  recarregar a aba a conversa não re-aparece).

## Cenário 3 — Conta existente (clarificação Q3)

Use conta antiga com empresa/e-mail já conhecidos e
`onboardingCompleted = false`:
- **Esperado**: mesma conversa, com **empresa e e-mail pré-preenchidos** para
  confirmar com um toque.

## Cenário 4 — Degradação amigável (edge cases)

- Anexe um **PDF só de imagens** (ou renomeie um `.txt` para `.pdf`) → aviso
  conversacional "não consegui absorver", conversa segue (nunca trava).
- Informe **e-mail inválido** → correção pedida em linguagem natural, sem erro
  técnico (FR-010).
- Clique em **pular** numa pergunta não obrigatória → avança; tente pular
  **nome/empresa/e-mail** → não permite.
- Sem gateway LLM (pare o LiteLLM) → extração responde com aviso
  `LLM_UNAVAILABLE`, onboarding conclui normalmente.

## Critérios de aceite rápidos

| Critério | Como verificar |
|----------|----------------|
| SC-001 (< 3 min) | cronometrar o Cenário 1 |
| SC-002 (7/12 sem digitar) | contar perguntas respondidas só com chip |
| SC-003 (0 formulários) | inspecionar o fluxo inteiro |
| SC-004 (transição ≤ 5 s, sem clique) | observar o fim do Cenário 1 |
| SC-009 (contexto extraído) | ver produtos/proposta confirmados pela Ava no passo 10 |
