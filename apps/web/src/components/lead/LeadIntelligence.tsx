import React from 'react';
import { Target, ShieldCheck, Gauge } from 'lucide-react';
import { Prospect } from '@/types';
import { LeadSection, SectionNote } from './shared';

/**
 * LeadIntelligence — inteligência de enriquecimento: potencial, prontidão e
 * lançamento (x/100), risco de crédito e score de oportunidade com
 * decomposição de sinais (points fortes / indícios jurídicos).
 */

function scoreLabel(value: number | null | undefined): string {
  return value != null ? `${Math.round(value)}` : '—';
}

const BREAKDOWN_LABELS: Record<string, string> = {
  identificador: 'CNPJ', localizacao: 'Localização', setor: 'Setor',
  contatos: 'Contatos', digital: 'Digital', porte: 'Porte', momentum: 'Impulso',
};

const RISK_TONE: Record<string, string> = {
  low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

export function LeadIntelligence({
  prospect,
  state = 'ready',
}: {
  prospect: Prospect;
  state?: 'ready' | 'empty';
}) {
  const summary = prospect.enrichmentSummary;
  const hasScores =
    summary &&
    [summary.commercial_potential, summary.operational_readiness, summary.launch_velocity].some(
      (v) => v != null
    );
  const breakdown = summary?.score_breakdown as Record<string, number> | undefined;
  const riskLevel = prospect.creditRiskLevel;

  return (
    <LeadSection
      icon={<Target className="h-4 w-4" />}
      title="Inteligência de enriquecimento"
      state={hasScores ? 'ready' : state}
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-center">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Potencial</span>
          <p className="text-lg font-black text-indigo-400">{scoreLabel(summary?.commercial_potential)}<span className="text-[10px] text-muted-foreground">/100</span></p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Prontidão</span>
          <p className="text-lg font-black text-emerald-400">{scoreLabel(summary?.operational_readiness)}<span className="text-[10px] text-muted-foreground">/100</span></p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Lançamento</span>
          <p className="text-lg font-black text-amber-400">{scoreLabel(summary?.launch_velocity)}<span className="text-[10px] text-muted-foreground">/100</span></p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/40 px-2.5 py-1 font-semibold text-foreground">
          <Gauge className="h-3.5 w-3.5 text-indigo-400" /> Oportunidade {Math.round(prospect.opportunityScore)}/100
        </span>
        {riskLevel && (
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${RISK_TONE[prospect.creditRiskLevel as string] || 'border-border bg-secondary/40 text-muted-foreground'}`}>
            Risco de crédito: {prospect.creditRiskScore != null ? `${Math.round(prospect.creditRiskScore)} · ` : ''}
            {riskLevel === 'low' ? 'baixo' : riskLevel === 'high' ? 'alto' : 'médio'}
          </span>
        )}
      </div>

      {breakdown && Object.keys(breakdown).length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {Object.entries(breakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([key, value]) => {
              const max = 30;
              const width = Math.min(100, (Math.abs(value) / max) * 100);
              const negative = value < 0;
              return (
                <div key={key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 shrink-0 font-semibold capitalize text-muted-foreground">
                    {BREAKDOWN_LABELS[key] || key.replace(/_/g, ' ')}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/50">
                    <div
                      className={`h-full rounded-full ${negative ? 'bg-rose-400' : 'bg-indigo-400'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className={`w-8 text-right font-bold ${negative ? 'text-rose-400' : 'text-foreground'}`}>
                    {value > 0 ? '+' : ''}{Math.round(value)}
                  </span>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="mt-3">
          <SectionNote>
            Decomposição de sinais aparece após a conclusão do enriquecimento.
          </SectionNote>
        </div>
      )}

      {!hasScores && prospect.enrichmentStatus === 'pending' && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 animate-pulse text-indigo-400" />
          Enriquecimento em andamento — os scores aparecem assim que concluído.
        </p>
      )}
    </LeadSection>
  );
}
