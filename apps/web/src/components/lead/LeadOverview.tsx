import React from 'react';
import { Building2, Calendar, MapPin, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Prospect } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';
import { LeadSection, Field } from './shared';

/**
 * LeadOverview — visão geral do lead: identidade, status comercial, score de
 * oportunidade com pontos fortes e selo de restrição de plano (trial).
 */
export function LeadOverview({ prospect }: { prospect: Prospect }) {
  const restricted = Boolean(prospect.dataRestricted);
  const breakdown = prospect.enrichmentSummary?.score_breakdown as Record<string, number> | undefined;
  let strengths: string[] = [];
  let riskSignals = false;
  if (breakdown) {
    const labels: Record<string, string> = {
      identificador: 'CNPJ', localizacao: 'Localização', setor: 'Setor',
      contatos: 'Contatos', digital: 'Digital', porte: 'Porte', momentum: 'Impulso',
    };
    strengths = Object.entries(breakdown)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => labels[k] || k);
    riskSignals = breakdown.momentum < 0;
  }

  return (
    <LeadSection
      icon={<Building2 className="h-4 w-4" />}
      title="Visão geral"
      headerExtra={restricted ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
          <ShieldAlert className="h-3 w-3" /> Trial — dados restritos
        </span>
      ) : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {prospect.logoUrl ? (
            <img
              src={prospect.logoUrl}
              alt={prospect.companyName}
              className="h-12 w-12 rounded-xl border border-indigo-500/20 bg-white object-contain p-1"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 font-bold text-indigo-400">
              <Building2 className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-foreground">{prospect.companyName}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {prospect.cnpj ? formatCNPJ(prospect.cnpj) : 'CNPJ pendente'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Potencial comercial</span>
          <p className="text-2xl font-black text-indigo-400">{Math.round(prospect.opportunityScore)}/100</p>
        </div>
      </div>

      {(strengths.length > 0 || riskSignals) && (
        <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
          {strengths.length > 0 && <span>pontos fortes: {strengths.join(' · ')}</span>}
          {riskSignals && (
            <span className={strengths.length ? 'text-amber-500 dark:text-amber-300' : ''}>
              {strengths.length ? ' · ' : ''}indícios jurídicos
            </span>
          )}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Status" value={<Badge variant={prospect.status === 'qualified' ? 'qualified' : 'prospect'}>{prospect.status.toUpperCase()}</Badge>} />
        <Field label="Nome fantasia" value={prospect.tradeName || '—'} />
        <Field
          label="Localização"
          value={
            (prospect.city || prospect.state) ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {[prospect.city, prospect.state].filter(Boolean).join(' — ')}
              </span>
            ) : '—'
          }
        />
        <Field
          label="Lead salvo em"
          value={
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {new Date(prospect.createdAt).toLocaleDateString('pt-BR')}
            </span>
          }
        />
        <Field label="Faturamento est." value={prospect.revenueEstimate ? formatCurrency(prospect.revenueEstimate) : '—'} />
        <Field
          label="Canais contatados"
          value={prospect.contactedChannels?.length ? prospect.contactedChannels.join(', ') : 'nenhum ainda'}
        />
      </div>
    </LeadSection>
  );
}
