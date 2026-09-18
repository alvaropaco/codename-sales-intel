import { describe, it, expect, beforeEach } from 'vitest';
import { createOnboardingService, type OnboardingService } from './onboarding';

/** Storage fake (injetável) — gravações são rastreadas para garantir ausência de I/O. */
function makeStorage() {
  const map = new Map<string, string>();
  const calls: string[] = [];
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      calls.push(`set:${k}`);
      map.set(k, v);
    },
    removeItem: (k: string) => {
      calls.push(`remove:${k}`);
      map.delete(k);
    },
    calls,
    map,
  };
}

function makeService() {
  const storage = makeStorage();
  const service = createOnboardingService({ storage });
  return { service, storage };
}

/** Responde as 2 obrigatórias iniciais (nome, empresa) e retorna o serviço. */
function seeded(service: OnboardingService) {
  service.answer('nome', 'Ana', 'text');
  service.answer('empresa', 'Acme', 'text');
  return service;
}

describe('sessão nova (FR-001/FR-002)', () => {
  let s: OnboardingService;
  beforeEach(() => {
    s = makeService().service;
  });

  it('começa na pergunta nome com a apresentação da Ava como primeira mensagem', () => {
    const state = s.getState();
    expect(state.completed).toBe(false);
    expect(state.stepIndex).toBe(0);
    expect(state.messages[0].from).toBe('ava');
    expect(state.messages[0].text).toContain('Ava');
    const last = state.messages[state.messages.length - 1];
    expect(last.questionId).toBe('nome');
  });
});

describe('fluxo de respostas (FR-003)', () => {
  it('answer registra valor/via e avança na ordem do roteiro', () => {
    const { service } = makeService();
    const r = service.answer('nome', 'Ana', 'text');
    expect(r).toEqual({ ok: true });
    const state = service.getState();
    expect(state.stepIndex).toBe(1);
    expect(state.answers.nome).toMatchObject({ value: 'Ana', via: 'text' });
    const last = state.messages[state.messages.length - 1];
    expect(last.questionId).toBe('empresa');
  });

  it('pergunta por vez: mensagem do usuário + próxima pergunta da Ava', () => {
    const { service } = makeService();
    const before = service.getState().messages.length;
    service.answer('nome', 'Ana', 'text');
    const messages = service.getState().messages;
    expect(messages.length).toBeGreaterThanOrEqual(before + 2);
    expect(messages[messages.length - 2].from).toBe('user');
    expect(messages[messages.length - 1].from).toBe('ava');
  });
});

describe('skip (FR-011)', () => {
  it('rejeita pular obrigatória', () => {
    const { service } = makeService();
    const r = service.skip('nome');
    expect(r.ok).toBe(false);
    expect(service.getState().stepIndex).toBe(0);
  });

  it('aceita pular não-obrigatória e marca via skipped', () => {
    const { service } = makeService();
    seeded(service);
    const r = service.skip('cargo');
    expect(r).toEqual({ ok: true });
    const state = service.getState();
    expect(state.answers.cargo).toMatchObject({ value: null, via: 'skipped' });
    expect(state.stepIndex).toBe(3);
  });
});

describe('validação conversacional (FR-010)', () => {
  it('resposta inválida não avança e pede correção em mensagem da Ava', () => {
    const { service } = makeService();
    seeded(service);
    // avança até email (9ª): responde chips puláveis
    service.skip('cargo');
    service.skip('setor');
    service.skip('tamanhoTime');
    service.skip('objetivo');
    service.skip('crm');
    service.skip('mercadoAlvo');
    const before = service.getState();
    const r = service.answer('email', 'sem-arroba', 'text');
    expect(r).toEqual({ ok: false, reason: 'INVALID_EMAIL' });
    const after = service.getState();
    expect(after.stepIndex).toBe(before.stepIndex);
    const last = after.messages[after.messages.length - 1];
    expect(last.from).toBe('ava');
    expect(last.text).not.toContain('erro');
  });

  it('answer em pergunta que não é a corrente é ignorado', () => {
    const { service } = makeService();
    const r = service.answer('email', 'ana@acme.com', 'text');
    expect(r.ok).toBe(false);
    expect(service.getState().stepIndex).toBe(0);
  });
});

describe('nome de empresa genérico (Edge Cases da spec)', () => {
  it('pergunta confirmação antes de aceitar nome genérico, sem avançar', () => {
    const { service } = makeService();
    service.answer('nome', 'Ana', 'text');
    const r = service.answer('empresa', 'Minha Empresa', 'text');
    expect(r).toEqual({ ok: true });
    const state = service.getState();
    expect(state.stepIndex).toBe(1); // não avançou
    expect(state.answers.empresa).toBeUndefined();
    const last = state.messages[state.messages.length - 1];
    expect(last.from).toBe('ava');
    expect(last.text).toContain('Minha Empresa');
  });

  it('reenvio do nome (confirmação) armazena e avança', () => {
    const { service } = makeService();
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Minha Empresa', 'text');
    const r = service.answer('empresa', 'Minha Empresa', 'text');
    expect(r).toEqual({ ok: true });
    const state = service.getState();
    expect(state.stepIndex).toBe(2);
    expect(state.answers.empresa).toMatchObject({ value: 'Minha Empresa' });
  });

  it('nome específico não pede confirmação', () => {
    const { service } = makeService();
    service.answer('nome', 'Ana', 'text');
    const r = service.answer('empresa', 'Acme Ltda', 'text');
    expect(r).toEqual({ ok: true });
    expect(service.getState().stepIndex).toBe(2);
  });
});

describe('reset', () => {
  it('volta ao estado inicial da conversa', () => {
    const { service } = makeService();
    seeded(service);
    service.skip('cargo');
    service.reset();
    const state = service.getState();
    expect(state.stepIndex).toBe(0);
    expect(Object.keys(state.answers)).toHaveLength(0);
    expect(state.completed).toBe(false);
  });
});

describe('ausência de I/O (contrato — invariante 1)', () => {
  it('answer/skip não tocam o storage; só a conclusão grava', () => {
    const { service, storage } = makeService();
    seeded(service);
    service.skip('cargo');
    service.skip('setor');
    expect(storage.calls.filter((c) => c.startsWith('set:'))).toHaveLength(0);
  });
});
