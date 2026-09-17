import React from 'react';
import { Users } from 'lucide-react';
import { LockedText } from '@/components/ui/locked-text';
import { CompanyGraph, Prospect } from '@/types';
import { ConfidenceBadge, LeadSection, SectionNote } from './shared';

/**
 * LeadPeople — quadro societário e pessoas associadas: grafo de enriquecimento
 * (profile.people) + sócios do cadastro (cnpjPartners), deduplicados por nome.
 * Nomes respeitam o masking de trial (LockedText — FR-013).
 */
export function LeadPeople({ prospect, graph }: { prospect: Prospect; graph: CompanyGraph | null }) {
  const restricted = Boolean(prospect.dataRestricted || graph?.dataRestricted);
  const people = graph?.profile?.people || [];
  const partners = prospect.cnpjPartners || [];

  const seen = new Set(people.map((p) => (p.label || '').trim().toLowerCase()));
  const extraPartners = partners.filter(
    (p) => p.name && !seen.has(p.name.trim().toLowerCase())
  );

  const empty = people.length === 0 && extraPartners.length === 0;

  return (
    <LeadSection
      icon={<Users className="h-4 w-4" />}
      title="Quadro societário e pessoas"
      headerExtra={empty ? undefined : `${people.length + extraPartners.length} pessoa(s)`}
      state={empty ? 'empty' : 'ready'}
    >
      <div className="space-y-2">
        {people.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/15 text-xs font-bold text-violet-400">
                {p.label?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                {restricted ? (
                  <LockedText className="truncate text-sm font-medium text-foreground">{p.label}</LockedText>
                ) : (
                  <p className="truncate text-sm font-medium text-foreground">{p.label}</p>
                )}
                <p className="text-[11px] capitalize text-muted-foreground">{p.role || '—'}</p>
              </div>
            </div>
            <ConfidenceBadge confidence={p.confidence} />
          </div>
        ))}
        {extraPartners.map((p, i) => (
          <div key={`partner-${i}`} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/15 text-xs font-bold text-violet-400">
                {(p.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                {restricted ? (
                  <LockedText className="truncate text-sm font-medium text-foreground">
                    {p.name || 'Sócio'}
                    {p.qualification ? ` · ${p.qualification}` : ''}
                  </LockedText>
                ) : (
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.name || 'Sócio'}
                    {p.qualification ? <span className="text-muted-foreground"> · {p.qualification}</span> : null}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!empty && restricted && (
        <div className="mt-3">
          <SectionNote>Alguns nomes aparecem borrados: conteúdo completo disponível no plano Premium.</SectionNote>
        </div>
      )}
    </LeadSection>
  );
}
