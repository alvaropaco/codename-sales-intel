import React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LockedText — exibe um valor sensível mascarado (vindo já ofuscado do
 * backend para contas trial) com blur + cadeado. Clicar leva ao upgrade.
 *
 * O valor renderizado aqui NUNCA é o dado real: o backend entrega a versão
 * mascarada (começo e final visíveis) e marca o objeto com `dataRestricted`.
 * O blur é apresentação; a garantia de privacidade é server-side.
 */
interface LockedTextProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export function LockedText({ children, className, title }: LockedTextProps) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = '/settings?plan=upgrade';
      }}
      title={title || 'Conteúdo completo disponível no plano Premium — clique para desbloquear'}
      className={cn(
        'group inline-flex max-w-full cursor-pointer select-none items-center gap-1.5 text-left',
        className
      )}
    >
      <span className="pointer-events-none blur-[3.5px] saturate-[0.6] transition group-hover:blur-[2px]">
        {children}
      </span>
      <Lock className="h-3 w-3 shrink-0 text-amber-500 transition group-hover:text-amber-400" aria-hidden />
      <span className="sr-only">Disponível no plano Premium</span>
    </button>
  );
}
