# Contract: Serviço de Onboarding — Delta v1.1 (fix de conclusão)

**Feature**: 008-fix-ava-onboarding-completion | `apps/web/src/services/onboarding.ts`

Contrato base: `specs/004-ai-onboarding/contracts/frontend-service.md` (v1).
Este delta documenta **apenas as mudanças**; tudo que não está listado aqui
permanece idêntico (FR-009 da spec 008). A UI continua consumindo a mesma
fronteira — nenhum contrato HTTP muda.

```ts
export function createOnboardingService(deps: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  prefill?: PromptContext;
  extract?: (payload: ExtractionPayload) => Promise<ExtractionResponse>;
  /** NOVO (opcional). Teto de espera da extração em ms. Default: 60_000.
   *  Injetável para testes com fake timers. */
  extractionTimeoutMs?: number;
}): OnboardingService;
```

## Mudanças de comportamento (contratuais)

### 1. `extractBusinessContext(): Promise<ExtractionOutcome>`

- **Teto de espera**: a corrida contra `deps.extractionTimeoutMs`. Estourou →
  ativos em voo ficam `status: 'failed'`, `warning: 'EXTRACTION_TIMEOUT'`;
  mensagem conversacional de aviso é inserida (regra 3 abaixo); retorna
  `{ ok: false, reason: 'TIMEOUT' }` — motivo novo no tipo `ExtractionOutcome`.
- **Época de corrida**: cada chamada incrementa um contador interno. Resultado
  de fetch que pertence a época já superada (timeout estourado ou extração
  mais recente iniciada) é **descartado**: nenhuma mutação de estado, nenhuma
  mensagem anexada. O `Promise` da chamada vigente resolve normalmente com o
  resultado dela.
- **Inserção ordenada** (regra 3 abaixo) aplica-se às mensagens de resultado
  ("Pronto, absorvi tudo…", "não consegui absorver…", falha de conexão, aviso
  de timeout).

### 2. `complete(): OnboardingResult | null`

- **NOVO guarda**: retorna `null` enquanto houver extração em voo (corrida
  vigente ainda não resolvida/estourada). Após o settle — inclusive `TIMEOUT` —
  libera normalmente. Complementa (não substitui) os guardas existentes
  (obrigatórias respondidas + fase de resumo).

### 3. Invariante de ordem do transcript (nova, contratual)

Toda mensagem de status (resultado de extração, aviso de timeout/falha) é
inserida **imediatamente antes** da *mensagem de interação pendente* — a última
mensagem com `questionId` (prompt de pergunta) ou `kind: 'summary'`. Sem
interação pendente, anexa no fim (compatível com v1). Helper puro exposto em
`lib/avaScript.ts`:

```ts
export function insertBeforePendingInteraction(
  messages: ChatMessage[],
  message: ChatMessage
): ChatMessage[];
```

Imutável; não altera mensagens existentes nem ids.

## Contrato da camada de estado/UI (`useAvaOnboarding` + componentes)

- **Gate de interação**: chips/composer renderizam quando a *mensagem de
  interação pendente* (`questionId === currentQuestionId`) já foi revelada e
  não há `typing`/`extracting` — **não** mais quando "a última mensagem é a
  pergunta". Helper puro testável (ambiente node, sem DOM):

```ts
// lib/avaScript.ts (ou módulo irmão puro)
export function pendingInteraction(
  state: OnboardingState,
  currentQuestionId: QuestionId | null
): { message: ChatMessage; revealedBoundaryIndex: number } | null;
```

- **`revise` sem replay**: após `revise()`, o transcript já revelado
  permanece; apenas o prompt re-anexado entra com "···". (Comportamento de
  exibição; sem mudança na semântica de descarte da v1.)
- **`AvaSummary`** ganha prop `confirmDisabled?: boolean` — botão
  "Tudo certo — concluir ✨" desabilitado enquanto `extracting`; `onRevise`
  segue disponível.
- **Eventos observáveis (FR-010)**: o serviço/hook emite
  `console.info('[ava-onboarding]', { event, ...meta })` em `extraction_timeout`,
  `late_result_discarded` e `extraction_settled` (`{ reason }`) — sem dados de
  cliente.

## Compatibilidade

- Callers existentes (App, testes da 004) compilam sem alteração: nenhuma
  assinatura obrigatória mudou; `extractionTimeoutMs` é opcional.
- `onboarding.complete.test.ts` e `onboarding.revise.test.ts` da 004 devem
  continuar passando **sem edição** (nenhum caminho coberto por eles muda);
  `onboarding.assets.test.ts` pode exigir ajuste **somente** se algum teste
  assumir a ordem bugada das mensagens (esperado: não assume).
