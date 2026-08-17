export type ProspectStatus = 'qualified' | 'prospect' | 'lead' | 'contacted' | 'proposal' | 'closed';

export interface EnrichmentSummary {
  domain?: string | null;
  website_active?: boolean | null;
  corporate_email?: boolean | null;
  launch_velocity?: number | null;
  operational_readiness?: number | null;
  commercial_potential?: number | null;
  tech_count?: number | null;
}

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
  city?: string | null;
  state?: string | null;
  tradeName?: string | null;
  cnpjEmail?: string | null;
  cnpjPhones?: string[] | null;
  cnpjPartners?: CnpjPartner[] | null;
  cnpjOpenedAt?: string | null;
  cnpjLegalNature?: string | null;
  enrichmentStatus?: string | null;
  enrichmentSource?: string | null;
  enrichmentError?: string | null;
  enrichmentVersion?: number | null;
  enrichmentSummary?: EnrichmentSummary | null;
  enrichedAt?: string | null;
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

export interface CommercialProfile {
  id?: string | null;
  orgId?: string | null;
  onboardingCompleted: boolean;
  onboardingStep?: number;
  companyName: string;
  salesTeamSize: string;
  targetSegments: string[];
  targetCnaes: string[];
  targetLocations: string[];
  companyStatuses: string[];
  targetSizes: string[];
  ageRanges: string[];
  averageTicket?: number | null;
  salesCycle: string;
  valueProposition: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CnpjPartner {
  name?: string;
  qualification?: string;
  country?: string;
  ageRange?: string;
  joinedAt?: string;
}

export interface DiscoveredCompany {
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  industry?: string | null;
  status?: 'active' | 'inactive' | string | null;
  city?: string | null;
  state?: string | null;
  openingDate?: string | null;
  legalNature?: string | null;
  companySize?: string | null;
  shareCapital?: number | null;
  email?: string | null;
  isActive?: boolean;
  source?: string;
}

export interface DiscoveryCriteria {
  segments: string[];
  locations: string[];
  activeOnly: boolean;
  usedProfile: boolean;
}

export interface DiscoveryPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
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

export type ActiveTab = 'dashboard' | 'prospects' | 'pipeline' | 'risk' | 'workflows' | 'enrichment' | 'outreach' | 'settings';

// --- Outreach / Cold sales via Gmail ----------------------------------------

export interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  status: string; // connected, revoked, expired
  scopes: string[];
  lastHistoryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachCampaign {
  id: string;
  name: string;
  description?: string | null;
  status: string; // draft, active, paused, completed
  createdAt: string;
  updatedAt: string;
}

export interface OutreachMessageSummary {
  id: string;
  subject: string;
  status?: string | null;
  sentAt?: string | null;
  scheduledFor?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  trackingToken?: string | null;
  error?: string | null;
}

export interface OutreachEvent {
  id: string;
  contactId?: string | null;
  messageId?: string | null;
  type: string;
  status: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
  message?: Pick<OutreachMessageSummary, 'id' | 'subject' | 'status' | 'sentAt' | 'gmailMessageId'> | null;
}

export interface OutreachContactSummary {
  id: string;
  status: string; // SELECTED → QUEUED → … → REPLIED
  outreachSequence: number;
  scheduledAt?: string | null;
  sentAt?: string | null;
  nextFollowupAt?: string | null;
  lastReplyAt?: string | null;
  replyCount: number;
  unsubscribed: boolean;
  cancelReason?: string | null;
  campaign?: { name: string; status: string } | null;
  messages: OutreachMessageSummary[];
  events: OutreachEvent[];
}

export interface SuppressionEntry {
  id: string;
  email: string;
  reason?: string | null;
  addedAt: string;
}

export interface StartCampaignResult {
  campaignId: string;
  jobsQueued: number;
  jobIds: string[];
}

// --- Grafo de enriquecimento (v_company_graph) -------------------------------

export interface GraphNode {
  id: string;
  type: string;
  key: string;
  label: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  confidence?: number | null;
  observed_at?: string | null;
}

export interface GraphFact {
  entity_type: string;
  entity_key: string;
  entity_label?: string | null;
  fact_key: string;
  value: unknown;
  confidence?: number | null;
  confidence_label?: 'alta' | 'média' | 'baixa';
  source?: Record<string, unknown> | null;
  observed_at?: string | null;
}

export interface CompanyProfile {
  firmographics: Record<string, unknown>;
  domain: unknown;
  social: Record<string, { url?: string; confidence?: number | null }>;
  contact_points: Array<{ type: string; value: string; confidence?: number | null }>;
  financial_indicators: Record<string, unknown>;
  technologies: Array<{ name?: string; category?: string; confidence?: number | null }>;
  people: Array<{ id: string; label: string; role: string; confidence?: number | null }>;
  relationships: {
    co_owners: string[];
    edge_count: number;
    edges: GraphEdge[];
  };
  evidence: unknown[];
  raw_facts?: Array<{ key: string; value: unknown; confidence?: number | null }>;
}

export interface CompanyGraph {
  companyId: string;
  cnpj: string;
  enrichmentVersion: number;
  status: string;
  enrichedAt: string | null;
  profile: CompanyProfile;
  summary: Record<string, unknown>;
  companyLabel: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  facts: GraphFact[];
}

// --- Taxonomia CNAE ---------------------------------------------------------

export interface CnaeAtividade {
  cnae: string;
  codigo: string;
  atividade: string;
}

export interface CnaeCategoria {
  divisao: string;
  nome: string;
  atividades: CnaeAtividade[];
}

export interface CnaeRamo {
  secao: string;
  nome: string;
  oficial: string;
  categorias: CnaeCategoria[];
}
