import React from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { LeadSectionState } from '@/types';

/**
 * Primitivos compartilhados das seções da tela de detalhe do lead
 * (feature 002). Conteúdo redistribuído do antigo EnrichmentGraphModal.
 */

export const ENTITY_COLORS: Record<string, string> = {
  COMPANY: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  DOMAIN: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  EMAIL: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  PHONE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PERSON: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  SOCIAL_PROFILE: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  TECHNOLOGY: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  URL: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  ADDRESS: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

export function entityTone(type: string): string {
  return ENTITY_COLORS[type] || 'bg-secondary/40 text-muted-foreground border-border';
}

export function extractValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('value' in obj && obj.value != null) return String(obj.value);
    if ('url' in obj && obj.url != null) return String(obj.url);
    if ('domain' in obj && obj.domain != null) return String(obj.domain);
    if ('name' in obj && obj.name != null) return String(obj.name);
    if ('label' in obj && obj.label != null) return String(obj.label);
    return JSON.stringify(obj);
  }
  return String(value);
}

/** Selo de confiança (FR-018): alta ≥85, média ≥65, baixa <65. Sem confiança declarada = neutro → sem selo. */
export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  const tone =
    pct >= 85
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : pct >= 65
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400';
  const label = pct >= 85 ? 'confiança alta' : pct >= 65 ? 'confiança média' : 'confiança baixa';
  return (
    <span title={label} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone}`}>
      {pct}%
    </span>
  );
}

export function YesNoChip({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value == null) return null;
  const ok = value === true;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      {label}
    </span>
  );
}

export function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</span>
      <span className={`block text-sm font-medium text-foreground ${mono ? 'font-mono text-[13px]' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

/** Nota de estado vazio orientativa dentro de uma seção pronta. */
export function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-border/40 bg-secondary/30 p-3 text-xs text-muted-foreground">
      <Inbox className="h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-secondary/40" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export interface LeadSectionProps {
  icon: React.ReactNode;
  title: string;
  /** conteúdo extra no cabeçalho da seção (ex.: contagem) */
  headerExtra?: React.ReactNode;
  /** estado de carregamento/erro/vazio; `ready` renderiza children */
  state?: LeadSectionState;
  error?: string;
  /** chamada ao clicar em "tentar novamente" (estado error) */
  onRetry?: () => void;
  /** chamada da ação sugerida no estado vazio (ex.: disparar enriquecimento) */
  emptyAction?: { label: string; onClick: () => void };
  className?: string;
  children?: React.ReactNode;
}

/**
 * LeadSection — contêiner padrão de seção com estados independentes de
 * carregamento, erro (com nova tentativa) e vazio (FR-015): a falha de uma
 * seção nunca impede a renderização das demais.
 */
export function LeadSection({
  icon,
  title,
  headerExtra,
  state = 'ready',
  error,
  onRetry,
  emptyAction,
  className = '',
  children,
}: LeadSectionProps) {
  return (
    <section className={`flex flex-col rounded-2xl border border-border/80 bg-card/60 p-5 ${className}`}>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="text-indigo-400">{icon}</span>
        {title}
        {headerExtra != null && <span className="ml-auto text-[11px] font-semibold text-muted-foreground">{headerExtra}</span>}
      </h3>
      {state === 'loading' ? (
        <SkeletonRows />
      ) : state === 'error' ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="flex items-center gap-2 text-xs text-rose-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error || 'Não foi possível carregar esta seção.'}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary"
            >
              <RefreshCw className="h-3 w-3" /> Tentar novamente
            </button>
          )}
        </div>
      ) : state === 'empty' ? (
        <div className="flex flex-col items-start gap-2">
          <SectionNote>
            Nenhum dado capturado ainda para esta seção{emptyAction ? ' — dispare um enriquecimento para preencher o perfil.' : '.'}
          </SectionNote>
          {emptyAction && (
            <button
              onClick={emptyAction.onClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-2.5 py-1 text-[11px] font-semibold text-indigo-400 transition hover:bg-indigo-500/25"
            >
              <RefreshCw className="h-3 w-3" /> {emptyAction.label}
            </button>
          )}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
