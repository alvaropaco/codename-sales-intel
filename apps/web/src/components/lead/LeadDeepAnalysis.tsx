import React from 'react';
import { BrainCircuit, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { DeepAnalysisStatePayload, LeadSectionState } from '@/types';
import { LeadSection, SectionNote } from './shared';

/**
 * LeadDeepAnalysis — seção "Análise profunda" da tela de detalhes do lead
 * (feature 005, FR-013): resumo completo produzido pela IA, impressões,
 * veredito (contatar/não contatar), score final com referência ao score
 * determinístico (FR-008), fatores pró/contra e data da análise. Estados
 * honestos: não analisada, em execução (polling no hook) e falha com
 * reexecução (FR-014). Textos em PT-BR.
 */

const ANALYSIS_POLL_NOTE = 'A IA está analisando este lead — o veredito aparece aqui automaticamente.';

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function FactorList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-xs leading-relaxed ${tone}`}>
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
            <span className="text-foreground/90">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadDeepAnalysis({
  state,
  error,
  payload,
  onRetry,
  onRerun,
  rerunning,
}: {
  state: LeadSectionState;
  error?: string;
  payload: DeepAnalysisStatePayload | null;
  onRetry: () => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const completed = payload?.state === 'completed' ? payload.analysis : null;
  const failed = payload?.state === 'failed';
  const running = payload?.state === 'running';
  const waiting = payload?.state === 'not_started';

  return (
    <LeadSection
      icon={<BrainCircuit className="h-4 w-4" />}
      title="Análise profunda por IA"
      state={state}
      error={error}
      onRetry={onRetry}
      headerExtra={
        completed?.completedAt ? (
          <span title="Data da análise mais recente">analisado em {formatDateTime(completed.completedAt)}</span>
        ) : null
      }
    >
      {completed && (
        <div className="space-y-4">
          {/* Veredito + score final */}
          <div className="flex flex-wrap items-center gap-3">
            {completed.verdict === 'contact' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Faz sentido entrar em contato
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-400">
                <XCircle className="h-3.5 w-3.5" /> Não faz sentido entrar em contato
              </span>
            )}

            <span
              className="inline-flex items-baseline gap-1 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1"
              title="Score final atribuído pela análise de IA"
            >
              <span className="text-lg font-extrabold leading-none text-indigo-300">{completed.finalScore}</span>
              <span className="text-[10px] font-bold text-indigo-400/70">/100 · score IA</span>
            </span>

            {completed.deterministicScore != null && completed.deterministicScore !== completed.finalScore && (
              <span
                className="text-[11px] font-semibold text-muted-foreground"
                title="Score determinístico calculado pelo enriquecimento, mantido como referência (FR-008)"
              >
                (score determinístico: {completed.deterministicScore}/100)
              </span>
            )}

            {completed.override && (
              <span
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-400"
                title="O veredito negativo da IA foi superado manualmente por alguém do time"
              >
                Avançado manualmente contra o veredito da IA
              </span>
            )}
          </div>

          {/* Resumo completo (FR-013) */}
          <div>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Resumo da IA
            </h4>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{completed.summary}</p>
          </div>

          {/* Impressões (FR-013) */}
          {completed.impressions.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Impressões da IA
              </h4>
              <ul className="space-y-1.5">
                {completed.impressions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/90">
                    <BrainCircuit className="mt-0.5 h-3 w-3 shrink-0 text-indigo-400" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fatores pró/contra */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FactorList title="Fatores a favor" items={completed.factorsPro} tone="text-emerald-400" />
            <FactorList title="Fatores contra" items={completed.factorsCon} tone="text-rose-400" />
          </div>

          {/* Contexto da organização ausente (FR-017) */}
          {!completed.orgContextConsidered && (
            <SectionNote>
              Esta análise não considerou o contexto comercial da sua organização — preencha o perfil
              comercial nas configurações para análises mais aderentes.
            </SectionNote>
          )}

          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <span className="text-[10px] font-semibold text-muted-foreground">
              {completed.modelVersion ? `modelo: ${completed.modelVersion}` : 'análise por modelo de IA'}
            </span>
            <button
              onClick={onRerun}
              disabled={rerunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
              title="Executa uma nova análise — o resultado atual é substituído (FR-014)"
            >
              {rerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Reexecutar análise
            </button>
          </div>
        </div>
      )}

      {running && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
          <p className="text-xs font-semibold text-sky-300">{ANALYSIS_POLL_NOTE}</p>
        </div>
      )}

      {waiting && (
        <SectionNote>
          Este lead ainda não foi analisado. Ele é analisado automaticamente ao entrar na coluna
          "Análise profunda" do pipeline.
        </SectionNote>
      )}

      {failed && (
        <div className="space-y-3">
          <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <p className="text-xs text-rose-400">
              A análise falhou{payload?.errorMessage ? `: ${payload.errorMessage}` : '.'}
            </p>
            <button
              onClick={onRerun}
              disabled={rerunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
            >
              {rerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Reexecutar análise
            </button>
          </div>
        </div>
      )}

      {state === 'empty' && !payload && (
        <SectionNote>
          A análise profunda por IA é um recurso do plano Premium — este lead não possui análise.
        </SectionNote>
      )}
    </LeadSection>
  );
}
