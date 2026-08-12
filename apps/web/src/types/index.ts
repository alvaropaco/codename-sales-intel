export type ProspectStatus = 'qualified' | 'prospect' | 'lead' | 'contacted' | 'proposal' | 'closed';

export interface Prospect {
  id: string;
  cnpj: string;
  companyName: string;
  industry?: string | null;
  employees?: number | null;
  opportunityScore: number;
  status: ProspectStatus;
  revenueEstimate?: number | null;
  qualificationStage?: string | null;
  lastContact?: string | null;
  orgId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineAnalytics {
  total_prospects: number;
  qualified: number;
  prospects: number;
  leads: number;
  qualification_rate: number;
  closure_rate: number;
}

export interface ForecastAnalytics {
  this_month: number;
  next_month: number;
  q3_projection: number;
}

export interface StatusBreakdownItem {
  status: ProspectStatus;
  _count: number;
}

export interface QualificationResult {
  score: number;
  level: 'qualified' | 'prospect' | 'lead';
  confidence: string;
}

export interface CreditRiskResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  factors: string[];
}

export interface WorkflowItem {
  id: string | number;
  name: string;
  trigger: string;
  action: string;
  status: 'active' | 'paused';
  createdAt: string;
}

export interface CnpjPartner {
  name?: string;
  qualification?: string;
  country?: string;
  ageRange?: string;
  joinedAt?: string;
}

export interface EnrichedCnpjContact {
  id: string;
  cnpj: string;
  companyName: string;
  tradeName?: string | null;
  industry?: string | null;
  status: ProspectStatus;
  opportunityScore: number;
  email?: string | null;
  phones: string[];
  partners: CnpjPartner[];
  openedAt?: string | null;
  legalNature?: string | null;
  enrichmentStatus: 'pending' | 'enriched' | 'unavailable' | 'error';
  enrichmentSource?: string | null;
  enrichmentError?: string | null;
  enrichedAt?: string | null;
  createdAt: string;
}

export type ActiveTab = 'dashboard' | 'prospects' | 'pipeline' | 'risk' | 'workflows' | 'enrichment' | 'settings';
