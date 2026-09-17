import React from 'react';
import { Wallet } from 'lucide-react';
import { CompanyGraph, Prospect } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Field, LeadSection, extractValue } from './shared';

/**
 * LeadFinancials — indicadores financeiros capturados pelo enriquecimento
 * (profile.financial_indicators) + faturamento estimado do cadastro.
 */
export function LeadFinancials({
  prospect,
  graph,
}: {
  prospect: Prospect;
  graph: CompanyGraph | null;
}) {
  const indicators = Object.entries(graph?.profile?.financial_indicators || {});
  const empty = indicators.length === 0 && prospect.revenueEstimate == null;

  return (
    <LeadSection
      icon={<Wallet className="h-4 w-4" />}
      title="Indicadores financeiros"
      state={empty ? 'empty' : 'ready'}
    >
      {prospect.revenueEstimate != null && (
        <div className="mb-3 grid grid-cols-2 gap-x-5 gap-y-3">
          <Field label="Faturamento estimado (cadastro)" value={formatCurrency(prospect.revenueEstimate)} />
        </div>
      )}
      {indicators.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {indicators.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
              <span className="text-xs font-semibold capitalize text-muted-foreground">{key.replace(/_/g, ' ')}</span>
              <span className="text-sm font-bold text-foreground">{extractValue(value)}</span>
            </div>
          ))}
        </div>
      ) : (
        prospect.revenueEstimate == null && (
          <span className="text-sm text-muted-foreground">Nenhum indicador financeiro capturado ainda.</span>
        )
      )}
    </LeadSection>
  );
}
