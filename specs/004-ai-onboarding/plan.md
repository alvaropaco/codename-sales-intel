# Implementation Plan: Onboarding Conversacional com IA (Ava)

**Branch**: `004-ai-onboarding` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-ai-onboarding/spec.md`

## Summary

Substituir o assistente de configuração em formulário (`OnboardingModal`) por uma
conversa com a Ava: 12 perguntas progressivas (9 de configuração + 3 de ativos
de negócio), chips clicáveis, texto natural com Enter, indicador de digitação,
resumo ajustável e transição automática ao dashboard. A Ava extrai, ainda na
conversa, os dados de negócio dos ativos informados (site, pitch deck/PDFs,
catálogo) e alimenta o contexto de negócio usado por outreach (e-mail/WhatsApp).
Nesta iteração tudo vive no estado do app atrás de uma fronteira de serviço
única (decisão do solicitante: "pronto para conectar a uma API real"); a única
escrita nova no backend é um endpoint **stateless** de extração.

Abordagem técnica: conversa guiada por **roteiro determinístico** (ordem, chips,
validação e skips testáveis) com reações de reconhecimento por templates
variados + indicador de digitação (sensação de IA, zero latência de LLM no
loop); **LLM real** reservado para onde agrega valor único — a extração de
dados de negócio dos ativos, via endpoint stateless que reutiliza
`llm-client.js` (gateway LiteLLM) e devolve o contexto no formato que
`org-context.js` já consome.

## Technical Context

**Language/Version**: Plataforma: Node.js (CommonJS, mesmo runtime de
`server-prod.js`, Express 5.2). Web: TypeScript strict + React 18.3 (Vite 5).

**Primary Dependencies**: Existentes — Express 5, Prisma 5 (inalterado nesta
iteração), `llm-client.js` (LiteLLM/OpenAI-compat, `jsonMode`),
`firebase-auth.js` (guard global `createRequireAuth`), Tailwind 3 +
lucide-react + framer-motion no web. **Novas (justificadas em research.md):**
`multer` (multipart em memória), `pdf-parse` (texto de PDF),
`jszip` (texto de DOCX/PPTX — ZIP+XML), `vitest` (dev, testes no web).

**Storage**: N/A nesta iteração — persistência exclusivamente no estado do app
(`sessionStorage` para o flag de conclusão), por decisão de escopo da spec
(FR-018/FR-019). Nenhuma tabela/migração nova.

**Testing**: Raiz: `pnpm test` (`node --test test/*.test.js`, DI manual com
fakes — padrão `test/qualification.test.js`). Web: `vitest` (novo, ambiente
node, sem DOM) para lógica pura (roteiro, validação, serviço de onboarding).

**Target Platform**: Web desktop (SPA existente) + servidor Node único.

**Performance Goals**: Resposta de chip → próxima mensagem da Ava percebida em
≤ 2,5 s (digitação simulada 800–1600 ms); extração de ativos ≤ 30 s p95 (com
aviso conversacional além disso); onboarding completo < 3 min (SC-001).

**Constraints**: Materiais do cliente processados **em memória**, nunca
gravados em disco nem logados (constituição V); limites 5 arquivos × 20 MB
(PDF, PPT/PPTX, DOC/DOCX, TXT — padrão da spec); endpoint de extração idempotente
e stateless (constituição II); nada do contexto de negócio do cliente aparece
em logs (constituição VII).

**Scale/Scope**: 1 tela nova fullscreen + 1 endpoint stateless + sidebar
dinâmica; ~8 módulos novos (5 web, 2 raiz, 1 rota) e 2 dependências de runtime.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Notas |
|-----------|--------|-------|
| I. Especificação antes de código | ✅ | Spec validada em `spec.md` (16/16 checklist), clarificada (3 Q/A). |
| II. Persistência idempotente orientada a eventos | ✅ | Sem persistência nova nesta iteração (estado do app, decisão da spec). Endpoint de extração é stateless e idempotente (reprocessar o mesmo arquivo devolve o mesmo resultado, sem efeito colateral). Integração real com API/DB fica para o passo seguinte documentado na spec. |
| III. Testes como porta de entrada | ✅ | Testes antes da implementação nas tasks: `node --test` (raiz, DI/fakes) para `ava-extract.js`; `vitest` para lógica do roteiro/validação/serviço no web. |
| IV. Multi-tenancy e gating por plano | ✅ | Endpoint novo fica sob o guard global `/api` (`createRequireAuth`); `orgId` sempre do token (`requireRequestOrgId`), nunca do body. Onboarding é universal (não há capacidade a mascarar por plano). |
| V. Segredos fora do repositório | ✅ | Nenhum segredo novo; `LITELLM_URL`/`LITELLM_API_KEY` já chegam por env. Materiais enviados são processados em memória e descartados; proibido logar conteúdo. |
| VI. Simplicidade incremental (YAGNI) | ⚠️→✅ | 4 dependências novas — cada uma com justificativa e alternativa rejeitada em research.md (não há capacidade equivalente no repo; todas de superfície pequena). Módulo novo na raiz segue o padrão plano (`llm-client.js`, `org-context.js`); nenhuma camada nova. |
| VII. Deploy GitOps observável | ✅ | Endpoint expõe métricas prom-client (duração, arquivos, falhas de LLM) e logs estruturados sem conteúdo de cliente; CI/deploy existentes publicam normalmente. |

**Dependências novas (justificativa sintética — detalhes em research.md):**

| Dependência | Tipo | Por quê | Alternativa rejeitada |
|-------------|------|---------|----------------------|
| `multer` | runtime | Único caminho suportado p/ multipart no Express; `memoryStorage` (nada em disco) | `express.raw` + parser manual de multipart (frágil, sem progresso) |
| `pdf-parse` | runtime | Texto de PDF puro JS, sem dependência nativa | Enviar bytes ao LLM (modelo do gateway é text-only); OCR/SaaS externo (vendor novo, custo, segredos) |
| `jszip` | runtime | DOCX/PPTX são ZIP+XML; extrair `<w:t>`/`<a:t>` é determinístico e leve | Recusar DOCX/PPTX no v1 (quebraria o formato prometido na spec) |
| `vitest` | dev (web) | Constituição III exige teste; web não tem infra nenhuma; integra nativamente ao Vite/TS do projeto | `node --test` no web (exigiria compilar TS antes de testar); jest (config pesada, mais lento) |

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-onboarding/
├── plan.md              # Este arquivo
├── research.md          # Decisões técnicas (Phase 0)
├── data-model.md        # Entidades de estado + mapeamento futuro p/ backend (Phase 1)
├── quickstart.md        # Guia de validação ponta a ponta (Phase 1)
├── contracts/
│   ├── http-api.md      # POST /api/onboarding/ava/extract (stateless)
│   └── frontend-service.md # Fronteira de serviço do onboarding (pronta p/ API real)
└── tasks.md             # Phase 2 ($speckit-tasks — não criado aqui)
```

### Source Code (repository root)

```text
# Backend (raiz, padrão de módulos planos existente)
ava-extract.js                      # Extração de negócio: fetch/strip HTML, pdf/zip→texto, LLM jsonMode (DI, testável)
server-prod.js                      # + rota POST /api/onboarding/ava/extract (multer memoryStorage) + métricas prom-client
test/ava-extract.test.js            # node --test: fakes de fetch/LLM, fixtures PDF/DOCX/TXT, limites e warnings

# Frontend (apps/web — React 18 + TS, Tailwind)
apps/web/src/
├── components/onboarding/ava/
│   ├── AvaOnboarding.tsx           # Orquestrador fullscreen da conversa (render condicional no App)
│   ├── ChatBubble.tsx              # Bolha Ava/usuário
│   ├── ChipsRow.tsx                # Chips clicáveis (seleção única e múltipla)
│   ├── TypingIndicator.tsx         # "···" animado (framer-motion)
│   ├── AvaComposer.tsx             # Campo de texto natural (Enter envia) + anexos
│   └── AvaSummary.tsx              # Resumo completo + ajustar item → refaz pergunta
├── lib/
│   ├── avaScript.ts                # Roteiro das 12 perguntas: prompts, chips, validação, obrigatórias (dado puro)
│   └── avaReactions.ts             # Reações de reconhecimento (templates variados)
├── services/
│   └── onboarding.ts               # FRONTEIRA ÚNICA de serviço (interface = futuro client de API)
├── state/
│   └── useAvaOnboarding.ts         # Estado da sessão de onboarding (usa services/onboarding)
├── types/
│   └── onboarding.ts               # Tipos: OnboardingState, BusinessAsset, BusinessContext, OnboardingResult
├── components/layout/
│   ├── Sidebar.tsx                 # + props companyName/userEmail/crm: workspace real + badge verde do CRM no rodapé
│   └── Layout.tsx                  # Repassa novas props
└── App.tsx                         # Gate: Ava chat no lugar de OnboardingModal; guarda OnboardingResult no estado

# Removidos
apps/web/src/components/onboarding/OnboardingModal.tsx   # Deletado (FR-020); CommercialProfileForm em Settings permanece
```

**Structure Decision**: Monorepo existente sem camadas novas — módulo plano
`ava-extract.js` na raiz (como `llm-client.js`/`org-context.js`) para o
backend, feature folder `components/onboarding/ava/` + `services/` no padrão
atual do web. Nenhuma estrutura nova de projeto.

## Complexity Tracking

> Sem violações estruturais de constituição. As 4 dependências novas estão
> justificadas na tabela acima e detalhadas em research.md (Princípio VI exige
> justificativa — fornecida; não são violações).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
