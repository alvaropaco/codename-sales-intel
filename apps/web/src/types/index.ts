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

export type ActiveTab = 'dashboard' | 'prospects' | 'pipeline' | 'risk' | 'workflows' | 'settings';
