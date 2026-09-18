import { describe, it, expect, beforeEach } from 'vitest';
import { createOnboardingService } from './onboarding';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

function makeService() {
  const storage = makeStorage();
  return { service: createOnboardingService({ storage }), storage };
}

describe('pré-preenchimento da conta (FR-008)', () => {
  it('prefill aparece no contexto e answer(via: prefilled) marca corretamente', () => {
    const { service } = makeService();
    // avança até email com prefill
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    for (const q of ['cargo', 'setor', 'tamanhoTime', 'objetivo', 'crm', 'mercadoAlvo'] as const) {
      service.skip(q);
    }
    const r = service.answer('email', 'ana@acme.com', 'prefilled');
    expect(r).toEqual({ ok: true });
    expect(service.getState().answers.email).toMatchObject({ value: 'ana@acme.com', via: 'prefilled' });
  });

  it('prefill de e-mail interpola na pergunta de e-mail (confirmação)', () => {
    const { service } = createWithPrefill({ companyName: 'Acme', email: 'ana@acme.com' });
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    for (const q of ['cargo', 'setor', 'tamanhoTime', 'objetivo', 'crm', 'mercadoAlvo'] as const) {
      service.skip(q);
    }
    const messages = service.getState().messages;
    const emailQuestion = messages[messages.length - 1];
    expect(emailQuestion.questionId).toBe('email');
    expect(emailQuestion.text).toContain('ana@acme.com');
  });

  it('prefill de empresa interpola nas perguntas seguintes (setor)', () => {
    const { service } = createWithPrefill({ companyName: 'Acme', email: 'ana@acme.com' });
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    service.skip('cargo');
    const messages = service.getState().messages;
    const setorQuestion = messages[messages.length - 1];
    expect(setorQuestion.questionId).toBe('setor');
    expect(setorQuestion.text).toContain('Acme');
  });
});

function createWithPrefill(prefill: { firstName?: string; companyName?: string; email?: string }) {
  const storage = makeStorage();
  return { service: createOnboardingService({ storage, prefill }) };
}

describe('corrigir resposta anterior (FR-012/FR-014)', () => {
  let s: ReturnType<typeof createOnboardingService>;
  beforeEach(() => {
    s = makeService().service;
    s.answer('nome', 'Ana', 'text');
    s.answer('empresa', 'Acme', 'text');
    s.skip('cargo');
  });

  it('revise volta à pergunta indicada descartando respostas posteriores', () => {
    const r = s.revise('empresa');
    expect(r).toEqual({ ok: true });
    const state = s.getState();
    expect(state.stepIndex).toBe(1);
    expect(state.answers.empresa).toBeUndefined();
    expect(state.answers.cargo).toBeUndefined();
    // respostas anteriores à revisada permanecem
    expect(state.answers.nome).toMatchObject({ value: 'Ana' });
  });

  it('após revise, responder a pergunta regravada segue o fluxo normal', () => {
    s.revise('empresa');
    const r = s.answer('empresa', 'Nova Empresa', 'text');
    expect(r).toEqual({ ok: true });
    expect(s.getState().stepIndex).toBe(2);
    expect(s.getState().answers.empresa).toMatchObject({ value: 'Nova Empresa' });
  });

  it('revise de pergunta ainda não respondida falha sem quebrar o estado', () => {
    const r = s.revise('email');
    expect(r.ok).toBe(false);
    expect(s.getState().stepIndex).toBe(3);
  });
});
