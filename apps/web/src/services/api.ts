import { 
  Prospect, 
  PipelineAnalytics, 
  ForecastAnalytics, 
  StatusBreakdownItem, 
  QualificationResult, 
  CreditRiskResult,
  WorkflowItem,
  EnrichedCnpjContact,
  CommercialProfile,
  DiscoveredCompany,
  DiscoveryCriteria,
  DiscoveryPage,
  CompanyGraph,
  EmailAccount,
  OutreachCampaign,
  OutreachContactSummary,
  OutreachEvent,
  SuppressionEntry,
  StartCampaignResult
} from '../types';

const API_BASE = '/api';

export async function fetchProspects(): Promise<Prospect[]> {
  try {
    const res = await fetch(`${API_BASE}/prospects`);
    if (!res.ok) throw new Error('Falha ao buscar prospectos');
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    console.error('API fetchProspects error:', error);
    return [];
  }
}

export async function createProspect(data: {
  cnpj: string;
  companyName: string;
  industry?: string;
  employees?: number;
  status?: string;
  revenueEstimate?: number;
}): Promise<Prospect> {
  const res = await fetch(`${API_BASE}/prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao criar prospecto');
  }
  return json.data;
}

export async function updateProspect(id: string, data: Partial<Prospect>): Promise<Prospect> {
  const res = await fetch(`${API_BASE}/prospects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao atualizar prospecto');
  }
  return json.data;
}

export async function deleteProspect(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/prospects/${id}`, {
    method: 'DELETE',
  });
  const json = await res.json();
  return json.success || false;
}

export async function bulkUpdateProspects(
  ids: string[],
  action: 'move' | 'delete',
  status?: string
): Promise<number> {
  const res = await fetch(`${API_BASE}/prospects/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action, status }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao atualizar prospectos em lote');
  }
  return json.data?.count ?? 0;
}

export async function fetchPipelineAnalytics(): Promise<PipelineAnalytics> {
  try {
    const res = await fetch(`${API_BASE}/analytics/pipeline`);
    if (!res.ok) throw new Error('Falha ao buscar métricas de pipeline');
    const json = await res.json();
    return json.data;
  } catch (error) {
    console.error('API fetchPipelineAnalytics error:', error);
    return {
      total_prospects: 0,
      qualified: 0,
      prospects: 0,
      leads: 0,
      qualification_rate: 0,
      closure_rate: 0,
    };
  }
}

export async function fetchForecastAnalytics(): Promise<ForecastAnalytics> {
  try {
    const res = await fetch(`${API_BASE}/analytics/forecast`);
    if (!res.ok) throw new Error('Falha ao buscar forecast');
    const json = await res.json();
    return json.data;
  } catch (error) {
    return {
      this_month: 0,
      next_month: 0,
      q3_projection: 0,
    };
  }
}

export async function fetchStatusBreakdown(): Promise<StatusBreakdownItem[]> {
  try {
    const res = await fetch(`${API_BASE}/analytics/breakdown`);
    if (!res.ok) throw new Error('Falha ao buscar breakdown');
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    return [];
  }
}

export async function qualifyCompany(companyName: string): Promise<QualificationResult> {
  const res = await fetch(`${API_BASE}/intelligence/qualify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_name: companyName }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro na qualificação');
  }
  return json.qualification;
}

export async function assessCreditRisk(cnpj: string): Promise<CreditRiskResult> {
  const res = await fetch(`${API_BASE}/intelligence/credit-risk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cnpj }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro na análise de risco');
  }
  return json.risk_assessment;
}

export async function createWorkflow(data: { name: string; trigger: string; action: string }): Promise<WorkflowItem> {
  const res = await fetch(`${API_BASE}/automation/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao criar workflow');
  }
  return json.workflow;
}

export async function fetchCommercialProfile(): Promise<CommercialProfile> {
  const res = await fetch(`${API_BASE}/settings/commercial-profile`);
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao carregar preferências comerciais');
  }
  return json.data;
}

export async function saveCommercialProfile(data: CommercialProfile): Promise<CommercialProfile> {
  const res = await fetch(`${API_BASE}/settings/commercial-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao salvar preferências comerciais');
  }
  return json.data;
}

