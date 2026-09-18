/**
 * avaReactions.ts — reações de reconhecimento da Ava entre respostas (feature 004).
 * Templates variados com interpolação (decisão D1 do research.md): sensação de
 * IA real sem custo de LLM no loop — o "···" + variação de template entregam o
 * pacing (FR-009/D8). Nunca repete o template imediatamente anterior.
 */

import { getQuestion } from './avaScript';
import type { QuestionId } from '@/types/onboarding';

export interface ReactionContext {
  firstName?: string;
  companyName?: string;
}

const POOLS: Partial<Record<QuestionId, string[]>> = {
  nome: ['Prazer, {nome}! 😄', 'Que bom te conhecer, {nome}!', 'Anotado, {nome}!'],
  empresa: [
    '{empresa} então — anotado! ✅',
    'A {empresa} já está no mapa por aqui.',
    'Ótimo ter a {empresa} no B2Base!',
  ],
  cargo: [
    '{resposta}, entendido — isso ajuda muito no contexto.',
    'Feito! {resposta} por aqui 👏',
    'Anotado: {resposta}.',
  ],
  setor: [
    '{resposta}, ótimo — já sei por onde procurar.',
    'Setor {resposta}: anotado ✅',
    '{resposta} combina bastante com a base que temos aqui.',
  ],
  tamanhoTime: [
    'Time de {resposta}, show.',
    'Anotado: {resposta} no time comercial.',
    '{resposta} — entendido!',
  ],
  objetivo: [
    '"{resposta}" — é exatamente o que a gente resolve 💪',
    'Objetivo claro: {resposta}. Vou configurar tudo nessa direção.',
    'Anotado! {resposta} vai guiar suas recomendações por aqui.',
  ],
  crm: [
    '{resposta}: depois dá pra conectar com o B2Base 🔗',
    '{resposta} anotado — vou deixar sinalizado na sua plataforma.',
    'Boa, {resposta} registrado.',
  ],
  mercadoAlvo: [
    '{resposta} — público anotado 🎯',
    'Entendido, foco em {resposta}.',
    '{resposta}: vou calibrar as recomendações com isso.',
  ],
  catalogo: [
    'Catálogo online: perfeito, vou dar uma olhada 👀',
    'Catálogo anotado — produtos aprendidos ficam guardados pra prospecção.',
  ],
};

const GENERIC = ['Boa! 👍', 'Anotado ✅', 'Entendido!'];

/** Eco legível da resposta (rótulo do chip quando houver). */
function echoLabel(questionId: QuestionId, value: string | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  const question = getQuestion(questionId);
  const option = question.options?.find((o) => o.value === value);
  return option ? option.label : value;
}

function fill(template: string, ctx: ReactionContext, resposta: string): string {
  const nome = ctx.firstName || resposta.split(' ')[0] || 'tudo bem';
  const empresa = ctx.companyName || 'sua empresa';
  return template
    .replace(/\{nome\}/g, nome)
    .replace(/\{empresa\}/g, empresa)
    .replace(/\{resposta\}/g, resposta);
}

/**
 * Escolhe uma reação para a resposta dada. `avoid` lista textos a não repetir
 * (o chamador passa o imediatamente anterior — nunca repete em sequência).
 * Retorna o pool de candidatos (array), com `text` = escolhida e `poolSize`.
 */
export function reactionFor(
  questionId: QuestionId,
  value: string | string[],
  ctx: ReactionContext = {},
  avoid: string[] = []
): string[] & { text: string; poolSize: number } {
  const resposta = echoLabel(questionId, value);
  const pool = POOLS[questionId] ?? GENERIC;
  const candidates = pool.map((t) => fill(t, ctx, resposta));
  const available = candidates.filter((t) => !avoid.includes(t));
  const source = available.length ? available : candidates;
  const text = source[Math.floor(Math.random() * source.length)];
  const result = candidates.slice() as string[] & { text: string; poolSize: number };
  result.text = text;
  result.poolSize = pool.length;
  return result;
}
