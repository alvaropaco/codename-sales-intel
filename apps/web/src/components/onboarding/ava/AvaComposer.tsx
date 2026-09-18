import { useRef, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKIP_LABEL } from '@/lib/avaScript';

interface AvaComposerProps {
  placeholder?: string;
  disabled?: boolean;
  /** Enter envia (FR-007). */
  onSubmitText: (text: string) => void;
  /** Perguntas puláveis oferecem "Prefiro não responder" (FR-011). */
  onSkip?: () => void;
  /** Rótulo do botão de pular (ex.: "Pronto, seguir 📎" na pergunta de materiais). */
  skipLabel?: string;
  /** Anexos de materiais (FR-022) — botão de clipe com input de arquivo. */
  allowAttachments?: boolean;
  onAttachFiles?: (files: File[]) => void;
}

/** Campo de texto natural da conversa: digitar + Enter envia. */
export function AvaComposer({
  placeholder,
  disabled,
  onSubmitText,
  onSkip,
  skipLabel,
  allowAttachments,
  onAttachFiles,
}: AvaComposerProps) {
  const [value, setValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmitText(text);
    setValue('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-indigo-400/60">
        {allowAttachments && onAttachFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.docx,.pptx,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) onAttachFiles(files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Anexar materiais (pitch deck, PDFs, documentos)"
              title="Anexar pitch deck, apresentação, PDFs ou documentos"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/5 hover:text-indigo-300 disabled:opacity-50"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </>
        )}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          disabled={disabled}
          placeholder={placeholder || 'Escreva sua resposta…'}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          aria-label="Enviar resposta"
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition',
            value.trim() && !disabled
              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400'
              : 'bg-white/[0.06] text-slate-500'
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {onSkip && (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:text-slate-300 disabled:opacity-50"
        >
          {skipLabel || SKIP_LABEL}
        </button>
      )}
    </div>
  );
}
