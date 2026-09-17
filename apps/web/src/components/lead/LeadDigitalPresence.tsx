import React from 'react';
import { Globe, Cpu, Share2 } from 'lucide-react';
import { CompanyGraph, Prospect } from '@/types';
import { ConfidenceBadge, LeadSection, SectionNote, YesNoChip, extractValue } from './shared';

interface DomainInfoView {
  domain?: string;
  www?: string;
  http?: boolean;
  https?: boolean;
  dns_a?: boolean;
  tls_valid?: boolean;
  valid?: boolean;
  title?: string | null;
  rdap_registered?: boolean;
}

function domainInfo(value: unknown): DomainInfoView {
  if (!value || typeof value !== 'object') return {};
  return value as DomainInfoView;
}

/**
 * LeadDigitalPresence — presença digital: domínio + sinais de protocolo
 * (HTTP/HTTPS/DNS/TLS/RDAP), tecnologias DETECTADAS como lista nomeada com
 * confiança (nunca apenas contador — FR-005) e perfis sociais encontrados.
 */
export function LeadDigitalPresence({
  prospect,
  graph,
}: {
  prospect: Prospect;
  graph: CompanyGraph | null;
}) {
  const profile = graph?.profile;
  const domain = domainInfo(profile?.domain ?? (prospect.domain ? { domain: prospect.domain } : null));
  const socialEntries = Object.entries(profile?.social || {});
  const technologies = profile?.technologies || [];

  return (
    <LeadSection
      icon={<Globe className="h-4 w-4" />}
      title="Presença digital"
    >
      <div className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-3">
        <span className="block text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Domínio</span>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-mono text-sm text-foreground">{domain.domain || '—'}</span>
          {domain.domain && (
            <a
              href={`https://${domain.domain}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-indigo-400 hover:underline"
            >
              Visitar ↗
            </a>
          )}
        </div>
        {domain.title && <p className="mt-1 truncate text-xs text-muted-foreground">Título: {domain.title}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <YesNoChip label="HTTP" value={domain.http} />
          <YesNoChip label="HTTPS" value={domain.https} />
          <YesNoChip label="DNS A" value={domain.dns_a} />
          <YesNoChip label="TLS válido" value={domain.tls_valid} />
          <YesNoChip label="RDAP" value={domain.rdap_registered} />
          <YesNoChip label="Site válido" value={domain.valid} />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" /> Tecnologias detectadas
        </h4>
        {technologies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {technologies.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs">
                <span className="font-semibold text-foreground">{t.name || '—'}</span>
                {t.category && <span className="text-muted-foreground">· {t.category}</span>}
                <ConfidenceBadge confidence={t.confidence} />
              </span>
            ))}
          </div>
        ) : (
          <SectionNote>Nenhuma tecnologia detectada{graph ? '.' : ' — o scan detalhado chega com o enriquecimento profundo.'}</SectionNote>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" /> Redes sociais
        </h4>
        {socialEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {socialEntries.map(([platform, info]) => (
              <span key={platform} className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs">
                <span className="font-semibold capitalize text-foreground">{platform}</span>
                {info?.url && (
                  <a href={info.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                    {info.url.replace(/^https?:\/\//, '')}
                  </a>
                )}
                <ConfidenceBadge confidence={info?.confidence} />
              </span>
            ))}
          </div>
        ) : (
          <SectionNote>Nenhum perfil social identificado ainda.</SectionNote>
        )}
      </div>
    </LeadSection>
  );
}
