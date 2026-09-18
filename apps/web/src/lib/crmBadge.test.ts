import { describe, it, expect } from 'vitest';
import { crmBadgeState } from './crmBadge';

describe('badge do CRM no rodapé da sidebar (FR-017)', () => {
  it('CRM informado e conectado → badge verde com o nome', () => {
    expect(crmBadgeState({ name: 'Pipedrive', connected: true })).toEqual({
      connected: true,
      neutral: false,
      label: 'Pipedrive',
    });
  });

  it('"Ainda não uso" → estado neutro, sem badge verde', () => {
    const state = crmBadgeState({ name: null, connected: false });
    expect(state).toEqual({ connected: false, neutral: true, label: null });
  });

  it('CRM pulado (não informado) → estado neutro', () => {
    expect(crmBadgeState(null).neutral).toBe(true);
    expect(crmBadgeState(undefined).neutral).toBe(true);
  });

  it('inconsistência (nome sem connected) nunca mostra badge verde', () => {
    const state = crmBadgeState({ name: 'HubSpot', connected: false });
    expect(state.connected).toBe(false);
    expect(state.neutral).toBe(true);
  });
});
