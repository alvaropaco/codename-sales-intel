import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CompanyGraph,
  ContactDecision,
  LeadAddressesResponse,
  LeadEnrichmentEntity,
  LeadSectionState,
  Prospect,
} from '@/types';
import {
  fetchCompanyGraph,
  fetchContactDecision,
  fetchLeadAddresses,
  fetchProspect,
  fetchProspectEnrichmentEntities,
} from '@/services/api';

/**
 * useLeadDetail — carrega em paralelo as fontes da tela de detalhe completo
 * (prospect, fatos v2, grafo de enriquecimento, endereços geocodificados e
 * painel de decisão de contato da 003), com estado INDEPENDENTE por seção
 * (FR-015): a falha de uma não bloqueia as demais. Deep link direto (nova aba)
 * resolve o prospect por id via GET /api/prospects/:id (404 → notFound, nunca
 * vaza existência cross-tenant). Enriquecimento em andamento é reconsultado
 * com polling leve (FR-017).
 */

export type LeadDetailSection = 'prospect' | 'entities' | 'graph' | 'addresses' | 'decision';

export interface SectionState {
  status: LeadSectionState;
  error?: string;
}

const ENRICHMENT_POLL_MS = 8000;
/** status em que o enriquecimento ainda pode produzir fatos novos */
const ENRICHMENT_ACTIVE = new Set(['pending', 'queued', 'running', 'processing', 'in_progress']);

interface Slice {
  state: SectionState;
  prospect: Prospect | null;
  notFound: boolean;
  entities: LeadEnrichmentEntity[];
  graph: CompanyGraph | null;
  graphAvailable: boolean;
  addresses: LeadAddressesResponse | null;
  decision: ContactDecision | null;
}

const INITIAL: Slice = {
  state: { status: 'loading' },
  prospect: null,
  notFound: false,
  entities: [],
  graph: null,
  graphAvailable: true,
  addresses: null,
  decision: null,
};

