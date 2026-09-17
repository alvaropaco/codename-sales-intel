import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CompanyGraph, LeadEnrichmentEntity } from '@/types';
import { ConfidenceBadge, LeadSection, SectionNote, extractValue } from './shared';

/**
 * LeadEvidence — evidências e proveniência (FR-006): cada fato com valor,
 * confiança, fonte, entidade e data de captura; além das capabilities do
 * motor v2 executadas por entidade (fatos agregados).
 */
const FACT_PAGE = 24;

export function LeadEvidence({
  graph,
  entities,
}: {
  graph: CompanyGraph | null;
  entities: LeadEnrichmentEntity[];
}) {
  const facts = graph?.facts || [];
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? facts : facts.slice(0, FACT_PAGE);
  const empty = facts.length === 0 && entities.length === 0;

  return (
    <LeadSection
      icon={<ShieldCheck className="h-4 w-4" />}
      title="Evidências e proveniência"
      headerExtra={facts.length > 0 ? `${facts.length} fato(s)` : undefined}
      state={empty ? 'empty' : 'ready'}
      className="xl:col-span-2"
    >
      {entities.length > 0 && (
        <div className="mb-4 space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Capabilities executadas pelo motor v2
          </h4>
          <div className="flex flex-wrap gap-2">
            {entities.map((entity) => (
              <span key={entity.entityKey} className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/40 px-3 py-1 text-[11px]">
                <span className="font-mono font-semibold text-foreground">{entity.entityKey}</span>
                <span className="text-muted-foreground">
                  {entity.capabilities.map((c) => c.capability || '?').join(', ')}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {facts.length > 0 ? (
        <>
          <div className="space-y-2">
            {visible.map((fact, i) => (
              <div key={i} className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-foreground">{fact.fact_key}</span>
                  <ConfidenceBadge confidence={fact.confidence} />
                </div>
                <p className="mt-0.5 break-words text-xs text-foreground/80">{extractValue(fact.value)}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  Fonte: {extractValue(fact.source)} · {fact.entity_type}
                  {fact.observed_at ? ` · capturado em ${new Date(fact.observed_at).toLocaleDateString('pt-BR')}` : ''}
                </p>
              </div>
            ))}
          </div>
          {facts.length > FACT_PAGE && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-[11px] font-semibold text-indigo-400 hover:underline"
            >
              {showAll ? 'Mostrar menos' : `Mostrar todos os ${facts.length} fatos`}
            </button>
          )}
        </>
      ) : (
        <SectionNote>Nenhuma evidência registrada — fatos aparecem conforme os workers concluem as capabilities.</SectionNote>
      )}
    </LeadSection>
  );
}
