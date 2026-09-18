/**
 * AvaSummary — resumo completo do que foi configurado (FR-013), com ajuste
 * item a item (FR-014) e confirmação para a transição ao dashboard (FR-015).
 */

import { Pencil } from 'lucide-react';
import { SUMMARY_LABELS } from '@/lib/avaScript';
import { cn } from '@/lib/utils';
import type {
  Answer,
  BusinessAsset,
  BusinessContext,
  QuestionId,
} from '@/types/onboarding';

interface AvaSummaryProps {
  answers: Partial<Record<QuestionId, Answer>>;
  assets: BusinessAsset[];
  businessContext: BusinessContext | null;
  onRevise: (questionId: QuestionId) => void;
  onConfirm: () => void;
}

function formatValue(
  questionId: QuestionId,
  answer: Answer | undefined,
  assets: BusinessAsset[]
): string {
  if (!answer || answer.via === 'skipped') return 'Não informado';
  const value = answer.value;
  switch (questionId) {
    case 'crm':
      return value === '__none__' ? 'Ainda não usa' : String(value);
    case 'catalogo':
      return value === 'nao' ? 'Não tem catálogo online' : String(value);
    case 'materiais': {
      const documents = assets.filter((a) => a.type === 'document');
      return documents.length
        ? `${documents.length} ${documents.length === 1 ? 'arquivo anexado' : 'arquivos anexados'}`
        : 'Não informado';
    }
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export function AvaSummary({ answers, assets, businessContext, onRevise, onConfirm }: AvaSummaryProps) {
  return (
    <div className="w-full rounded-2xl border border-indigo-400/30 bg-gradient-to-b from-indigo-500/10 to-white/[0.02] p-5 shadow-lg shadow-indigo-500/10">
      <div className="mb-4 flex items-center gap-2">
        <Sparkle />
        <p className="text-sm font-black uppercase tracking-[0.14em] text-indigo-200">
          Resumo da sua conta
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {(Object.keys(SUMMARY_LABELS) as QuestionId[]).map((questionId) => {
          const value = formatValue(questionId, answers[questionId], assets);
          const empty = value === 'Não informado';
          return (
            <div
              key={questionId}
              className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5"
            >
              <div className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {SUMMARY_LABELS[questionId]}
                </dt>
                <dd
                  className={cn(
                    'truncate text-sm font-semibold',
                    empty ? 'text-slate-500' : 'text-slate-100'
                  )}
                  title={value}
                >
                  {value}
                </dd>
              </div>
              <button
                type="button"
                onClick={() => onRevise(questionId)}
                aria-label={`Ajustar ${SUMMARY_LABELS[questionId]}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-indigo-300"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </dl>

      {businessContext && businessContext.products.length > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
            Contexto de negócio absorvido
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {businessContext.products.length}{' '}
            {businessContext.products.length === 1 ? 'produto' : 'produtos'} identificados
            {businessContext.valueProposition ? ` · ${businessContext.valueProposition}` : ''}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onConfirm}
        className="mt-5 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400"
      >
        Tudo certo — concluir ✨
      </button>
    </div>
  );
}

function Sparkle() {
  return <span className="inline-block h-2 w-2 rounded-full bg-indigo-300" />;
}
