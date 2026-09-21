import React, { useEffect, useState } from 'react';
import { Building2, Briefcase, Gavel, Landmark, Globe, Sparkles, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CompanyIntelligenceProfile } from '@/types';
import { fetchCompanyIntelligence } from '@/services/api';

/**
 * CompanyIntelligence (T051) — visão agregada por domínio do perfil da
 * empresa: corporativo, financeiro, jurídico, ownership e digital. Cada seção
 * é independente: ausência de uma não esconde as demais (FR-015).
 */

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/80 bg-card/40 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export function CompanyIntelligence({ entityId }: { entityId: string }) {
  const [profile, setProfile] = useState<CompanyIntelligenceProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchCompanyIntelligence(entityId)
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar inteligência');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando inteligência da empresa…
      </div>
    );
  }
  if (error || !profile) {
    return <p className="p-3 text-xs text-rose-400">{error || 'Perfil de inteligência não encontrado.'}</p>;
  }

  const { corporate, financial, legal, ownership, signals } = profile;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-foreground">{corporate.identity.legalName || profile.company.displayName}</span>
        {corporate.identity.cnpj && <Badge variant="secondary" className="font-mono text-[10px]">{corporate.identity.cnpj}</Badge>}
        <Badge variant="secondary" className="font-mono text-[10px]">conf {profile.company.confidence.toFixed(2)}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {profile.evidenceSummary.total} evidência(s)
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Section icon={<Building2 className="h-3 w-3" />} title="Corporativo">
          <Row label="Razão social" value={corporate.identity.legalName} />
          <Row label="Nome fantasia" value={corporate.identity.tradeName} />
          <Row label="Situação" value={corporate.identity.status} />
          <Row label="Abertura" value={corporate.identity.openingDate} />
          <Row label="Porte" value={corporate.classification.companySize} />
          <Row label="Indústria" value={corporate.classification.industry} />
          <Row label="Cidade/UF" value={corporate.address ? [corporate.address.city, corporate.address.state].filter(Boolean).join('/') : null} />
        </Section>

        <Section icon={<Landmark className="h-3 w-3" />} title="Financeiro">
          <Row label="Capital social" value={financial.capitalSocial?.formatted} />
          <Row label="Rodadas" value={financial.funding.length || null} />
          {financial.funding.slice(0, 3).map((round, i) => (
            <Row
              key={i}
              label={round.stage || round.name || 'Rodada'}
              value={[round.amount != null ? `${round.currency} ${round.amount.toLocaleString('pt-BR')}` : null, round.announcedAt].filter(Boolean).join(' · ')}
            />
          ))}
          {financial.hasEstimatedData && (
            <p className="mt-1 text-[10px] italic text-amber-400">Contém dados estimados — não auditados.</p>
          )}
        </Section>

        <Section icon={<Gavel className="h-3 w-3" />} title="Jurídico">
          <Row label="Processos públicos" value={legal.totalCases || null} />
          <Row label="Tribunais" value={legal.courts.length ? legal.courts.join(', ') : null} />
          {legal.cases.slice(0, 3).map((c) => (
            <Row key={c.caseNumber} label={c.caseNumber} value={[c.court, c.status].filter(Boolean).join(' · ')} />
          ))}
        </Section>

        <Section icon={<Briefcase className="h-3 w-3" />} title="Quadro societário">
          {ownership.partners.slice(0, 5).map((p, i) => (
            <Row key={i} label={p.name || 'Sócio'} value={p.ownershipPct != null ? `${p.ownershipPct}%` : 'sócio'} />
          ))}
          {ownership.directors.slice(0, 3).map((p, i) => (
            <Row key={i} label={p.name || 'Diretor'} value={p.role || 'diretor'} />
          ))}
          {ownership.partners.length + ownership.directors.length === 0 && (
            <p className="text-xs text-muted-foreground">Sem vínculos públicos conhecidos.</p>
          )}
        </Section>
      </div>

      {signals.length > 0 && (
        <Section icon={<Sparkles className="h-3 w-3" />} title="Sinais de inteligência">
          <div className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <span key={signal.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
                {signal.type} · conf {signal.confidence.toFixed(2)}
              </span>
            ))}
          </div>
        </Section>
      )}

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Globe className="h-3 w-3" /> Toda afirmação tem evidência com fonte e data no motor de discovery.
      </p>
    </div>
  );
}
