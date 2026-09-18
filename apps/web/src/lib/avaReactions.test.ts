import { describe, it, expect } from 'vitest';
import { reactionFor } from './avaReactions';
import { getQuestion } from './avaScript';

describe('reações de reconhecimento da Ava (D1/D8)', () => {
  it('toda pergunta tem pelo menos 2 reações possíveis', () => {
    for (const q of ['nome', 'empresa', 'cargo', 'setor', 'tamanhoTime', 'objetivo', 'crm', 'mercadoAlvo'] as const) {
      const reactions = reactionFor(q, 'Resposta', { firstName: 'Ana', companyName: 'Acme' });
      expect(reactions.length).toBeGreaterThanOrEqual(1);
      expect(reactions.poolSize).toBeGreaterThanOrEqual(2);
    }
  });

  it('interpola dado da resposta/próprio contexto', () => {
    const [first] = reactionFor('nome', 'Ana Silva', { firstName: undefined, companyName: 'Acme' });
    expect(first).toContain('Ana');
  });

  it('não repete o template usado imediatamente antes', () => {
    let previous: string | undefined;
    for (let i = 0; i < 30; i++) {
      const { text } = reactionFor('setor', 'Indústria', { firstName: 'Ana', companyName: 'Acme' }, previous ? [previous] : []);
      expect(text).not.toBe(previous);
      previous = text;
    }
  });

  it('pergunta de catálogo "Ainda não tenho" tem reação própria (FR-023)', () => {
    const { text } = reactionFor('catalogo', 'nao', { firstName: 'Ana', companyName: 'Acme' });
    expect(text.length).toBeGreaterThan(0);
  });

  it('usa o rótulo quando a resposta veio de chip conhecido', () => {
    const cargo = getQuestion('cargo');
    const { text } = reactionFor('cargo', cargo.options![0].value, { firstName: 'Ana', companyName: 'Acme' });
    expect(text).toContain(cargo.options![0].label);
  });
});
