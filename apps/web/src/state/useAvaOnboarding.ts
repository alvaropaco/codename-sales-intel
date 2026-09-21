/**
 * useAvaOnboarding — estado da sessão de onboarding conversacional (feature 004).
 * Consome services/onboarding (fronteira única) e orquestra o pacing do chat:
 * mensagens da Ava são reveladas uma a uma, com indicador "···" e jitter
 * aleatório de 800–1600 ms (decisão D8 do research.md — FR-009). As reações de
 * reconhecimento (avaReactions) são injetadas na camada de exibição — o
 * serviço permanece determinístico (testável) e a conversa, viva.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AVA_QUESTIONS, getQuestion, pendingInteractionMessage, previousAnsweredQuestion, type PromptContext } from '@/lib/avaScript';
import { reactionFor } from '@/lib/avaReactions';
import { createOnboardingService } from '@/services/onboarding';
import type {
  AnswerResult,
  ChatMessage,
  OnboardingResult,
  OnboardingState,
  QuestionId,
} from '@/types/onboarding';

interface UseAvaOnboardingOptions {
  prefill?: PromptContext;
  /** Chamado na confirmação do resumo (US3) — App troca para o dashboard. */
  onComplete?: (result: OnboardingResult) => void;
}

/** Reação fixa usada quando o usuário pula uma pergunta. */
const SKIP_REACTION = 'Sem problemas, seguimos! 🙂';

const MIN_TYPING_MS = 800;
const MAX_TYPING_MS = 1600;

function jitter(): number {
  return MIN_TYPING_MS + Math.random() * (MAX_TYPING_MS - MIN_TYPING_MS);
}

interface InjectedReaction {
  anchorId: string;
  message: ChatMessage;
}

let reactionSeq = 0;

function reactionMessage(text: string): ChatMessage {
  reactionSeq += 1;
  return { id: `reaction-${reactionSeq}`, from: 'ava', kind: 'text', text };
}

