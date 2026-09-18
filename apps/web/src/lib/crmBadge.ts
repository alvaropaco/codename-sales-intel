/**
 * crmBadge.ts — estado do indicador de CRM no rodapé da sidebar (feature 004,
 * FR-017). Nesta iteração "conectado" = CRM declarado na conversa com a Ava
 * (Assumptions da spec); integração real com APIs de CRM é escopo futuro.
 */

import type { CrmInfo } from '@/types/onboarding';

export interface CrmBadgeState {
  connected: boolean;
  /** Estado neutro (CRM não informado) — mostra caminho para configurar depois. */
  neutral: boolean;
  label: string | null;
}

export function crmBadgeState(crm: CrmInfo | null | undefined): CrmBadgeState {
  if (crm && crm.connected && crm.name) {
    return { connected: true, neutral: false, label: crm.name };
  }
  return { connected: false, neutral: true, label: null };
}
