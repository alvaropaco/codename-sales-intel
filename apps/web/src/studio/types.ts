/**
 * Tipos do domínio Campaign Studio (specs/010).
 * Espelham data-model.md e contracts/rest-api.md. Crescem por story.
 */

export type StudioCampaignStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'retained';

export type StudioChannel = 'email' | 'whatsapp' | 'linkedin_text';

export type StudioOrigin =
  | 'manual'
  | 'ai_prompt'
  | 'material'
  | 'url'
  | 'company_data'
  | 'duplicate'
  | 'template'
  | 'agent';

export type FunnelStage = 'top' | 'middle' | 'bottom';

export interface StudioSchedule {
  mode: 'immediate' | 'scheduled';
  startAt?: string | null;
  windows: Array<{ days: number[]; startHour: number; endHour: number }>;
  hourlyLimit: number;
  dailyLimit: number;
  timezone: string;
  useLeadTimezone: boolean;
}

export interface StudioCampaignSummary {
  id: string;
  name: string;
  description?: string | null;
  status: StudioCampaignStatus;
  statusReason?: string | null;
  origin: StudioOrigin;
  channels: StudioChannel[];
  funnelStage: FunnelStage;
  audienceCount?: number;
  sentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudioCampaignDetail extends StudioCampaignSummary {
  objective?: string | null;
  offer?: string | null;
  schedule: StudioSchedule;
  approvedAt?: string | null;
  journeyEnabled: boolean;
  emailExecutionId?: string | null;
  whatsappExecutionId?: string | null;
  approval?: { automation?: boolean; complianceLevel?: string | null } & Record<string, unknown>;
  contents?: Array<Record<string, unknown>>;
}

export interface StudioApiError {
  error: string;
  message?: string;
}
