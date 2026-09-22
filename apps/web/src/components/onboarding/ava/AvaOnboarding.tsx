/**
 * AvaOnboarding — orquestrador fullscreen da conversa com a Ava (feature 004).
 * Cai direto no chat no primeiro acesso, sem formulários (FR-001). Chips para
 * as perguntas de escolha (FR-004), texto natural com Enter para as abertas
 * (FR-007), pre-fill da conta (FR-008), "···" entre mensagens (FR-009).
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Sparkles } from 'lucide-react';
import { FAREWELL_MESSAGE, getQuestion, isSkippable } from '@/lib/avaScript';
import { useAvaOnboarding } from '@/state/useAvaOnboarding';
import { ChatBubble } from './ChatBubble';
import { AvaComposer } from './AvaComposer';
import { TypingIndicator } from './TypingIndicator';
import { ChipsRow } from './ChipsRow';
import { AvaSummary } from './AvaSummary';
import type { OnboardingResult } from '@/types/onboarding';
import type { PromptContext } from '@/lib/avaScript';

interface AvaOnboardingProps {
  /** Dados já conhecidos da conta (empresa, e-mail) para o pre-fill (FR-008). */
  prefill?: PromptContext;
  /** 009: salva as respostas na conta (perfil comercial). Erro → retry (FR-005). */
  onPersist?: (result: OnboardingResult) => Promise<void> | void;
  /** Confirmação do resumo (US3): App troca para o dashboard automaticamente. */
  onComplete?: (result: OnboardingResult) => void;
}

