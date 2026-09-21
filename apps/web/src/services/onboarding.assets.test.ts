import { describe, it, expect, beforeEach } from 'vitest';
import { createOnboardingService } from './onboarding';
import { pendingInteractionMessage } from '@/lib/avaScript';
import type { BusinessContext } from '@/types/onboarding';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

function makeFile(name: string, size: number, mime: string): File {
  // File do DOM não existe em ambiente node — o serviço só lê name/size/type.
  return { name, size, type: mime } as unknown as File;
}

const PDF_MIME = 'application/pdf';

describe('ativos de negócio: URLs (FR-021/FR-023)', () => {
  it('addUrlAsset valida http(s) e cria o ativo', () => {
    const service = createOnboardingService({ storage: makeStorage() });
    expect(service.addUrlAsset('site', 'acme.com')).toEqual({ ok: false, reason: 'INVALID_URL' });
    const r = service.addUrlAsset('site', 'https://acme.com');
    expect(r.ok).toBe(true);
    expect(service.getState().assets[0]).toMatchObject({ type: 'site', url: 'https://acme.com', status: 'pending' });
  });

  it('um único ativo por tipo: reenvio substitui', () => {
    const service = createOnboardingService({ storage: makeStorage() });
    service.addUrlAsset('site', 'https://acme.com');
    service.addUrlAsset('site', 'https://acme.com.br');
    const sites = service.getState().assets.filter((a) => a.type === 'site');
    expect(sites).toHaveLength(1);
    expect(sites[0].url).toBe('https://acme.com.br');
  });
});

describe('ativos de negócio: arquivos (FR-022/FR-026)', () => {
  it('aceita PDF/TXT/DOCX/PPTX e recusa formato e tamanho fora do limite', () => {
    const service = createOnboardingService({ storage: makeStorage() });
    const { accepted, rejected } = service.addFiles([
      makeFile('pitch.pdf', 1000, PDF_MIME),
      makeFile('video.mp4', 1000, 'video/mp4'),
      makeFile('gigante.pdf', 21 * 1024 * 1024, PDF_MIME),
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toContain('formato');
    expect(rejected[1].reason).toContain('20 MB');
  });

  it('limite de 5 arquivos: o 6º é recusado', () => {
    const service = createOnboardingService({ storage: makeStorage() });
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.pdf`, 10, PDF_MIME));
    const { accepted, rejected } = service.addFiles(files);
    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(1);
  });
});

describe('extração durante a conversa (FR-024)', () => {
  const CONTEXT: BusinessContext = {
    products: [{ name: 'Máquina X', description: 'CNC industrial' }],
    valueProposition: 'Precisão industrial',
    businessModel: 'Venda direta',
    differentiators: ['Suporte 24h'],
    targetMarket: 'Indústria',
    sources: ['document'],
    warnings: [],
  };

  let service: ReturnType<typeof createOnboardingService>;
  let extractCalls: number;

  beforeEach(() => {
    extractCalls = 0;
    service = createOnboardingService({
      storage: makeStorage(),
      extract: async () => {
        extractCalls += 1;
        return { businessContext: CONTEXT, warnings: [] };
      },
    });
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    service.skip('cargo');
    service.skip('setor');
    service.skip('tamanhoTime');
    service.skip('objetivo');
    service.skip('crm');
    service.skip('mercadoAlvo');
    service.answer('email', 'ana@acme.com', 'text');
    service.addUrlAsset('site', 'https://acme.com');
    service.addFiles([makeFile('pitch.pdf', 1000, PDF_MIME)]);
  });

  it('extrai e a Ava confirma o que absorveu na conversa', async () => {
    const outcome = await service.extractBusinessContext();
    expect(outcome).toMatchObject({ ok: true });
    expect(extractCalls).toBe(1);
    const state = service.getState();
    expect(state.businessContext?.products[0].name).toBe('Máquina X');
    expect(state.assets.every((a) => a.status === 'extracted')).toBe(true);
    // 008 — invariante I1: a confirmação entra ANTES da interação pendente
    // (site institucional), que permanece a última acionável.
    const confirmation = state.messages.find((m) => m.text?.includes('Máquina X'));
    expect(confirmation?.from).toBe('ava');
    const pendingPrompt = pendingInteractionMessage(state.messages, 'siteInstitucional');
    expect(pendingPrompt?.questionId).toBe('siteInstitucional');
    expect(state.messages.indexOf(confirmation!)).toBeLessThan(state.messages.indexOf(pendingPrompt!));
  });

  it('sem ativos pendentes não chama o endpoint', async () => {
    const fresh = createOnboardingService({ storage: makeStorage(), extract: async () => ({ businessContext: CONTEXT, warnings: [] }) });
    const outcome = await fresh.extractBusinessContext();
    expect(outcome).toEqual({ ok: false, reason: 'NOTHING_TO_EXTRACT' });
  });

  it('falha de rede → status failed + aviso conversacional, conversa segue', async () => {
    const failing = createOnboardingService({
      storage: makeStorage(),
      extract: async () => {
        throw new Error('rede caiu');
      },
    });
    failing.addUrlAsset('site', 'https://acme.com');
    const outcome = await failing.extractBusinessContext();
    expect(outcome).toEqual({ ok: false, reason: 'REQUEST_FAILED' });
    expect(failing.getState().assets[0].status).toBe('failed');
    const last = failing.getState().messages[failing.getState().messages.length - 1];
    expect(last.from).toBe('ava');
  });

  it('payload enviado ao endpoint inclui URLs e arquivos pendentes', async () => {
    let captured: unknown;
    const spy = createOnboardingService({
      storage: makeStorage(),
      extract: async (payload) => {
        captured = payload;
        return { businessContext: CONTEXT, warnings: [] };
      },
    });
    spy.addUrlAsset('site', 'https://acme.com');
    spy.addFiles([makeFile('pitch.pdf', 1000, PDF_MIME)]);
    await spy.extractBusinessContext();
    expect(captured).toMatchObject({ siteUrl: 'https://acme.com', catalogUrl: null });
    expect((captured as { files: unknown[] }).files).toHaveLength(1);
  });
});

describe('revisar descarta ativos das perguntas posteriores (FR-014)', () => {
  it('revise para antes do site remove os ativos de negócio', () => {
    const service = createOnboardingService({ storage: makeStorage() });
    service.answer('nome', 'Ana', 'text');
    service.answer('empresa', 'Acme', 'text');
    service.addUrlAsset('site', 'https://acme.com');
    service.addFiles([makeFile('pitch.pdf', 1000, PDF_MIME)]);
    service.revise('nome');
    expect(service.getState().assets).toHaveLength(0);
  });
});
