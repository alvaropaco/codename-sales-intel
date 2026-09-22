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
  SUMMARY_LABELS,
  insertBeforePendingInteraction,
  pendingInteractionMessage,
  type PromptContext,
} from './avaScript';
import type { Answer, ChatMessage, QuestionId } from '@/types/onboarding';

const EXPECTED_ORDER: QuestionId[] = [
  'nome',
  'empresa',
  'cargo',
  'setor',
  'tamanhoTime',
  'objetivo',
  'crm',
  'mercadoAlvo',
  'regioesInteresse',
  'email',
  'siteInstitucional',
  'materiais',
  'catalogo',
];

const CTX: PromptContext = { firstName: 'Ana', companyName: 'Acme', email: 'ana@acme.com' };

describe('roteiro da Ava (FR-003)', () => {
  it('tem exatamente 13 perguntas na ordem definida (009: + região)', () => {
    expect(AVA_QUESTIONS).toHaveLength(13);
    expect(AVA_QUESTIONS.map((q) => q.id)).toEqual(EXPECTED_ORDER);
  });

  it('as 3 últimas perguntas são os ativos de negócio (11–13) e email é a 10ª', () => {
    expect(AVA_QUESTIONS[8].id).toBe('regioesInteresse');
    expect(AVA_QUESTIONS[9].id).toBe('email');
    expect(AVA_QUESTIONS[10].id).toBe('siteInstitucional');
    expect(AVA_QUESTIONS[11].id).toBe('materiais');
    expect(AVA_QUESTIONS[12].id).toBe('catalogo');
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
  it('mercadoAlvo e regioesInteresse são multi-select (009)', () => {
    const multi = AVA_QUESTIONS.filter((q) => q.kind === 'multi-chips');
    expect(multi.map((q) => q.id)).toEqual(['mercadoAlvo', 'regioesInteresse']);
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

  it('na fase de resumo (stepIndex 13) aponta para a última respondida', () => {
    const answers = { nome: answer('nome'), empresa: answer('empresa'), catalogo: answer('catalogo') };
    expect(previousAnsweredQuestion(13, answers)).toBe('catalogo');
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

describe('insertBeforePendingInteraction (008 — invariante I1)', () => {
  const question = (id: QuestionId, text = 'pergunta'): ChatMessage => ({
    id: `q-${id}`,
    from: 'ava',
    kind: 'input',
    text,
    questionId: id,
  });
  const status = (id: string, text = 'Pronto, absorvi tudo! 🧠'): ChatMessage => ({
    id,
    from: 'ava',
    kind: 'text',
    text,
  });

  it('insere mensagem de status antes da pergunta pendente (chegada tardia)', () => {
    const messages = [question('nome'), question('materiais'), question('catalogo')];
    const out = insertBeforePendingInteraction(messages, status('s1'));
    expect(out.map((m) => m.id)).toEqual(['q-nome', 'q-materiais', 's1', 'q-catalogo']);
    // A pergunta pendente permanece a última mensagem do transcript.
    expect(out[out.length - 1].questionId).toBe('catalogo');
  });

  it('insere antes do marcador de resumo quando não há mais perguntas', () => {
    const summary: ChatMessage = { id: 'sum', from: 'ava', kind: 'summary', text: null };
    const out = insertBeforePendingInteraction([question('catalogo'), summary], status('s1'));
    expect(out.map((m) => m.id)).toEqual(['q-catalogo', 's1', 'sum']);
  });

  it('anexa no fim quando não há interação pendente', () => {
    const out = insertBeforePendingInteraction([status('s0')], status('s1'));
    expect(out.map((m) => m.id)).toEqual(['s0', 's1']);
  });

  it('é imutável — array e entradas de origem preservados', () => {
    const messages = [question('nome'), question('materiais')];
    const copy = [...messages];
    const message = status('s1');
    const out = insertBeforePendingInteraction(messages, message);
    expect(messages).toEqual(copy);
    expect(out).not.toBe(messages);
    expect(out[1]).toBe(message);
  });
});

describe('pendingInteractionMessage (008 — gate da UI)', () => {
  const question = (id: QuestionId): ChatMessage => ({
    id: `q-${id}`,
    from: 'ava',
    kind: 'input',
    text: 'pergunta',
    questionId: id,
  });

  it('retorna a mensagem da pergunta pendente mesmo com status depois dela', () => {
    const messages: ChatMessage[] = [question('materiais'), question('catalogo'), { id: 's1', from: 'ava', kind: 'text', text: 'absorvi' }];
    expect(pendingInteractionMessage(messages, 'catalogo')?.id).toBe('q-catalogo');
  });

  it('retorna null quando a pergunta não está no transcript', () => {
    expect(pendingInteractionMessage([question('nome')], 'catalogo')).toBeNull();
    expect(pendingInteractionMessage([], 'nome')).toBeNull();
  });
});

describe('pergunta de região de interesse (009 — FR-006/007/008)', () => {
  it('é a 9ª pergunta: multi-chips, pulável, com Outro e exclusiva todo-brasil', () => {
    const q = getQuestion('regioesInteresse');
    expect(q.order).toBe(9);
    expect(q.kind).toBe('multi-chips');
    expect(q.required).toBe(false);
    expect(q.allowOther).toBe(true);
    expect(q.exclusiveValue).toBe('todo-brasil');
    const values = (q.options ?? []).map((o) => o.value);
    expect(values).toEqual(['todo-brasil', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']);
  });

  it('summary labels incluem a região e cobrem as 13 perguntas', () => {
    expect(SUMMARY_LABELS.regioesInteresse).toBe('Regiões de interesse');
    expect(Object.keys(SUMMARY_LABELS)).toHaveLength(13);
  });

  it('valida seleção múltipla de regiões (não vazia)', () => {
    const q = getQuestion('regioesInteresse');
    expect(validateAnswer(q, [])).toEqual({ ok: false, reason: 'EMPTY_SELECTION' });
    expect(validateAnswer(q, ['Sudeste', 'Sul'])).toEqual({ ok: true });
    expect(validateAnswer(q, ['todo-brasil'])).toEqual({ ok: true });
  });
});