export async function fetchEnrichedCnpjContacts(filters: {
  from?: string;
  to?: string;
  status?: string;
} = {}): Promise<EnrichedCnpjContact[]> {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);

  const query = params.toString();
  const res = await fetch(`${API_BASE}/enrichment/contacts${query ? `?${query}` : ''}`);
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao buscar enriquecimento CNPJ');
  }
  return json.data || [];
}

export async function extractCnpjContacts(data: {
  from?: string;
  to?: string;
  refresh?: boolean;
  limit?: number;
} = {}): Promise<EnrichedCnpjContact[]> {
  const res = await fetch(`${API_BASE}/enrichment/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao extrair contatos CNPJ');
  }
  return json.data || [];
}

export async function fetchDiscoveryProfile(): Promise<{
  onboardingCompleted: boolean;
  targetCnaes: string[];
  targetSegments: string[];
  targetLocations: string[];
  companyStatuses: string[];
  targetSizes: string[];
}> {
  try {
    const res = await fetch(`${API_BASE}/discovery/profile`);
    const json = await res.json();
    if (json.success && json.data) {
      return json.data;
    }
    return {
      onboardingCompleted: false,
      targetCnaes: [],
      targetSegments: [],
      targetLocations: [],
      companyStatuses: ['active'],
      targetSizes: [],
    };
  } catch {
    return {
      onboardingCompleted: false,
      targetCnaes: [],
      targetSegments: [],
      targetLocations: [],
      companyStatuses: ['active'],
      targetSizes: [],
    };
  }
}

export interface DiscoveryCandidatesResult {
  companies: DiscoveredCompany[];
  criteria: DiscoveryCriteria;
  page: DiscoveryPage;
  message?: string;
  mcpError?: string;
}

export async function fetchDiscoveryCandidates(
  options: { cnae?: string; segment?: string; location?: string; cnpj?: string; limit?: number; page?: number; pageSize?: number; seed?: string } = {}
): Promise<DiscoveryCandidatesResult> {
  const params = new URLSearchParams();
  if (options.cnae) params.set('cnae', options.cnae);
  if (options.segment) params.set('segment', options.segment);
  if (options.location) params.set('location', options.location);
  if (options.cnpj) params.set('cnpj', options.cnpj);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  if (options.seed) params.set('seed', options.seed);

  const emptyPage: DiscoveryPage = { page: 1, pageSize: 12, total: 0, totalPages: 0, hasMore: false };

  try {
    const res = await fetch(`${API_BASE}/discovery/candidates?${params.toString()}`);
    const json = await res.json();
    if (json.success) {
      return {
        companies: json.data || [],
        criteria: json.criteria || { segments: [], locations: [], activeOnly: false, usedProfile: false },
        page: {
          page: json.page || 1,
          pageSize: json.pageSize || 12,
          total: json.total || 0,
          totalPages: json.totalPages || 0,
          hasMore: Boolean(json.hasMore),
        },
        message: json.message,
        mcpError: json.mcpError || undefined,
      };
    }
    return {
      companies: [],
      criteria: { segments: [], locations: [], activeOnly: false, usedProfile: false },
      page: emptyPage,
      message: json.error || undefined,
      mcpError: typeof json.error === 'string' && /MCP-CNPJ|configurad/i.test(json.error) ? json.error : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : undefined;
    return {
      companies: [],
      criteria: { segments: [], locations: [], activeOnly: false, usedProfile: false },
      page: emptyPage,
      message: msg || 'Não foi possível buscar leads descobertos.',
      mcpError: msg && /MCP-CNPJ|configurad/i.test(msg) ? msg : undefined,
    };
  }
}

export async function importDiscoveredCompany(data: {
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  industry?: string | null;
  status?: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  openingDate?: string | null;
  legalNature?: string | null;
}): Promise<{ prospect: Prospect; alreadyExists: boolean }> {
  const res = await fetch(`${API_BASE}/discovery/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao importar lead');
  }
  return { prospect: json.data, alreadyExists: json.alreadyExists || false };
}

