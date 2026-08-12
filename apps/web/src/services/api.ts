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
  DiscoveryCriteria
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

export async function fetchDiscoveryCandidates(
  options: { cnae?: string; segment?: string; location?: string; limit?: number } = {}
): Promise<{ companies: DiscoveredCompany[]; criteria: DiscoveryCriteria; message?: string }> {
  const params = new URLSearchParams();
  if (options.cnae) params.set('cnae', options.cnae);
  if (options.segment) params.set('segment', options.segment);
  if (options.location) params.set('location', options.location);
  if (options.limit) params.set('limit', String(options.limit));

  try {
    const res = await fetch(`${API_BASE}/discovery/candidates?${params.toString()}`);
    const json = await res.json();
    if (json.success) {
      return {
        companies: json.data || [],
        criteria: json.criteria || { segments: [], locations: [], activeOnly: false, usedProfile: false },
        message: json.message,
      };
    }
    return { companies: [], criteria: { segments: [], locations: [], activeOnly: false, usedProfile: false } };
  } catch {
    return { companies: [], criteria: { segments: [], locations: [], activeOnly: false, usedProfile: false } };
  }
}

export async function importDiscoveredCompany(data: {
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  industry?: string | null;
  status?: string;
}): Promise<{ prospect: Prospect; alreadyExists: boolean }> {
  const res = await fetch(`${API_BASE}/discovery/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Erro ao importar empresa');
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
    throw new Error(json.error || 'Erro ao enriquecer empresa');
  }
  return json.data;
}