export function useAvaOnboarding({ prefill, onComplete }: UseAvaOnboardingOptions = {}) {
  const [service] = useState(() => createOnboardingService({ storage: sessionStorage, prefill }));
  const [state, setState] = useState<OnboardingState>(() => service.getState());
  const [injected, setInjected] = useState<InjectedReaction[]>([]);
  const lastReactionRef = useRef<string | undefined>(undefined);

  // Mensagens de exibição = mensagens do serviço + reações ancoradas logo
  // após o eco da resposta do usuário. Injeções com âncora removida (revise/
  // reset) somem naturalmente na mesclagem.
  const displayMessages = useMemo(() => {
    const out: ChatMessage[] = [];
    for (const message of state.messages) {
      out.push(message);
      for (const injection of injected) {
        if (injection.anchorId === message.id) out.push(injection.message);
      }
    }
    return out;
  }, [state.messages, injected]);

  // Quantas mensagens já foram reveladas — as novas da Ava aparecem atrás do
  // "···" e entram uma a uma (sensação de conversa viva).
  const [visibleCount, setVisibleCount] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (visibleCount >= displayMessages.length) {
      setTyping(false);
      return;
    }
    const next = displayMessages[visibleCount];
    if (next.from === 'user') {
      setVisibleCount((c) => c + 1);
      return;
    }
    setTyping(true);
    const timer = setTimeout(() => {
      setTyping(false);
      setVisibleCount((c) => c + 1);
    }, jitter());
    return () => clearTimeout(timer);
  }, [displayMessages, visibleCount]);

  const currentQuestionId: QuestionId | null =
    state.stepIndex < AVA_QUESTIONS.length ? AVA_QUESTIONS[state.stepIndex].id : null;

  // ------------------------------------------------------------------
  // Gate de interação (008 — FR-002): o composer/chips pertencem à
  // MENSAGEM DE INTERAÇÃO PENDENTE (pergunta corrente), nunca à "última
  // mensagem do transcript" — um resultado de extração (ou recibo/correção)
  // chegando depois dela não a desativa. `revealedPromptRef` mantém a
  // pergunta acionável depois de revelada mesmo se novas mensagens entrarem
  // no meio (o "···" cobre o intervalo).
  // ------------------------------------------------------------------
  const pendingPrompt: ChatMessage | null = useMemo(
    () => pendingInteractionMessage(displayMessages, currentQuestionId),
    [displayMessages, currentQuestionId]
  );
  const revealedPromptRef = useRef<Set<string>>(new Set());
  const pendingPromptIndex = useMemo(() => {
    if (!pendingPrompt) return -1;
    return displayMessages.findIndex((m) => m.id === pendingPrompt.id);
  }, [displayMessages, pendingPrompt]);
  useEffect(() => {
    if (pendingPromptIndex >= 0 && visibleCount > pendingPromptIndex && pendingPrompt) {
      revealedPromptRef.current.add(pendingPrompt.id);
    }
  }, [pendingPromptIndex, visibleCount, pendingPrompt]);

  function reactionContext(latest: OnboardingState): PromptContext {
    return {
      firstName: (latest.answers.nome?.value as string) || prefill?.firstName,
      companyName: (latest.answers.empresa?.value as string) || prefill?.companyName,
    };
  }

  function injectReaction(anchorId: string, text: string) {
    lastReactionRef.current = text;
    setInjected((prev) => [...prev, { anchorId, message: reactionMessage(text) }]);
  }

  const submitAnswer = useCallback(
    (value: string | string[], via: 'text' | 'chip' | 'prefilled' = 'text'): AnswerResult => {
      if (!currentQuestionId) return { ok: false, reason: 'EMPTY' };
      const answeredId = currentQuestionId;
      const result = service.answer(answeredId, value, via);
      if (result.ok) {
        const latest = service.getState();
        const echo = [...latest.messages].reverse().find((m) => m.from === 'user');
        const answer = latest.answers[answeredId];
        if (echo && answer && answer.value !== null) {
          const { text } = reactionFor(
            answeredId,
            answer.value,
            reactionContext(latest),
            lastReactionRef.current ? [lastReactionRef.current] : []
          );
          injectReaction(echo.id, text);
        }
      }
      setState(service.getState());
      return result;
    },
    [service, currentQuestionId, prefill]
  );

  const skipCurrent = useCallback((): AnswerResult => {
    if (!currentQuestionId) return { ok: false, reason: 'EMPTY' };
    const result = service.skip(currentQuestionId);
    if (result.ok) {
      const latest = service.getState();
      const echo = [...latest.messages].reverse().find((m) => m.from === 'user');
      if (echo) injectReaction(echo.id, SKIP_REACTION);
    }
    setState(service.getState());
    return result;
  }, [service, currentQuestionId]);

  const revise = useCallback(
    (questionId: QuestionId): AnswerResult => {
      const result = service.revise(questionId);
      if (result.ok) {
        setInjected((prev) => prev.filter((inj) => state.messages.some((m) => m.id === inj.anchorId)));
        // 008 (FR-007): sem replay do transcript — o histórico revelado
        // permanece e apenas o prompt re-anexado entra com "···".
        const latest = service.getState().messages;
        setVisibleCount(Math.max(latest.length - 1, 0));
        lastReactionRef.current = undefined;
      }
      setState(service.getState());
      return result;
    },
    [service, state.messages]
  );

  const reset = useCallback(() => {
    service.reset();
    setInjected([]);
    setVisibleCount(0);
    setTyping(false);
    lastReactionRef.current = undefined;
    revealedPromptRef.current = new Set();
    setState(service.getState());
  }, [service]);

  /** Confirmação do resumo (FR-015): conclui e devolve o resultado da conta. */
  const confirmSummary = useCallback((): OnboardingResult | null => {
    const result = service.complete();
    setState(service.getState());
    return result;
  }, [service]);

  // ------------------------------------------------------------------
  // Ativos de negócio (US5): anexos/URLs disparam a extração na conversa
  // (FR-024). `extracting` mantém o "···" com teto de 30 s (D8/FR-022).
  // ------------------------------------------------------------------
  const [extracting, setExtracting] = useState(false);
  const [extractionSlow, setExtractionSlow] = useState(false);

  /** Gate de interação (008): ver comentário em pendingPrompt acima. */
  const inputReady =
    !!pendingPrompt &&
    (visibleCount > pendingPromptIndex || revealedPromptRef.current.has(pendingPrompt.id)) &&
    !typing &&
    !extracting;

  const runExtraction = useCallback(async () => {
    setExtracting(true);
    setExtractionSlow(false);
    const slowTimer = setTimeout(() => setExtractionSlow(true), 30000);
    try {
      await service.extractBusinessContext();
    } finally {
      clearTimeout(slowTimer);
      setExtracting(false);
      setExtractionSlow(false);
      setState(service.getState());
    }
  }, [service]);

  /** Registra site/catálogo e dispara a extração (FR-021/FR-023). */
  const attachUrl = useCallback(
    (type: 'site' | 'catalog', url: string) => {
      service.addUrlAsset(type, url);
      setState(service.getState());
      void runExtraction();
    },
    [service, runExtraction]
  );

  /** Anexa materiais; arquivos aceitos disparam a extração (FR-022). */
  const attachFiles = useCallback(
    (files: File[]) => {
      const result = service.addFiles(files);
      setState(service.getState());
      if (result.accepted.length > 0) void runExtraction();
      return result;
    },
    [service, runExtraction]
  );

  const finishAttachments = useCallback((): AnswerResult => {
    const result = service.finishAttachments();
    setState(service.getState());
    return result;
  }, [service]);

  /** Alvo da ação "corrigir resposta anterior" durante a conversa (FR-012). */
  const reviseTarget: QuestionId | null = previousAnsweredQuestion(state.stepIndex, state.answers);

  return {
    state,
    visibleMessages: displayMessages.slice(0, visibleCount),
    /** Mensagem de interação pendente (008) — options/chips dela. */
    pendingPrompt,
    /** Composer/chips ativos: pergunta pendente revelada e sem "···"/extração. */
    inputReady,
    typing,
    currentQuestionId,
    isSummaryPhase: state.stepIndex >= AVA_QUESTIONS.length && !state.completed,
    extracting,
    extractionSlow,
    reviseTarget,
    submitAnswer,
    skipCurrent,
    revise,
    reset,
    confirmSummary,
    attachUrl,
    attachFiles,
    finishAttachments,
  };
}

export type AvaOnboardingController = ReturnType<typeof useAvaOnboarding>;
