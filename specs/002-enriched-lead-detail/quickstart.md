# Quickstart: Perfil Completo do Lead Enriquecido

**Feature**: `002-enriched-lead-detail` | **Date**: 2026-09-17

Guia de validação ponta a ponta. Cenários mapeiam os acceptance scenarios da
spec (US1–US5). Detalhes de implementação: ver `plan.md`, `data-model.md`,
`contracts/api.md`.

## Pré-requisitos

```bash
pnpm install
pnpm run db:migrate     # aplica migração da GeocodeCache
pnpm test               # gate da plataforma (constitution III) — inclui testes novos
pnpm run build          # gate do web (tsc && vite build)
pnpm run dev            # web (Vite, :5173) + API (:3001)
```

Variáveis: as já usadas pela plataforma. `ENRICHMENT_DATABASE_URL` é
**opcional** — sem ela, as seções de grafo degradam (valida FR-001.4/US4.3).
Nenhuma chave nova é necessária (tiles OSM + BrasilAPI/Nominatim sem key).

## Dados de teste

- 1 org **premium** com: (a) lead enriquecido completo com CNPJ + endereço no
  `cnpjRawData` + grafo disponível; (b) lead sem CNPJ; (c) lead com
  enriquecimento em andamento; (d) lead nunca enriquecido.
- 1 org **trial** com um lead equivalente ao (a) — valida mascaramento.
- Fixtures, nunca dados reais de produção (constituição V).

## Cenários de validação

### US1 — Tela dedicada + deep link + retorno

1. Login na org premium → Dashboard → clicar no lead (a).
   **Espera**: tela inteira de detalhe (sem drawer/modal), seções renderizadas,
   URL `/leads/<id>` — em ≤ 2s (SC-001).
2. Copiar a URL em nova aba. **Espera**: mesma tela abre direto (SC-006).
3. Voltar (browser ou botão Voltar). **Espera**: retorna à lista com filtros
   ativos preservados.
4. Repetir clique com `ENRICHMENT_DATABASE_URL` removida. **Espera**: seções de
   grafo mostram estado de degradação; demais seções funcionam.

### US2 — Perfil completo (não contadores)

1. Abrir o lead (a). **Espera**: tecnologias e redes sociais listadas por nome
   com confiança; firmografia completa; financeiro; pessoas — cada fato com
   fonte/confiança.
2. Abrir o lead (c) (em andamento). **Espera**: fatos parciais visíveis +
   indicador de progresso, atualizando sem reload manual.
3. Abrir o lead (b) (sem CNPJ). **Espera**: seções dependentes de grafo com
   estado explicativo; cadastro local visível.
4. Auditar: para um fato de referência, comparar tela × fatos persistidos
   (SC-002 — 100% das categorias visíveis como conteúdo).

### US3 — Redes de contato acionáveis

1. No lead (a) premium: clicar telefone → abre WhatsApp; clicar e-mail →
   copia; clicar rede social → abre em nova aba (sem sair da tela).
2. Login na org trial → mesmo lead. **Espera**: valores mascarados com estado
   de bloqueio; ações não revelam valor real (SC-005).
3. Lead sem contatos → estado vazio orientativo.

### US4 — Grafo interativo

1. No lead (a): dar zoom/pan, clicar em um nó. **Espera**: detalhe do nó +
   conexões destacadas.
2. Grafo grande (mock com >16 arestas): navegável sem travar.
3. Lead sem CNPJ ou fonte off: estado explicativo com ação sugerida.

### US5 — Mapa 3D

1. No lead (a): seção Localização → mapa 3D com pino do endereço; rotacionar/
   inclinar a cena; clicar no pino → cartão com endereço completo (SC-003 ≤3s).
2. Lead com 2 endereços (sede + capturado): 2 pinos, cartões corretos.
3. Endereço não geocodificado (forçar falha da fonte externa): item listado
   como "sem localização no mapa", sem pino, sem erro na tela.
4. Trial: apenas pino coarse de cidade/UF; nenhum endereço de rua exposto.
5. Lead sem endereço geocodificável: estado vazio orientativo.

### Cross-cutting

- **Isolamento (FR-014)**: deep link `/leads/<id-da-org-premium>` logado na
  trial → "não encontrado" (404), sem vazamento.
- **Trial masking auditoria (SC-005)**: inspecionar respostas de rede das três
  chamadas da tela (`/enrichment`, `/graph/:cnpj`, `/addresses`) na org trial —
  nenhum valor mascarado presente no payload.
- **Estados (FR-015)**: derrubar a API durante o carregamento → seções em erro
  com retry independente; recuperar → retry por seção funciona sem reload.

## Critérios de aceite do quickstart

Todos os cenários acima passam manualmente; `pnpm test` e `pnpm run build`
verdes antes do merge (constitution III).
