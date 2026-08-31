export type ProspectStatus = 'qualified' | 'prospect' | 'lead' | 'contacted' | 'proposal' | 'closed';

export type PlanType = 'trial' | 'premium';

export interface PlanInfo {
  plan: PlanType;
  canExport: boolean;
  leadLimit: number | null;
  leadCount: number;
  leadsRemaining: number | null;
  atLeadLimit: boolean;
}

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
  /** canais em que o lead já recebeu contato real (badge "Contatado") */
  contactedChannels?: string[];
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
  /** true quando o plano trial mascarou os campos sensíveis na resposta da API */
  dataRestricted?: boolean;
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
  /** true quando o plano trial mascarou os campos sensíveis na resposta da API */
  dataRestricted?: boolean;
}

export type ActiveTab = 'dashboard' | 'prospects' | 'pipeline' | 'risk' | 'workflows' | 'enrichment' | 'outreach' | 'whatsapp' | 'history' | 'settings';

// --- Histórico de disparos (email + WhatsApp) ---------------------------------

export interface DispatchHistoryItem {
  id: string; // "email:<cuid>" | "wa:<cuid>"
  channel: 'email' | 'whatsapp';
  prospectId: string | null;
  companyName: string | null;
  cnpj: string | null;
  destination: string | null; // email do lead ou telefone
  campaignId: string | null;
  campaignName: string | null;
  origin: 'auto' | 'manual' | 'conversation'; // suíte automática, campanha manual, conversa 1:1
  preview: string | null; // assunto (email) ou início da mensagem (WhatsApp)
  status: string; // status bruto do canal
  bucket: 'sent' | 'pending' | 'failed';
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface DispatchHistoryCampaignOption {
  id: string;
  name: string | null;
  channel: 'email' | 'whatsapp';
}

export interface DispatchHistoryResult {
  items: DispatchHistoryItem[];
  total: number;
  hasMore: boolean;
  counts: { sent: number; pending: number; failed: number };
  campaigns: DispatchHistoryCampaignOption[];
}

// --- Outreach / Cold sales via Gmail ----------------------------------------

export interface EmailAccount {
  id: string;
  email: string;
  provider: string; // gmail (OAuth), smtp, resend
  status: string; // connected, revoked, expired, error
  scopes: string[];
  fromName?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  lastHistoryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachCampaign {
  id: string;
  name: string;
  description?: string | null;
  status: string; // draft, active, paused, completed
  // Suíte multicanal (gatilho pós-enriquecimento)
  trigger?: string; // manual | on_enrichment
  channels?: string[]; // ["email", "whatsapp"]
  autoActive?: boolean;
  emailAccountId?: string | null;
  emailTemplateSubject?: string | null;
  emailTemplateBody?: string | null;
  whatsappAccountId?: string | null;
  whatsappTemplate?: string | null;
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

// --- WhatsApp (prospecção via WAHA) ------------------------------------------

export type WhatsAppAccountStatus =
  | 'CREATED'
  | 'STARTING'
  | 'QR_REQUIRED'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'STOPPED'
  | 'ERROR';

export interface WhatsAppAccount {
  id: string;
  provider: string;
  sessionName: string;
  phoneNumber?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type WhatsAppCampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface WhatsAppSequenceStep {
  id: string;
  campaignId: string;
  orderIndex: number;
  messageTemplate: string;
  delayMinutes: number;
  conditions: unknown[];
  createdAt?: string;
}

export interface WhatsAppCampaign {
  id: string;
  name: string;
  whatsappAccountId?: string | null;
  whatsappAccount?: Pick<WhatsAppAccount, 'id' | 'phoneNumber' | 'status'> | null;
  status: string;
  startedAt?: string | null;
  pausedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  steps?: WhatsAppSequenceStep[];
  _count?: { contacts: number };
  contacts?: Array<{ id: string; status: string; prospect?: { id: string; companyName: string; cnpj: string } | null }>;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content?: string | null;
  mediaUrl?: string | null;
  providerMessageId?: string | null;
  status: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  createdAt: string;
  error?: string | null;
}

export type WhatsAppConversationStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'HUMAN_HANDOFF'
  | 'CLOSED'
  | 'OPTED_OUT';

export interface WhatsAppConversation {
  id: string;
  phoneNumber: string;
  status: string;
  prospectId?: string | null;
  assignedTo?: string | null;
  lastMessageAt?: string | null;
  lastInboundMessageAt?: string | null;
  whatsappAccountId?: string | null;
  whatsappAccount?: Pick<WhatsAppAccount, 'id' | 'phoneNumber' | 'status'> | null;
  prospect?: { id: string; companyName: string; cnpj: string; city?: string | null; state?: string | null; industry?: string | null } | null;
  _count?: { messages: number };
}

export interface WhatsAppConnectResult {
  accountId: string;
  status: string;
  qr?: { qrCode?: string | null; raw?: string | null } | null;
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
  /** true quando o plano trial mascarou contatos/quadro societário na resposta */
  dataRestricted?: boolean;
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
