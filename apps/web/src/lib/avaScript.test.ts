import { describe, it, expect } from 'vitest';
import {
  AVA_QUESTIONS,
  INTRO_MESSAGE,
  FAREWELL_MESSAGE,
  correctionMessage,
  validateAnswer,
  validateUrlText,
  isSkippable,
  getQuestion,
  previousAnsweredQuestion,
  type PromptContext,
} from './avaScript';
import type { Answer, QuestionId } from '@/types/onboarding';

const EXPECTED_ORDER: QuestionId[] = [
  'nome',
  'empresa',
  'cargo',
  'setor',
  'tamanhoTime',
  'objetivo',
  'crm',
  'mercadoAlvo',
  'email',
  'siteInstitucional',
  'materiais',
  'catalogo',
];

const CTX: PromptContext = { firstName: 'Ana', companyName: 'Acme', email: 'ana@acme.com' };

describe('roteiro da Ava (FR-003)', () => {
  it('tem exatamente 12 perguntas na ordem definida', () => {
    expect(AVA_QUESTIONS).toHaveLength(12);
    expect(AVA_QUESTIONS.map((q) => q.id)).toEqual(EXPECTED_ORDER);
  });

  it('as 3 últimas perguntas são os ativos de negócio (10–12)', () => {
    expect(AVA_QUESTIONS[9].id).toBe('siteInstitucional');
    expect(AVA_QUESTIONS[10].id).toBe('materiais');
    expect(AVA_QUESTIONS[11].id).toBe('catalogo');
  });

  it('todas as perguntas têm prompt em texto', () => {
    for (const q of AVA_QUESTIONS) {
      expect(q.prompt(CTX).length).toBeGreaterThan(0);
    }
  });

  it('a apresentação se apresenta como Ava (FR-002)', () => {
    expect(INTRO_MESSAGE).toContain('Ava');
    expect(FAREWELL_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe('tipos de pergunta e chips (FR-004/FR-005)', () => {
  it('apenas mercadoAlvo é multi-select', () => {
    const multi = AVA_QUESTIONS.filter((q) => q.kind === 'multi-chips');
    expect(multi.map((q) => q.id)).toEqual(['mercadoAlvo']);
  });

  it('perguntas de escolha têm chips e opção "Outro" (FR-004/FR-006)', () => {
    const chipQuestions = AVA_QUESTIONS.filter((q) => q.kind === 'chips');
    expect(chipQuestions.map((q) => q.id)).toEqual(['cargo', 'setor', 'tamanhoTime', 'objetivo', 'crm']);
    for (const q of chipQuestions) {
      expect(q.options!.length).toBeGreaterThanOrEqual(3);
      expect(q.allowOther).toBe(true);
    }
  });

  it('mercadoAlvo também aceita "Outro"', () => {
    const mercado = getQuestion('mercadoAlvo');
    expect(mercado.allowOther).toBe(true);
    expect(mercado.options!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('obrigatoriedade e skip (FR-010/FR-011)', () => {
  it('apenas nome, empresa e email são obrigatórias', () => {
    const required = AVA_QUESTIONS.filter((q) => q.required).map((q) => q.id);
    expect(required).toEqual(['nome', 'empresa', 'email']);
  });

  it('obrigatórias não são puláveis; as demais são', () => {
    for (const q of AVA_QUESTIONS) {
      expect(isSkippable(q)).toBe(!q.required);
    }
  });
});

describe('correção retroativa durante a conversa (FR-012)', () => {
  const answer = (id: QuestionId): Answer => ({ questionId: id, value: 'x', via: 'text', answeredAt: 0 });

  it('retorna a última pergunta respondida antes da corrente', () => {
    const answers = { nome: answer('nome'), empresa: answer('empresa') };
    expect(previousAnsweredQuestion(3, answers)).toBe('empresa');
    // respondendo 'empresa' (índice 1), o alvo é 'nome'
    expect(previousAnsweredQuestion(1, answers)).toBe('nome');
  });

  it('sem nenhuma resposta anterior retorna null', () => {
    expect(previousAnsweredQuestion(0, {})).toBeNull();
    expect(previousAnsweredQuestion(1, {})).toBeNull();
  });

  it('na fase de resumo (stepIndex 12) aponta para a última respondida', () => {
    const answers = { nome: answer('nome'), empresa: answer('empresa'), catalogo: answer('catalogo') };
    expect(previousAnsweredQuestion(12, answers)).toBe('catalogo');
  });

  it('ignora respostas de perguntas à frente do passo corrente', () => {
    const answers = { nome: answer('nome'), email: answer('email') };
    expect(previousAnsweredQuestion(2, answers)).toBe('nome');
  });
});

describe('validação conversacional (FR-010)', () => {
  it('rejeita nome/empresa vazios', () => {
    expect(validateAnswer(getQuestion('nome'), '   ')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateAnswer(getQuestion('empresa'), '')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('aceita nome/empresa preenchidos', () => {
    expect(validateAnswer(getQuestion('nome'), 'Ana')).toEqual({ ok: true });
    expect(validateAnswer(getQuestion('empresa'), '  Acme Ltda ')).toEqual({ ok: true });
  });

  it('rejeita e-mail malformado e aceita válido', () => {
    expect(validateAnswer(getQuestion('email'), 'sem-arroba')).toEqual({ ok: false, reason: 'INVALID_EMAIL' });
    expect(validateAnswer(getQuestion('email'), 'ana@acme.com.br')).toEqual({ ok: true });
  });

  it('valida URL de site/catálogo', () => {
    expect(validateAnswer(getQuestion('siteInstitucional'), 'example.com')).toEqual({ ok: false, reason: 'INVALID_URL' });
    expect(validateAnswer(getQuestion('siteInstitucional'), 'https://acme.com')).toEqual({ ok: true });
  });

  it('valida URL solta (follow-up do catálogo — FR-023)', () => {
    expect(validateUrlText('acme.com/catalogo')).toEqual({ ok: false, reason: 'INVALID_URL' });
    expect(validateUrlText('https://acme.com/catalogo')).toEqual({ ok: true });
  });

  it('chips aceitam opção conhecida e texto livre como "Outro" (FR-006)', () => {
    expect(validateAnswer(getQuestion('setor'), 'Indústria')).toEqual({ ok: true });
    // Texto livre é o caminho do "Outro" — sempre aceito quando não vazio.
    expect(validateAnswer(getQuestion('setor'), 'Navegação interplanetária')).toEqual({ ok: true });
    expect(validateAnswer(getQuestion('setor'), '   ')).toEqual({ ok: false, reason: 'INVALID_OPTION' });
  });

  it('multi-select exige ao menos uma seleção', () => {
    expect(validateAnswer(getQuestion('mercadoAlvo'), [])).toEqual({ ok: false, reason: 'EMPTY_SELECTION' });
    expect(validateAnswer(getQuestion('mercadoAlvo'), ['Pequenas empresas', 'Médias empresas'])).toEqual({ ok: true });
  });

  it('mensagens de correção são conversacionais, nunca técnicas', () => {
    const msg = correctionMessage(getQuestion('email'), 'INVALID_EMAIL');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.toLowerCase()).not.toContain('erro');
  });
});