export function useLeadDetail(leadId: string) {
  const [prospectState, setProspectState] = useState<SectionState>({ status: 'loading' });
  const [entitiesState, setEntitiesState] = useState<SectionState>({ status: 'loading' });
  const [graphState, setGraphState] = useState<SectionState>({ status: 'loading' });
  const [addressesState, setAddressesState] = useState<SectionState>({ status: 'loading' });
  const [decisionState, setDecisionState] = useState<SectionState>({ status: 'loading' });

  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [entities, setEntities] = useState<LeadEnrichmentEntity[]>([]);
  const [graph, setGraph] = useState<CompanyGraph | null>(null);
  const [graphAvailable, setGraphAvailable] = useState(true);
  const [addresses, setAddresses] = useState<LeadAddressesResponse | null>(null);
  const [decision, setDecision] = useState<ContactDecision | null>(null);

  const cancelledRef = useRef(false);
  // índice de retry para reativar os effects (retry por seção / reload geral)
  const [reloadTick, setReloadTick] = useState(0);
  const [retryTicks, setRetryTicks] = useState<Record<LeadDetailSection, number>>({
    prospect: 0,
    entities: 0,
    graph: 0,
    addresses: 0,
    decision: 0,
  });

  const retry = useCallback((section: LeadDetailSection) => {
    setRetryTicks((prev) => ({ ...prev, [section]: prev[section] + 1 }));
    setReloadTick((t) => t + 1);
  }, []);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ── Prospect (fonte das demais seções: CNPJ decide o grafo) ────────────────
  useEffect(() => {
    cancelledRef.current = false;
    setProspectState({ status: 'loading' });
    (async () => {
      try {
        const data = await fetchProspect(leadId);
        if (cancelledRef.current) return;
        if (!data) {
          setNotFound(true);
          setProspectState({ status: 'empty' });
          return;
        }
        setProspect(data);
        setProspectState({ status: 'ready' });
      } catch (err) {
        if (cancelledRef.current) return;
        setProspectState({ status: 'error', error: err instanceof Error ? err.message : 'Erro ao carregar o lead' });
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [leadId, reloadTick, retryTicks.prospect]);

  // ── Fatos v2 por entidade ─────────────────────────────────────────────────
  useEffect(() => {
    if (!leadId) return;
    let localCancel = false;
    setEntitiesState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    (async () => {
      try {
        const list = await fetchProspectEnrichmentEntities(leadId);
        if (localCancel) return;
        setEntities(list);
        setEntitiesState({ status: list.length > 0 ? 'ready' : 'empty' });
      } catch (err) {
        if (localCancel) return;
        setEntitiesState({ status: 'error', error: err instanceof Error ? err.message : 'Erro ao carregar fatos' });
      }
    })();
    return () => {
      localCancel = true;
    };
  }, [leadId, reloadTick, retryTicks.entities]);

  // ── Grafo de enriquecimento (só com CNPJ) ─────────────────────────────────
  useEffect(() => {
    if (!prospect?.cnpj) {
      setGraph(null);
      setGraphState({ status: 'empty' });
      return;
    }
    let localCancel = false;
    setGraphState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    (async () => {
      try {
        const res = await fetchCompanyGraph(prospect.cnpj!);
        if (localCancel) return;
        setGraphAvailable(res.available);
        if (!res.available) {
          setGraph(null);
          setGraphState({ status: 'empty', error: res.error || 'Fonte do grafo indisponível' });
          return;
        }
        if (res.error) throw new Error(res.error);
        setGraph(res.data);
        const hasContent = Boolean(res.data && (res.data.nodes.length > 0 || res.data.facts.length > 0));
        setGraphState({ status: hasContent ? 'ready' : 'empty' });
      } catch (err) {
        if (localCancel) return;
        setGraphState({ status: 'error', error: err instanceof Error ? err.message : 'Erro ao carregar o grafo' });
      }
    })();
    return () => {
      localCancel = true;
    };
  }, [prospect?.id, prospect?.cnpj, retryTicks.graph]);

  // ── Endereços geocodificados ──────────────────────────────────────────────
  useEffect(() => {
    if (!leadId || notFound) return;
    let localCancel = false;
    setAddressesState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    (async () => {
      try {
        const data = await fetchLeadAddresses(leadId);
        if (localCancel) return;
        setAddresses(data);
        setAddressesState({ status: data.addresses.length > 0 ? 'ready' : 'empty' });
      } catch (err) {
        if (localCancel) return;
        setAddressesState({ status: 'error', error: err instanceof Error ? err.message : 'Erro ao carregar endereços' });
      }
    })();
    return () => {
      localCancel = true;
    };
  }, [leadId, notFound, reloadTick, retryTicks.addresses]);

  // ── Painel de decisão de contato (feature 003) ────────────────────────────
  useEffect(() => {
    if (!leadId || notFound) return;
    let localCancel = false;
    setDecisionState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    (async () => {
      try {
        const data = await fetchContactDecision(leadId);
        if (localCancel) return;
        setDecision(data);
        setDecisionState({ status: data ? 'ready' : 'empty' });
      } catch (err) {
        if (localCancel) return;
        setDecisionState({ status: 'error', error: err instanceof Error ? err.message : 'Erro ao carregar a decisão de contato' });
      }
    })();
    return () => {
      localCancel = true;
    };
  }, [leadId, notFound, reloadTick, retryTicks.decision]);

  // ── Polling leve enquanto o enriquecimento está em andamento (FR-017) ─────
  const enrichmentActive = Boolean(
    prospect && (!prospect.enrichmentStatus || ENRICHMENT_ACTIVE.has(prospect.enrichmentStatus))
  );
  useEffect(() => {
    if (!enrichmentActive || notFound) return;
    const timer = setInterval(async () => {
      try {
        const [fresh, freshEntities, freshDecision] = await Promise.all([
          fetchProspect(leadId),
          fetchProspectEnrichmentEntities(leadId).catch(() => null),
          fetchContactDecision(leadId).catch(() => null),
        ]);
        if (cancelledRef.current || !fresh) return;
        setProspect(fresh);
        if (freshEntities) {
          setEntities(freshEntities);
          setEntitiesState({ status: freshEntities.length > 0 ? 'ready' : 'empty' });
        }
        if (freshDecision) {
          setDecision(freshDecision);
          setDecisionState({ status: 'ready' });
        }
      } catch {
        // falha transitória de polling não derruba a tela; próximo tick tenta de novo
      }
    }, ENRICHMENT_POLL_MS);
    return () => clearInterval(timer);
  }, [enrichmentActive, notFound, leadId]);

  return {
    prospect,
    notFound,
    entities,
    graph,
    graphAvailable,
    addresses,
    decision,
    states: {
      prospect: prospectState,
      entities: entitiesState,
      graph: graphState,
      addresses: addressesState,
      decision: decisionState,
    },
    enrichmentActive,
    retry,
    reload,
  } as const;
}
