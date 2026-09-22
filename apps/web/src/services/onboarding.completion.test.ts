/**
 * Testes de conclusão do onboarding (feature 008): a conversa sempre chega ao
 * fim — resumo, confirmação e resultado — independentemente do momento em que
 * a extração dos ativos resolve (Cenário 1 do quickstart.md).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createOnboardingService } from './onboarding';
import { pendingInteractionMessage } from '@/lib/avaScript';
import type { BusinessContext, ExtractionResponse } from '@/types/onboarding';

const CONTEXT: BusinessContext = {
  products: [{ name: 'Lawyer Agent', description: 'Geração de contratos jurídicos com IA' }],
  valueProposition: 'Contratos com IA para escritórios',
  businessModel: 'SaaS',
  differentiators: [],
  targetMarket: 'Serviços jurídicos',
  sources: ['site'],
  warnings: [],
};

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

/** Serviço com as 9 perguntas de conta já respondidas (site é a corrente). */
function serviceThroughEmail(extract: () => Promise<ExtractionResponse>) {
  const service = createOnboardingService({ storage: makeStorage(), extract });
  service.answer('nome', 'Ana', 'text');
  service.answer('empresa', 'LawyerAgent', 'text');
  service.skip('cargo');
  service.skip('setor');
  service.skip('tamanhoTime');
  service.skip('objetivo');
  service.skip('crm');
service.skip('mercadoAlvo');
service.skip('regioesInteresse');
  service.answer('email', 'ana@lawyeragent.com', 'text');
  return service;
}

describe('US1 — chegada tardia da extração não esconde a interação pendente', () => {
  it('confirmação "absorvi tudo" chega depois das perguntas 11/12: pergunta pendente segue acionável e o resumo é alcançado', async () => {
    let resolveExtract!: (r: ExtractionResponse) => void;
    const service = serviceThroughEmail(
      () =>
        new Promise<ExtractionResponse>((resolve) => {
          resolveExtract = resolve;
        })
    );

    // Pergunta 10 (site): resposta avança a conversa e a extração dispara.
    expect(service.answer('siteInstitucional', 'https://lawyeragent.com', 'text').ok).toBe(true);
    service.addUrlAsset('site', 'https://lawyeragent.com');
    const pending = service.extractBusinessContext();

    // A conversa segue (perguntas 11 e 12) enquanto a extração está em voo.
    expect(service.skip('materiais').ok).toBe(true);
    expect(service.getState().stepIndex).toBe(12); // catálogo pendente

    // A extração resolve TARDE — depois da pergunta 12 já ter sido feita.
    resolveExtract({ businessContext: CONTEXT, warnings: [] });
    await pending;

    const messages = service.getState().messages;
    const confirmationIndex = messages.findIndex((m) => m.text?.includes('Lawyer Agent'));
    expect(confirmationIndex).toBeGreaterThan(0);
    // Invariante I1: a pergunta pendente (catálogo) permanece a ÚLTIMA mensagem.
    const last = messages[messages.length - 1];
    expect(last.questionId).toBe('catalogo');
    expect(messages[confirmationIndex + 1].id).toBe(last.id);

    // A conversa termina: catálogo respondido → resumo → complete().
    expect(service.answer('catalogo', 'nao', 'chip').ok).toBe(true);
    const state = service.getState();
    expect(state.stepIndex).toBe(13);
    const result = service.complete();
    expect(result).not.toBeNull();
    expect(result?.companyName).toBe('LawyerAgent');
    expect(result?.businessContext?.products[0].name).toBe('Lawyer Agent');
  });

  it('anexos na pergunta de materiais mantêm o prompt de materiais como última interação', async () => {
    let resolveExtract!: (r: ExtractionResponse) => void;
    const service = serviceThroughEmail(
      () =>
        new Promise<ExtractionResponse>((resolve) => {
          resolveExtract = resolve;
        })
    );
    service.answer('siteInstitucional', 'https://lawyeragent.com', 'text');
    // Pergunta 11 (materiais): anexo dispara extração que resolve tarde.
    service.addFiles([{ name: 'pitch.pdf', size: 1000, type: 'application/pdf' } as File]);
    const pending = service.extractBusinessContext();
    resolveExtract({ businessContext: CONTEXT, warnings: [] });
    await pending;

    const messages = service.getState().messages;
    // Gate da UI (invariante do 008): a interação pendente de materiais segue
    // acionável via pendingInteractionMessage — recibos de anexo após o prompt
    // não a desativam; a confirmação tardia entra antes dela (I1).
    const pendingPrompt = pendingInteractionMessage(messages, 'materiais');
    expect(pendingPrompt?.questionId).toBe('materiais');
    const confirmationIndex = messages.findIndex((m) => m.text?.includes('Lawyer Agent'));
    expect(confirmationIndex).toBeGreaterThan(0);
    expect(confirmationIndex).toBeLessThan(messages.indexOf(pendingPrompt!));

    // O caminho "Pronto, seguir 📎" continua disponível e a conversa avança.
    expect(service.finishAttachments().ok).toBe(true);
    expect(service.getState().stepIndex).toBe(12);
  });
});

