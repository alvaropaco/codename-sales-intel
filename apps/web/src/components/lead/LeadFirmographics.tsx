import React from 'react';
import { Landmark } from 'lucide-react';
import { LockedText } from '@/components/ui/locked-text';
import { CompanyGraph, Prospect } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Field, LeadSection, SectionNote, extractValue } from './shared';

/**
 * LeadFirmographics — firmografia completa do lead: cadastro local (prospect)
 * complementado pela firmografia do grafo de enriquecimento quando disponível
 * (porte, capital social, CNAE). Campos sensíveis respeitam o masking de trial.
 */
export function LeadFirmographics({
  prospect,
  graph,
}: {
  prospect: Prospect;
  graph: CompanyGraph | null;
}) {
  const restricted = Boolean(prospect.dataRestricted);
  const fg = (graph?.profile?.firmographics || {}) as Record<string, unknown>;
  const graphReady = Boolean(graph?.profile?.firmographics);

  const openedAt = prospect.cnpjOpenedAt;
  const legalNature = prospect.cnpjLegalNature;

  return (
    <LeadSection
      icon={<Landmark className="h-4 w-4" />}
      title="Firmografia"
      state={graphReady ? 'ready' : 'ready'}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Segmento" value={prospect.industry || extractValue(fg.main_cnae) || 'A confirmar'} />
        <Field label="Porte" value={extractValue(fg.porte) || (prospect.employees != null ? `${prospect.employees} colaboradores` : 'A confirmar')} />
        <Field
          label="Faturamento estimado"
          value={prospect.revenueEstimate ? formatCurrency(prospect.revenueEstimate) : extractValue(fg.capital_social) || 'A confirmar'}
        />
        <Field
          label="Natureza jurídica"
          value={
            legalNature ? (
              restricted ? <LockedText>{legalNature}</LockedText> : legalNature
            ) : extractValue(fg.legal_nature) !== '—' ? (
              restricted ? <LockedText>{String(fg.legal_nature)}</LockedText> : extractValue(fg.legal_nature)
            ) : '—'
          }
        />
        <Field
          label="Abertura"
          value={
            openedAt ? (
              restricted ? <LockedText>{new Date(openedAt).toLocaleDateString('pt-BR')}</LockedText> : new Date(openedAt).toLocaleDateString('pt-BR')
            ) : extractValue(fg.opening_date) !== '—' ? (
              extractValue(fg.opening_date)
            ) : '—'
          }
        />
        <Field label="CNAE principal" value={extractValue(fg.main_cnae)} />
      </div>
      {!graphReady && (
        <div className="mt-3">
          <SectionNote>Dados do grafo de enriquecimento (porte, capital social, CNAE) aparecem quando o enriquecimento profundo concluir.</SectionNote>
        </div>
      )}
    </LeadSection>
  );
}
