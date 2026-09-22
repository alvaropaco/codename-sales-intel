import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKIP_LABEL } from '@/lib/avaScript';
import type { ChipOption } from '@/types/onboarding';

interface ChipsRowProps {
  options: ChipOption[];
  /** Seleção múltipla com confirmação (mercado-alvo — FR-005; regiões — 009). */
  multi?: boolean;
  /** 009: opção exclusiva — selecioná-la limpa as demais (ex.: "Todo o Brasil"). */
  exclusiveValue?: string;
  /** Mostra o chip "Outro" (texto livre — FR-006). */
  allowOther?: boolean;
  skippable?: boolean;
  disabled?: boolean;
  onAnswer: (value: string | string[]) => void;
  /** "Outro" clicado — o pai abre o campo de texto natural. */
  onOther: () => void;
  onSkip: () => void;
}

/** Chips clicáveis da Ava: um toque responde (FR-004). */
export function ChipsRow({
  options,
  multi,
  exclusiveValue,
  allowOther,
  skippable,
  disabled,
  onAnswer,
  onOther,
  onSkip,
}: ChipsRowProps) {
  const [selected, setSelected] = useState<string[]>([]);

  const pick = (value: string) => {
    if (disabled) return;
    if (!multi) {
      onAnswer(value);
      return;
    }
    setSelected((prev) => {
      // Opção exclusiva (009 — FR-008): "Todo o Brasil" ⊃ regiões específicas.
      if (exclusiveValue && value === exclusiveValue) {
        return prev.includes(value) ? [] : [value];
      }
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      return next.includes(exclusiveValue ?? '') ? next.filter((v) => v !== exclusiveValue) : next;
    });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => pick(option.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition',
                isSelected
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow-sm shadow-indigo-500/20'
                  : 'border-white/15 bg-white/[0.04] text-slate-200 hover:border-indigo-400/60 hover:bg-indigo-500/10 hover:text-white',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {isSelected && <Check className="h-3.5 w-3.5" />}
              {option.label}
            </button>
          );
        })}
        {allowOther && (
          <button
            type="button"
            disabled={disabled}
            onClick={onOther}
            className="rounded-full border border-dashed border-white/25 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-indigo-400/60 hover:text-white disabled:opacity-50"
          >
            Outro
          </button>
        )}
      </div>

      {multi && selected.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer([...selected])}
          className="self-start rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-50"
        >
          Confirmar {selected.length} {selected.length === 1 ? 'seleção' : 'seleções'}
        </button>
      )}

      {skippable && (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          className="self-start rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:text-slate-300 disabled:opacity-50"
        >
          {SKIP_LABEL}
        </button>
      )}
    </div>
  );
}
