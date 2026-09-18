import { describe, it, expect, beforeEach } from 'vitest';
import { createOnboardingService, DONE_STORAGE_KEY } from './onboarding';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

/** Conduz o serviço até a fase de resumo (12 respostas/pulos). */
function untilSummary(storage = makeStorage()) {
  const service = createOnboardingService({ storage });
  service.answer('nome', 'Ana', 'text');
  service.answer('empresa', 'Acme', 'text');
  service.answer('cargo', 'Fundador/CEO', 'chip');
  service.answer('setor', 'Tecnologia/SaaS', 'chip');
  service.skip('tamanhoTime');
  service.answer('objetivo', 'Gerar mais leads', 'chip');
  service.answer('crm', '__none__', 'chip');
  service.answer('mercadoAlvo', ['Pequenas empresas', 'Médias empresas'], 'chip');
  service.answer('email', 'ana@acme.com', 'prefilled');
  service.skip('siteInstitucional');
  service.skip('materiais');
  service.answer('catalogo', 'nao', 'chip');
  return { service, storage };
}

describe('complete() — conclusão do onboarding (FR-015/FR-019)', () => {
  let s: ReturnType<typeof createOnboardingService>;
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    ({ service: s, storage } = untilSummary());
  });

  it('antes do resumo completo, complete() falha', () => {
    const fresh = createOnboardingService({ storage: makeStorage() });
    const r = fresh.complete();
    expect(r).toBeNull();
  });

  it('com as obrigatórias respondidas, retorna o resultado da conta', () => {
    const result = s.complete();
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Acme');
    expect(result!.userName).toBe('Ana');
    expect(result!.userEmail).toBe('ana@acme.com');
    // CRM "Ainda não uso" → não conectado (FR-017)
    expect(result!.crm).toEqual({ name: null, connected: false });
    expect(result!.mercadoAlvo).toEqual(['Pequenas empresas', 'Médias empresas']);
  });

  it('perguntas puladas ficam como skipped e não entram no resultado como resposta', () => {
    const result = s.complete()!;
    expect(result.answers.tamanhoTime).toMatchObject({ via: 'skipped', value: null });
    expect(result.answers.siteInstitucional).toMatchObject({ via: 'skipped' });
    expect(result.answers.materiais).toMatchObject({ via: 'skipped' });
  });

  it('grava o flag de conclusão no storage (sessão — FR-019)', () => {
    s.complete();
    expect(storage.map.get(DONE_STORAGE_KEY)).toBe('1');
  });

  it('complete() com CRM informado marca connected=true (FR-017)', () => {
    const storage2 = makeStorage();
    const s2 = createOnboardingService({ storage: storage2 });
    s2.answer('nome', 'Ana', 'text');
    s2.answer('empresa', 'Acme', 'text');
    s2.skip('cargo');
    s2.skip('setor');
    s2.skip('tamanhoTime');
    s2.skip('objetivo');
    s2.answer('crm', 'Pipedrive', 'chip');
    s2.skip('mercadoAlvo');
    s2.answer('email', 'ana@acme.com', 'text');
    s2.skip('siteInstitucional');
    s2.skip('materiais');
    s2.skip('catalogo');
    const result = s2.complete()!;
    expect(result.crm).toEqual({ name: 'Pipedrive', connected: true });
  });

  it('após complete(), o estado marca completed e a conversa trava', () => {
    s.complete();
    const state = s.getState();
    expect(state.completed).toBe(true);
    expect(s.answer('nome', 'Outro', 'text').ok).toBe(false);
  });
});