export function AvaOnboarding({ prefill, onPersist, onComplete }: AvaOnboardingProps) {
  const ctrl = useAvaOnboarding({ prefill, onComplete });
  const endRef = useRef<HTMLDivElement>(null);
  // Modo "Outro": o usuário trocou os chips pelo texto livre (FR-006).
  const [otherMode, setOtherMode] = useState(false);
  // Despedida pós-confirmação: a Ava se despede e o app leva ao dashboard
  // automaticamente, sem clique (FR-015/SC-004 — teto de 5 s).
  const [farewell, setFarewell] = useState(false);
  // 009 (FR-005): salvamento na conta — "Salvando…" e retry conversacional.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Acompanha o fim da conversa a cada mensagem revelada / "···".
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [ctrl.visibleMessages.length, ctrl.typing, farewell, ctrl.isSummaryPhase, saving, saveError]);

  const handleConfirm = async () => {
    if (saving) return;
    const result = ctrl.confirmSummary();
    if (!result) return;
    setSaveError(false);
    setSaving(true);
    try {
      // Salva na conta ANTES da despedida — nada é perdido em silêncio (FR-005).
      await onPersist?.(result);
    } catch {
      setSaving(false);
      setSaveError(true);
      return;
    }
    setSaving(false);
    setFarewell(true);
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => onComplete?.(result), 1800);
  };

  // Nova pergunta ativa → sai do modo "Outro".
  useEffect(() => {
    setOtherMode(false);
  }, [ctrl.currentQuestionId]);

  // Gate de interação (008): o composer/chips pertencem à pergunta pendente —
  // mensagens de status chegando depois dela não a desativam.
  const pending = ctrl.pendingPrompt;
  const pendingIsCurrent = ctrl.inputReady && !!pending;
  const chipsActive = pendingIsCurrent && pending!.kind === 'chips';
  const inputActive = pendingIsCurrent && pending!.kind === 'input';

  const currentQuestion = ctrl.currentQuestionId ? getQuestion(ctrl.currentQuestionId) : null;
  const skippable = currentQuestion ? isSkippable(currentQuestion) : false;

  // Sugestão da conta (FR-008): e-mail e empresa chegam pré-preenchidos para
  // confirmar com um toque — em especial para a base existente.
  const suggestion =
    ctrl.currentQuestionId === 'email'
      ? prefill?.email
      : ctrl.currentQuestionId === 'empresa'
        ? prefill?.companyName
        : undefined;

  const submitText = (text: string) => {
    const answeredId = ctrl.currentQuestionId;
    const result = ctrl.submitAnswer(text, 'text');
    // Site institucional e URL do catálogo viram ativos de negócio e disparam
    // a extração pela Ava (FR-021/FR-023/FR-024).
    if (result.ok && answeredId === 'siteInstitucional') ctrl.attachUrl('site', text);
    if (result.ok && answeredId === 'catalogo' && ctrl.state.answers.catalogo?.value !== 'nao') {
      ctrl.attachUrl('catalog', text);
    }
    setOtherMode(false);
  };

  const isMateriaisQuestion = ctrl.currentQuestionId === 'materiais';
  const documentCount = ctrl.state.assets.filter((a) => a.type === 'document').length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo-symbol.png" alt="B2Base" className="h-9 w-9 object-contain" />
          <div>
            <p className="text-sm font-black tracking-tight text-white">B2Base</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Configuração guiada
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-bold text-indigo-200">Ava online</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {ctrl.visibleMessages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}

        {ctrl.isSummaryPhase && !farewell && (
          <AvaSummary
            answers={ctrl.state.answers}
            assets={ctrl.state.assets}
            businessContext={ctrl.state.businessContext}
            confirmDisabled={ctrl.extracting || saving}
            confirmLabel={
              saving
                ? 'Salvando…'
                : ctrl.extracting
                  ? 'Ava terminando de ler seus materiais…'
                  : saveError
                    ? 'Tentar de novo ✨'
                    : undefined
            }
            onRevise={(questionId) => ctrl.revise(questionId)}
            onConfirm={handleConfirm}
          />
        )}

        {farewell && <ChatBubble message={{ id: 'farewell', from: 'ava', kind: 'text', text: FAREWELL_MESSAGE }} />}

        {saveError && (
          <ChatBubble
            message={{
              id: 'save-error',
              from: 'ava',
              kind: 'text',
              text:
                'Não consegui salvar suas respostas agora — sua conexão parece instável. ' +
                'Elas estão aqui guardadas comigo; tenta de novo? 🙂',
            }}
          />
        )}

        <div ref={endRef} />
      </div>

      <footer className="border-t border-white/10 bg-slate-950/90 px-4 py-4">
        <div className="mx-auto w-full max-w-2xl space-y-3">
          {(ctrl.typing || ctrl.extracting) && <TypingIndicator />}
          {ctrl.extractionSlow && (
            <p className="text-xs font-semibold text-slate-500">
              Ainda lendo seus materiais… documentos grandes demoram um pouco 📖
            </p>
          )}

          {!ctrl.typing && !ctrl.extracting && chipsActive && !otherMode && (
            <ChipsRow
              options={pending!.options ?? []}
              multi={pending!.multi}
              exclusiveValue={pending!.exclusiveValue}
              allowOther={currentQuestion?.allowOther}
              skippable={skippable}
              onAnswer={(value) => ctrl.submitAnswer(value, 'chip')}
              onOther={() => setOtherMode(true)}
              onSkip={() => ctrl.skipCurrent()}
            />
          )}

          {!ctrl.typing && !ctrl.extracting && (inputActive || (chipsActive && otherMode)) && (
            <AvaComposer
              placeholder={otherMode ? 'Escreve do seu jeito…' : currentQuestion?.placeholder}
              onSubmitText={submitText}
              onSkip={
                isMateriaisQuestion
                  ? () => ctrl.finishAttachments()
                  : otherMode
                    ? undefined
                    : skippable
                      ? () => ctrl.skipCurrent()
                      : undefined
              }
              skipLabel={isMateriaisQuestion ? (documentCount > 0 ? 'Pronto, seguir 📎' : 'Não tenho materiais agora') : undefined}
              allowAttachments={isMateriaisQuestion}
              onAttachFiles={(files) => ctrl.attachFiles(files)}
            />
          )}

          {!ctrl.typing && !ctrl.extracting && (inputActive || (chipsActive && otherMode)) && suggestion && (
            <button
              type="button"
              onClick={() => ctrl.submitAnswer(suggestion, 'prefilled')}
              className="flex items-center gap-1.5 self-start rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
            >
              <Check className="h-3.5 w-3.5" />
              Usar {suggestion}
            </button>
          )}

          {/* Correção retroativa durante a conversa (FR-012) */}
          {!ctrl.typing && !ctrl.extracting && !ctrl.isSummaryPhase && ctrl.reviseTarget && (
            <button
              type="button"
              onClick={() => ctrl.revise(ctrl.reviseTarget!)}
              className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:text-slate-300"
            >
              <Pencil className="h-3 w-3" />
              Corrigir resposta anterior
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
