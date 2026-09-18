import { cn } from '@/lib/utils';

interface TypingIndicatorProps {
  /** Exibido atrás do indicador quando a Ava está "digitando". */
  active?: boolean;
}

/** Indicador "···" animado da Ava (FR-009). O timing (jitter 800–1600 ms)
 *  é controlado pelo hook useAvaOnboarding — aqui é só a apresentação. */
export function TypingIndicator({ active = true }: TypingIndicatorProps) {
  if (!active) return null;
  return (
    <div className="flex w-full items-end gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-lg shadow-indigo-500/20">
        <span className="h-2 w-2 rounded-full bg-white/90" />
      </div>
      <div
        aria-label="Ava está digitando"
        className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.06] px-4 py-3.5"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
    </div>
  );
}
