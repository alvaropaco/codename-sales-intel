import React from 'react';
import { MessageCircle, Phone, RefreshCw, ShieldCheck, Target } from 'lucide-react';
import { ContactDecision, DecisionLevel, LeadSectionState, Prospect } from '@/types';
import { ConfidenceBadge, LeadSection, SectionNote } from './shared';

/**
 * LeadIntelligence — painel de decisão de contato (feature 003): substitui as
 * notas genéricas Potencial/Prontidão/Lançamento por métricas que embasam a
 * decisão de entrar em contato ou não — Atingibilidade ("consigo chegar?") e
 * Momento ("agora é hora?") com selo qualitativo primário + score secundário
 * + evidências (FR-017), e recomendação única explicável (FR-004..FR-007).
 * Estados honestos: sem dados (FR-008) e desatualização (FR-016).
 */

const LEVEL_LABEL: Record<DecisionLevel, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  unknown: 'Sem dados',
};

const LEVEL_TONE: Record<DecisionLevel, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-rose-400',
  unknown: 'text-muted-foreground',
};

const VERDICT_META: Record<string, { label: string; tone: string }> = {
  contact_now: {
    label: 'Abordar agora',
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
  contact_lower_priority: {
    label: 'Prioridade menor',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  },
  do_not_prioritize: {
    label: 'Não priorizar',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
  },
};

const REASON_LABEL: Record<string, string> = {
  corporate_email: 'E-mail corporativo próprio disponível',
  generic_email_only: 'Único e-mail é gratuito/terceirizado',
  no_channel: 'Nenhum canal de contato utilizável',
  channels_available: 'Canais de contato utilizáveis',
  good_timing: 'Empresa operando e investindo',
  bad_timing: 'Sinais de empresa parada',
  inactive_company: 'Situação cadastral irregular/baixa',
  high_credit_risk: 'Risco de crédito alto',
  insufficient_data: 'Evidências insuficientes para concluir',
};

const ACTION_LABEL: Record<string, string> = {
  enrich_lead: 'Dispare o enriquecimento para capturar canais e sinais',
  start_email: 'Comece pelo e-mail (canal recomendado)',
  start_whatsapp: 'Inicie a conversa por WhatsApp',
  defer: 'Lead atingível — retome quando o momento melhorar',
};

const FACTOR_LABEL: Record<string, string> = {
  reachability: 'Atingibilidade',
  timing: 'Momento',
  fit: 'Aderência',
  risk: 'Risco (invertido)',
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <span className="font-bold">@</span>,
  whatsapp: <MessageCircle className="h-3 w-3" />,
  phone: <Phone className="h-3 w-3" />,
};

function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

/** Selo de desatualização (FR-016): marca sem ocultar o valor. */
function StaleBadge() {
  return (
    <span
      title="Evidências capturadas há mais de 90 dias — reenriqueça o lead"
      className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
    >
      <RefreshCw className="h-2.5 w-2.5" /> dados podem estar desatualizados
    </span>
  );
}

function MetricCard({
  title,
  metric,
}: {
  title: string;
  metric: ContactDecision['reachability'] | ContactDecision['timing'];
}) {
  const unknown = metric.level === 'unknown';
  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase font-bold text-muted-foreground">{title}</span>
        <span className={`text-sm font-black leading-none ${LEVEL_TONE[metric.level]}`}>
          {LEVEL_LABEL[metric.level]}
        </span>
      </div>
      {unknown ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Sem evidências suficientes — dispare o enriquecimento para avaliar.
        </p>
      ) : (
        <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
          {metric.score != null ? `${metric.score}/100` : ''}
        </p>
      )}
      {metric.stale && <StaleBadge />}
      {metric.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {metric.evidence.slice(0, 4).map((ev) => (
            <li key={ev.key} className="flex items-start justify-between gap-1.5 text-[10.5px] leading-snug">
              <span className="text-foreground/90">
                <span className="font-semibold">{ev.label}</span>
                {ev.detail ? <span className="text-muted-foreground"> · {ev.detail}</span> : null}
              </span>
              {ev.confidence != null && ev.confidence < 0.5 && <ConfidenceBadge confidence={ev.confidence} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LeadIntelligence({
  prospect,
  decision,
  state = 'ready',
  error,
  onRetry,
  onEnrich,
}: {
  prospect: Prospect;
  decision: ContactDecision | null;
  state?: LeadSectionState;
  error?: string;
  onRetry?: () => void;
  onEnrich?: () => void;
}) {
  const recommendation = decision?.recommendation ?? null;
  const verdictMeta = recommendation ? VERDICT_META[recommendation.verdict] : null;
  const riskLevel = prospect.creditRiskLevel;

  return (
    <LeadSection
      icon={<Target className="h-4 w-4" />}
      title="Decisão de contato"
      state={state}
      error={error}
      onRetry={onRetry}
      emptyAction={onEnrich ? { label: 'Disparar enriquecimento', onClick: onEnrich } : undefined}
    >
      {!decision ? (
        <SectionNote>
          Painel de decisão indisponível para este lead ainda — dispare o enriquecimento.
        </SectionNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard title="Atingibilidade" metric={decision.reachability} />
            <MetricCard title="Momento" metric={decision.timing} />
          </div>

          {recommendation && verdictMeta && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black ${verdictMeta.tone}`}
                >
                  {verdictMeta.label}
                </span>
                {recommendation.contactedContext?.contacted && (
                  <span
                    title="Este lead já recebeu contato — considere o histórico antes de reabordar"
                    className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-secondary/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    já contatado
                    {recommendation.contactedContext.channels.length > 0 &&
                      ` · ${recommendation.contactedContext.channels.join(', ')}`}
                    {recommendation.contactedContext.lastContact &&
                      ` · ${formatDate(recommendation.contactedContext.lastContact)}`}
                  </span>
                )}
                {riskLevel && (
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${
                      riskLevel === 'low'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : riskLevel === 'high'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    Risco de crédito:{' '}
                    {prospect.creditRiskScore != null ? `${Math.round(prospect.creditRiskScore)} · ` : ''}
                    {riskLevel === 'low' ? 'baixo' : riskLevel === 'high' ? 'alto' : 'médio'}
                  </span>
                )}
              </div>

              {recommendation.reasons.length > 0 && (
                <ul className="space-y-0.5">
                  {recommendation.reasons.map((reason) => (
                    <li key={reason.code} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" />
                      <span>
                        <span className="font-semibold text-foreground">
                          {REASON_LABEL[reason.code] || reason.code}
                        </span>
                        {reason.detail ? ` — ${reason.detail}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {recommendation.suggestedAction && ACTION_LABEL[recommendation.suggestedAction] && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {ACTION_LABEL[recommendation.suggestedAction]}
                </p>
              )}

              {/* Decomposição dos fatores (FR-007): quanto cada fator pesou */}
              <div className="space-y-1 pt-1">
                {Object.entries(recommendation.factors).map(([key, factor]) => {
                  const width =
                    factor.status === 'unknown' || factor.value == null
                      ? 0
                      : Math.min(100, Math.abs(factor.value));
                  return (
                    <div key={key} className="flex items-center gap-2 text-[10.5px]">
                      <span className="w-24 shrink-0 font-semibold capitalize text-muted-foreground">
                        {FACTOR_LABEL[key] || key}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/50">
                        <div
                          className={`h-full rounded-full ${
                            factor.status === 'used' ? 'bg-indigo-400' : 'bg-secondary'
                          }`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-bold text-muted-foreground">
                        {factor.status === 'unknown' ? '—' : `peso ${factor.weight}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {decision.freshness.stale && (
            <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-amber-400/90">
              <RefreshCw className="h-3 w-3" />
              Evidências capturadas há mais de {decision.freshness.thresholdDays} dias — reenriqueça
              antes de decidir.
            </p>
          )}
        </>
      )}
    </LeadSection>
  );
}