export async function enrichProspectViaMcp(id: string): Promise<Prospect> {
  const res = await fetch(`${API_BASE}/prospects/${id}/enrich-mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao enriquecer lead');
  }
  return json.data;
}

export interface CompanyGraphResponse {
  available: boolean;
  data: CompanyGraph | null;
  error?: string;
}

export async function fetchCompanyGraph(cnpj: string): Promise<CompanyGraphResponse> {
  try {
    const res = await fetch(`${API_BASE}/enrichment/graph/${encodeURIComponent(cnpj)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      return { available: true, data: null, error: json.error || `Erro ${res.status} ao carregar o grafo` };
    }
    return { available: Boolean(json.available), data: json.data || null, error: json.error };
  } catch (error) {
    console.error('API fetchCompanyGraph error:', error);
    return { available: false, data: null, error: 'Não foi possível falar com o backend' };
  }
}

// ── Outreach / Gmail API ────────────────────────────────────────────────────

export async function fetchGmailAuthUrl(): Promise<string> {
  const res = await fetch(`${API_BASE}/gmail/auth-url`);
  const json = await res.json();
  if (!res.ok || !json.success || !json.authUrl) {
    throw new Error(json.error || 'Não foi possível gerar o link de conexão com o Gmail');
  }
  return json.authUrl;
}

export async function fetchGmailAccounts(): Promise<EmailAccount[]> {
  try {
    const res = await fetch(`${API_BASE}/gmail/accounts`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao listar contas do Gmail');
    return json.data || [];
  } catch (error) {
    console.error('API fetchGmailAccounts error:', error);
    return [];
  }
}

export async function disconnectGmailAccount(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/gmail/accounts/${id}`, { method: 'DELETE' });
  const json = await res.json();
  return Boolean(json.success);
}

export async function fetchOutreachCampaigns(): Promise<OutreachCampaign[]> {
  try {
    const res = await fetch(`${API_BASE}/outreach/campaigns`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao listar campanhas');
    return json.data || [];
  } catch (error) {
    console.error('API fetchOutreachCampaigns error:', error);
    return [];
  }
}

export async function createOutreachCampaign(data: {
  name: string;
  description?: string;
}): Promise<OutreachCampaign> {
  const res = await fetch(`${API_BASE}/outreach/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao criar campanha');
  }
  return json.data;
}

export async function startOutreachCampaign(
  campaignId: string,
  prospectIds: string[],
  emailAccountId?: string | null
): Promise<StartCampaignResult> {
  const res = await fetch(`${API_BASE}/outreach/campaigns/${campaignId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prospectIds, emailAccountId: emailAccountId || null }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao iniciar campanha');
  }
  return json.data;
}

export async function fetchProspectOutreachTimeline(prospectId: string): Promise<OutreachEvent[]> {
  try {
    const res = await fetch(`${API_BASE}/prospects/${prospectId}/outreach-timeline`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao carregar timeline');
    return json.data || [];
  } catch (error) {
    console.error('API fetchProspectOutreachTimeline error:', error);
    return [];
  }
}

export async function fetchProspectOutreachStatus(prospectId: string): Promise<OutreachContactSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/prospects/${prospectId}/outreach-status`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao carregar status de outreach');
    return json.data || [];
  } catch (error) {
    console.error('API fetchProspectOutreachStatus error:', error);
    return [];
  }
}

export async function fetchSuppressionList(): Promise<SuppressionEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/outreach/suppression`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao carregar lista de supressão');
    return json.data || [];
  } catch (error) {
    console.error('API fetchSuppressionList error:', error);
    return [];
  }
}

export async function addToSuppressionList(email: string, reason?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/outreach/suppression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, reason: reason || 'manual' }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao adicionar à lista de supressão');
  }
}

export async function removeFromSuppressionList(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/outreach/suppression/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao remover da lista de supressão');
  }
}
