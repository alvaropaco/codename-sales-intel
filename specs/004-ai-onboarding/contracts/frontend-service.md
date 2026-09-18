# Contract: Serviço de Onboarding (fronteira única — "pronta para API real")

**Feature**: 004-ai-onboarding | `apps/web/src/services/onboarding.ts`

Interface única consumida por `useAvaOnboarding`. A implementação v1 é
em memória + `sessionStorage`; a troca por um client HTTP (integração real)
não muda nenhuma tela (FR-018).

```ts
export interface OnboardingService {
  /** Estado imutável atual (OnboardingState — ver data-model.md). */
  getState(): OnboardingState;

  /** Registra resposta (chip, texto ou confirmação de pre-fill). Valida FR-010;
   *  retorna o próximo "ato" do roteiro (próxima pergunta/reação) sem I/O. */
  answer(questionId: QuestionId, value: string | string[], via: Answer['via']): AnswerResult;

  /** Pula pergunta não obrigatória (FR-011). Falha para obrigatórias. */
  skip(questionId: QuestionId): AnswerResult;

  /** Adiciona site/catálogo como ativo (valida URL) — FR-021/FR-023. */
  addUrlAsset(type: 'site' | 'catalog', url: string): { ok: boolean; reason?: string };

  /** Anexa documentos (FR-022). Rejeita > 5 arquivos / > 20 MB / mime fora da lista. */
  addFiles(files: File[]): { accepted: File[]; rejected: { file: File; reason: string }[] };

  /** Dispara extração dos ativos pendentes via POST /api/onboarding/ava/extract
   *  (contracts/http-api.md) e incorpora businessContext + warnings no estado. */
  extractBusinessContext(): Promise<ExtractionOutcome>;

  /** Confirmação do resumo: marca concluído, grava flag em sessionStorage
   *  (FR-019) e devolve o resultado para o App/Sidebar (FR-015/016/017). */
  complete(): OnboardingResult;

  /** Ajuste pelo resumo (FR-014): volta a sessão para a pergunta indicada,
   *  descartando a resposta anterior e as mensagens posteriores. */
  revise(questionId: QuestionId): void;

  /** Recomeça a conversa do zero (usado se o usuário recarregar no meio — FR-019). */
  reset(): void;
}

export function createOnboardingService(deps: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; // sessionStorage injetável p/ testes
  prefill?: PromptContext;                                      // dados da conta p/ pré-preenchimento (FR-008)
  extract?: (payload: ExtractionPayload) => Promise<ExtractionResponse>; // fetch injetável p/ testes
}): OnboardingService
```

## Invariantes

1. `answer`/`skip` são **puros em relação a I/O** — I/O só em `extractBusinessContext`
   e no `storage` de conclusão (torna toda a lógica de conversa testável em vitest).
2. Perguntas obrigatórias (`nome`, `empresa`, `email`) rejeitam `skip`.
3. Resposta inválida (e-mail malformado, vazio) retorna
   `{ ok: false, reason: 'INVALID_EMAIL' | 'EMPTY' | ... }` sem avançar o passo.
4. `complete()` só funciona com as 3 obrigatórias respondidas; as demais ficam
   como `skipped` no resultado.
5. `sessionStorage.b2base.avaOnboardingDone = '1'` é escrito **apenas** em
   `complete()` e lido na montagem do gate (App).

## Consumo

- `state/useAvaOnboarding.ts`: mantém `OnboardingState` em `useState`, expõe
  `{ state, answer, skip, addFiles, addUrlAsset, extractBusinessContext, complete, revise }`
  e orquestra os timers do indicador "···" (D8).
- `App.tsx`: cria o serviço **uma vez por sessão** (montagem do gate), recebe
  `OnboardingResult` via `onComplete` e o distribui (Sidebar/Layout).
