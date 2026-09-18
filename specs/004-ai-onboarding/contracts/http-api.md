# Contract: POST /api/onboarding/ava/extract

**Feature**: 004-ai-onboarding | Stateless. Idempotente. Sem persistência.

## Autenticação

Cookie de sessão existente — o guard global `app.use('/api',
firebaseAuth.createRequireAuth(prisma))` já cobre a rota. `orgId` resolvido do
token (`requireRequestOrgId`); nunca aceito no body. Sem gating por plano
(onboarding é universal).

## Request

`Content-Type: multipart/form-data`

| Campo | Tipo | Obrigatório | Regras |
|-------|------|-------------|--------|
| `siteUrl` | text field | não | URL `http(s)` válida |
| `catalogUrl` | text field | não | URL `http(s)` válida |
| `files` | files[] (mesma chave) | não | ≤ 5 arquivos, ≤ 20 MB cada; mimes: `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` |

Pelo menos um dos três deve estar presente, senão `400 { success:false, error: { code: 'EMPTY_REQUEST' } }`.

## Response 200

```json
{
  "success": true,
  "data": {
    "businessContext": {
      "products": [{ "name": "string", "description": "string" }],
      "valueProposition": "string",
      "businessModel": "string",
      "differentiators": ["string"],
      "targetMarket": "string",
      "sources": ["site", "document", "catalog"]
    },
    "extractedFrom": {
      "site": { "status": "ok", "chars": 8421 },
      "documents": [{ "name": "pitch.pdf", "status": "ok", "chars": 12980 }],
      "catalog": { "status": "ok", "chars": 512 }
    },
    "warnings": [
      "SITE_UNREACHABLE: não foi possível acessar o site informado",
      "DOCUMENT_UNREADABLE: pitch.pdf não tem texto extraível (apenas imagens?)"
    ]
  },
  "timestamp": "2026-09-18T12:00:00.000Z"
}
```

- `businessContext` é `null` quando **nenhuma** fonte rendeu texto ou quando o
  LLM falhou — nesse caso `warnings` inclui `LLM_UNAVAILABLE` e a conversa
  segue (edge cases da spec: nunca bloqueia).
- Códigos de warning (prefixo estável, para a Ava traduzir em linguagem natural):
  `SITE_UNREACHABLE`, `SITE_INVALID_URL`, `DOCUMENT_UNREADABLE`,
  `DOCUMENT_UNSUPPORTED_FORMAT`, `DOCUMENT_EMPTY`, `CATALOG_UNREACHABLE`,
  `LLM_UNAVAILABLE`.

## Erros

| Status | Condição |
|--------|----------|
| 400 | payload vazio, URL inválida, corpo malformado |
| 413 | arquivo > 20 MB ou > 5 arquivos (multer limit) |
| 401 | sessão inválida (guard global) |
| 500 | erro inesperado (`{ success:false, error: { code: 'EXTRACT_FAILED' } }`) — upload/parse nunca persiste estado |

## Garantias

- **Sem persistência**: arquivos e textos vivem apenas em memória da request;
  nada é gravado em disco/DB/log (constituição V).
- **Idempotente**: mesma requisição → mesmo resultado, sem efeito colateral
  (constituição II).
- **Observabilidade** (constituição VII): histograma `b2base_ava_extract_duration_seconds`,
  counters `b2base_ava_extract_files_total{status}` e
  `b2base_ava_extract_llm_failures_total`; logs estruturados só com metadados
  (orgId, tamanhos, mimes, status, duração).
- **Orçamento de tempo**: fetch de URL 10 s; LLM 60 s; total alvo ≤ 30 s p95.

## Implementação

Rota montada em `server-prod.js` com `multer({ storage: memoryStorage, limits })`;
pipeline delegado a `ava-extract.js` (módulo plano com DI: `{ fetchImpl, callLlm,
logger, now }`) — mesma injeção de dependências dos módulos testados em
`test/` (padrão `qualification.test.js`).
