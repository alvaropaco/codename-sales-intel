/**
 * Tipos do onboarding conversacional (feature 004 — Ava).
 * Fonte da verdade: specs/004-ai-onboarding/data-model.md.
 */

/** Os 13 passos da conversa, na ordem do FR-003 (009: + região de interesse). */
export type QuestionId =
  | 'nome'
  | 'empresa'
  | 'cargo'
  | 'setor'
  | 'tamanhoTime'
  | 'objetivo'
  | 'crm'
  | 'mercadoAlvo'
  | 'regioesInteresse'
  | 'email'
  | 'siteInstitucional'
  | 'materiais'
  | 'catalogo';

/** Como a resposta foi dada (FR-008: pre-filled = confirmou sugestão da conta). */
export type AnswerVia = 'chip' | 'text' | 'prefilled' | 'skipped';

/** Motivos de validação conversacional (FR-010) — nunca viram erro técnico. */
export type ValidationReason = 'EMPTY' | 'INVALID_EMAIL' | 'INVALID_URL' | 'INVALID_OPTION' | 'EMPTY_SELECTION';

export interface Answer {
  questionId: QuestionId;
  value: string | string[] | null;
  via: AnswerVia;
  answeredAt: number;
}

export type AnswerResult =
  | { ok: true }
  | { ok: false; reason: ValidationReason };

export interface ChipOption {
  value: string;
  label: string;
}

export type ChatMessageKind = 'text' | 'chips' | 'input' | 'attachments' | 'summary';

export interface ChatMessage {
  id: string;
  from: 'ava' | 'user';
  kind: ChatMessageKind;
  /** Conteúdo textual (pergunta, reação, resposta do usuário). */
  text: string | null;
  /** questionId quando a mensagem é uma pergunta/composer. */
  questionId?: QuestionId;
  /** Opções de chips (kind 'chips'). */
  options?: ChipOption[];
  /** Seleção múltipla (só mercado-alvo — FR-005). */
  multi?: boolean;
  /** Aceita anexos (pergunta de materiais). */
  allowAttachments?: boolean;
  /** 009: opção exclusiva de multi seleção (espelha AvaQuestion.exclusiveValue). */
  exclusiveValue?: string;
  /** Duração do "···" antes de revelar a mensagem (ms) — D8. */
  typingForMs?: number | null;
}

export interface AssetFileMeta {
  name: string;
  size: number;
  mime: string;
}

export type BusinessAssetType = 'site' | 'document' | 'catalog';

export type BusinessAssetStatus = 'pending' | 'extracting' | 'extracted' | 'failed' | 'unsupported';

export interface BusinessAsset {
  id: string;
  type: BusinessAssetType;
  name: string;
  url: string | null;
  file: AssetFileMeta | null;
  /** Bytes mantidos só em memória, para o POST de extração (nunca persistidos). */
  blob?: File | null;
  status: BusinessAssetStatus;
  warning?: string | null;
}

/** Shape espelha org-context.js — drop-in para outreach (data-model.md). */
export interface BusinessContext {
  products: Array<{ name: string; description: string }>;
  valueProposition: string;
  businessModel: string;
  differentiators: string[];
  targetMarket: string;
  sources: BusinessAssetType[];
  warnings: string[];
}

export interface OnboardingState {
  /** Índice da pergunta corrente no roteiro (0–11). */
  stepIndex: number;
  messages: ChatMessage[];
  answers: Partial<Record<QuestionId, Answer>>;
  assets: BusinessAsset[];
  businessContext: BusinessContext | null;
  completed: boolean;
}

export interface CrmInfo {
  name: string | null;
  connected: boolean;
}

/** Resultado do POST de extração consumido pelo serviço (injetável em testes). */
export interface ExtractionResponse {
  businessContext: BusinessContext | null;
  warnings: string[];
}

export type ExtractionPayload = {
  siteUrl: string | null;
  catalogUrl: string | null;
  files: File[];
};

export type ExtractionOutcome =
  | { ok: true; businessContext: BusinessContext | null }
  | {
      ok: false;
      reason: 'NOTHING_TO_EXTRACT' | 'REQUEST_FAILED' | 'TIMEOUT' | 'SUPERSEDED';
    };

export interface AddFilesResult {
  accepted: File[];
  rejected: Array<{ file: File; reason: string }>;
}

/** Resultado entregue ao App na conclusão (FR-015/016/017). */
export interface OnboardingResult {
  companyName: string;
  userName: string;
  userEmail: string;
  crm: CrmInfo;
  mercadoAlvo: string[];
  businessContext: BusinessContext | null;
  answers: Partial<Record<QuestionId, Answer>>;
}