describe('US2 — teto de espera, descarte por época e settle (FR-004/FR-005)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('extração que estoura o teto: TIMEOUT, ativos failed, aviso conversacional e conversa segue', async () => {
    vi.useFakeTimers();
    const service = createOnboardingService({
      storage: makeStorage(),
      extractionTimeoutMs: 50,
      extract: () => new Promise<ExtractionResponse>(() => undefined),
    });
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    service.skip('cargo');
    service.skip('setor');
    service.skip('tamanhoTime');
    service.skip('objetivo');
    service.skip('crm');
service.skip('mercadoAlvo');
service.skip('regioesInteresse');
    service.answer('email', 'ana@acme.com', 'text');
    service.answer('siteInstitucional', 'https://acme.com', 'text');
    service.addUrlAsset('site', 'https://acme.com');

    const pending = service.extractBusinessContext();
    const advance = vi.advanceTimersByTimeAsync(50);
    const outcome = await pending;
    await advance;

    expect(outcome).toEqual({ ok: false, reason: 'TIMEOUT' });
    const state = service.getState();
    expect(state.assets[0]).toMatchObject({ status: 'failed', warning: 'EXTRACTION_TIMEOUT' });
    // Aviso conversacional inserido antes da interação pendente (materiais).
    const last = state.messages[state.messages.length - 1];
    expect(last.questionId).toBe('materiais');
    expect(state.messages[state.messages.length - 2].text).toContain('demorando');

    // A conversa segue normalmente até o resumo e conclui sem contexto.
    expect(service.skip('materiais').ok).toBe(true);
    expect(service.answer('catalogo', 'nao', 'chip').ok).toBe(true);
    expect(service.getState().stepIndex).toBe(13);
    const result = service.complete();
    expect(result).not.toBeNull();
    expect(result?.businessContext).toBeNull();
  });

  it('resultado do fetch que resolve após o timeout é descartado (nenhuma mutação)', async () => {
    vi.useFakeTimers();
    let resolveExtract!: (r: ExtractionResponse) => void;
    const service = createOnboardingService({
      storage: makeStorage(),
      extractionTimeoutMs: 50,
      extract: () =>
        new Promise<ExtractionResponse>((resolve) => {
          resolveExtract = resolve;
        }),
    });
    service.addUrlAsset('site', 'https://acme.com');
    const pending = service.extractBusinessContext();
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'TIMEOUT' });

    const before = service.getState();
    resolveExtract({ businessContext: CONTEXT, warnings: [] });
    await Promise.resolve();
    await Promise.resolve();

    const after = service.getState();
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.businessContext).toBe(before.businessContext);
    expect(after.assets).toEqual(before.assets);
  });

  it('complete() retorna null durante extração em voo e libera após o settle', async () => {
    let resolveExtract!: (r: ExtractionResponse) => void;
    const service = serviceThroughEmail(
      () =>
        new Promise<ExtractionResponse>((resolve) => {
          resolveExtract = resolve;
        })
    );
    service.answer('siteInstitucional', 'https://lawyeragent.com', 'text');
    service.addUrlAsset('site', 'https://lawyeragent.com');
    const pending = service.extractBusinessContext();
    service.skip('materiais');
    service.answer('catalogo', 'nao', 'chip');

    expect(service.complete()).toBeNull();

    resolveExtract({ businessContext: CONTEXT, warnings: [] });
    await pending;
    const result = service.complete();
    expect(result).not.toBeNull();
    expect(result?.businessContext?.products[0].name).toBe('Lawyer Agent');
  });

  it('época: extração mais recente supera a anterior — resultado da antiga é descartado', async () => {
    const resolvers: Array<(r: ExtractionResponse) => void> = [];
    const service = serviceThroughEmail(() => new Promise<ExtractionResponse>((resolve) => resolvers.push(resolve)));
    service.answer('siteInstitucional', 'https://lawyeragent.com', 'text');
    service.addUrlAsset('site', 'https://lawyeragent.com');

    const first = service.extractBusinessContext();
    const second = service.extractBusinessContext();
    expect(resolvers).toHaveLength(2);

    resolvers[1]({ businessContext: CONTEXT, warnings: [] });
    expect((await second).ok).toBe(true);
    expect(service.getState().businessContext?.products[0].name).toBe('Lawyer Agent');

    const before = service.getState();
    resolvers[0]({ businessContext: { ...CONTEXT, products: [{ name: 'ANTIGO', description: '' }] }, warnings: [] });
    await expect(first).resolves.toMatchObject({ ok: false, reason: 'SUPERSEDED' });
    expect(service.getState().businessContext?.products[0].name).toBe('Lawyer Agent');
    expect(service.getState().messages).toHaveLength(before.messages.length);
  });
});
