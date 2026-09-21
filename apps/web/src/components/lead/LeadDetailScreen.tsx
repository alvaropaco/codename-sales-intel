import React, { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  RefreshCw,
  Send,
  Loader2,
  SearchX,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActiveTab, ProspectStatus } from '@/types';
import { enrichProspect, updateProspect } from '@/services/api';
import { formatCNPJ } from '@/lib/utils';
import { useSeo } from '@/hooks/useSeo';
import { useLeadDetail } from './useLeadDetail';
import { LeadOverview } from './LeadOverview';
import { LeadIntelligence } from './LeadIntelligence';
import { LeadDeepAnalysis } from './LeadDeepAnalysis';
import { LeadFirmographics } from './LeadFirmographics';
import { LeadDigitalPresence } from './LeadDigitalPresence';
import { LeadContacts } from './LeadContacts';
import { LeadAddresses } from './LeadAddresses';
import { LeadPeople } from './LeadPeople';
import { LeadFinancials } from './LeadFinancials';
import { LeadRelationshipGraph } from './LeadRelationshipGraph';
import { LeadLocationMap } from './LeadLocationMap';
import { LeadEvidence } from './LeadEvidence';
import { LeadDiscoveryPanel } from '../discovery/LeadDiscoveryPanel';

/**
 * LeadDetailScreen — tela dedicada de detalhes completos do lead (FR-001),
 * destino único do clique em lead: substitui o fluxo painel lateral + modal
 * (FR-009). Seções independentes alimentadas por useLeadDetail.
 */

// Pipeline da feature 005: sem "Novas oportunidades" (lead removido); novos
// estágios Análise profunda e Descartados. Valores legados permanecem listados
// apenas para leads antigos que ainda os carregam.
const PIPELINE_STATUSES: ProspectStatus[] = [
  'prospect',
  'deep_analysis',
  'qualified',
  'closed',
  'discarded',
  'contacted',
  'proposal',
];

const STATUS_LABEL: Record<string, string> = {
  prospect: 'Em Qualificação',
  deep_analysis: 'Análise profunda',
  qualified: 'Prontas para contato',
  closed: 'Cliente ganho',
  discarded: 'Descartado',
  contacted: 'Contatado (legado)',
  proposal: 'Proposta (legado)',
};

export function LeadDetailScreen({
  leadId,
  onBack,
  onNavigateToTab,
}: {
  leadId: string;
  onBack: () => void;
  onNavigateToTab: (tab: ActiveTab) => void;
}) {
  const {
    prospect,
    notFound,
    entities,
    graph,
    graphAvailable,
    addresses,
    decision,
    deepAnalysis,
    states,
    enrichmentActive,
    retry,
    reload,
    rerunAnalysis,
  } = useLeadDetail(leadId);

  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [rerunningAnalysis, setRerunningAnalysis] = useState(false);

  const handleRerunAnalysis = async () => {
    setRerunningAnalysis(true);
    try {
      await rerunAnalysis();
    } catch (err) {
      // O hook recarrega a seção; erro de reexecução é visível nela.
      console.error('Erro ao reexecutar análise profunda:', err);
    } finally {
      setRerunningAnalysis(false);
    }
  };

  // SEO próprio da tela (enquanto /leads/:id está ativa, o App fica em silêncio)
  useSeo({
    title: prospect ? `${prospect.companyName} — Perfil do lead` : 'Perfil do lead',
    description: prospect
      ? `Perfil completo do lead ${prospect.companyName}: inteligência de enriquecimento, contatos, endereços, grafo de relacionamentos e localização.`
      : 'Perfil completo do lead enriquecido: inteligência, contatos, endereços, grafo e localização.',
    canonical: `/leads/${leadId}`,
  });

  const handleEnrich = async () => {
    setEnriching(true);
    setEnrichError(null);
    try {
      await enrichProspect(leadId);
      reload();
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Erro ao disparar enriquecimento');
    } finally {
      setEnriching(false);
    }
  };

  const handleStatusChange = async (status: ProspectStatus) => {
    if (!prospect || status === prospect.status) return;
    setSavingStatus(true);
    try {
      await updateProspect(leadId, { status });
      reload();
    } finally {
      setSavingStatus(false);
    }
  };

  // ── Estados de tela cheia ─────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <SearchX className="h-10 w-10 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-bold text-foreground">Lead não encontrado</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Este lead não existe ou pertence a outra organização.
          </p>
        </div>
        <Button onClick={onBack} variant="outline" size="sm" className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar para a lista
        </Button>
      </div>
    );
  }

  if (states.prospect.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        <p className="text-sm">Carregando perfil do lead…</p>
      </div>
    );
  }

  if (states.prospect.status === 'error' || !prospect) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-sm text-rose-400">{states.prospect.error || 'Não foi possível carregar o lead.'}</p>
        <Button onClick={() => retry('prospect')} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const restricted = Boolean(prospect.dataRestricted || graph?.dataRestricted);

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="rounded-2xl border border-border/80 bg-card/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={onBack}
              title="Voltar para a lista"
              className="rounded-xl border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
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
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 font-bold text-indigo-400">
                <Building2 className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-bold leading-tight text-foreground">{prospect.companyName}</h1>
                <Badge variant={prospect.status === 'qualified' ? 'qualified' : 'prospect'}>
                  {STATUS_LABEL[prospect.status] || prospect.status}
                </Badge>
                {restricted && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                    Trial — dados restritos
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{prospect.cnpj ? formatCNPJ(prospect.cnpj) : 'CNPJ pendente'}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Fonte: {prospect.enrichmentSource || '—'} · v{prospect.enrichmentVersion ?? 1}
                  {prospect.enrichedAt ? ` · ${new Date(prospect.enrichedAt).toLocaleDateString('pt-BR')}` : ''}
                </span>
                {enrichmentActive && (
                  <span className="inline-flex items-center gap-1 font-semibold text-indigo-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> enriquecimento em andamento
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Ações rápidas (FR-016): status in-place, reenriquecer, outreach */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              Estágio
              <select
                value={prospect.status}
                disabled={savingStatus}
                onChange={(e) => handleStatusChange(e.target.value as ProspectStatus)}
                className="rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-xs font-semibold text-foreground outline-none transition focus:border-indigo-500/50"
              >
                {PIPELINE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status] || status}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={handleEnrich} disabled={enriching} variant="outline" size="sm" className="gap-1.5 text-xs">
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {enriching ? 'Disparando…' : 'Reenriquecer'}
            </Button>
            <Button onClick={() => onNavigateToTab('outreach')} variant="outline" size="sm" className="gap-1.5 text-xs">
              <Send className="h-3.5 w-3.5" /> Outreach
            </Button>
          </div>
        </div>
        {enrichError && <p className="mt-3 text-xs font-semibold text-rose-400">{enrichError}</p>}
      </header>

      {/* Grid de seções — cada uma com estado independente (FR-015) */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <LeadOverview prospect={prospect} decision={decision} />
        <LeadDiscoveryPanel prospectId={prospect.id} />
        <LeadIntelligence
          prospect={prospect}
          decision={decision}
          state={states.decision.status}
          error={states.decision.error}
          onRetry={() => retry('decision')}
          onEnrich={handleEnrich}
        />
        <LeadDeepAnalysis
          state={states.deepAnalysis.status}
          error={states.deepAnalysis.error}
          payload={deepAnalysis}
          onRetry={() => retry('deepAnalysis')}
          onRerun={handleRerunAnalysis}
          rerunning={rerunningAnalysis}
        />
        <LeadFirmographics prospect={prospect} graph={graph} />
        <LeadDigitalPresence prospect={prospect} graph={graph} />
        <LeadContacts prospect={prospect} graph={graph} onEnrich={handleEnrich} />
        <LeadPeople prospect={prospect} graph={graph} />
        <LeadFinancials prospect={prospect} graph={graph} />
        <LeadRelationshipGraph
          graph={graph}
          graphAvailable={graphAvailable}
          state={states.graph.status}
          error={states.graph.error}
          hasCnpj={Boolean(prospect.cnpj)}
          onRetry={() => retry('graph')}
          onEnrich={handleEnrich}
        />
        <LeadLocationMap addresses={addresses?.addresses || []} />
        <LeadAddresses addresses={addresses?.addresses || []} restricted={restricted} />
        <LeadEvidence graph={graph} entities={entities} />
      </div>
    </div>
  );
}
