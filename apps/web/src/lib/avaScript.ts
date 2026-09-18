/**
 * avaScript.ts — roteiro determinístico da conversa de onboarding com a Ava
 * (feature 004). Dado puro, sem React: ordem das 12 perguntas (FR-003), chips
 * (FR-004/FR-005), obrigatórias (FR-010/FR-011), validação conversacional e
 * textos da persona (FR-002). Decisões D1/D10 de specs/004-ai-onboarding/research.md.
 */

import type { ChipOption, QuestionId, ValidationReason } from '@/types/onboarding';

/** Contexto disponível para interpolação nos prompts (respostas anteriores + sessão). */
export interface PromptContext {
  firstName?: string;
  companyName?: string;
  email?: string;
}

export type QuestionKind = 'text' | 'email' | 'chips' | 'multi-chips' | 'url' | 'attachments' | 'yesno';

export interface AvaQuestion {
  id: QuestionId;
  /** 1-based, na ordem do FR-003. */
  order: number;
  prompt: (ctx: PromptContext) => string;
  kind: QuestionKind;
  options?: ChipOption[];
  required: boolean;
  /** Chips oferecem "Outro" com texto livre (FR-006). */
  allowOther?: boolean;
  /** Pergunta sim/não com follow-up de URL (catálogo: FR-023). */
  yesOption?: ChipOption;
  noOption?: ChipOption;
  /** Mensagem pedindo a URL depois do "sim" (catálogo). */
  urlFollowUpPrompt?: (ctx: PromptContext) => string;
  placeholder?: string;
}

export const INTRO_MESSAGE =
  'Oi! Eu sou a **Ava**, a inteligência que configura o B2Base pra você. ' +
  'Esqueça formulários: são só algumas perguntas rápidas e sua conta nasce ' +
  'do seu jeito. Vamos começar?';

export const FAREWELL_MESSAGE =
  'Perfeito, tá tudo anotado! ✨ Sua conta já está configurada com o que me ' +
  'contou. Vou te levar pro seu dashboard — qualquer coisa, é só me chamar.';

export const SKIP_LABEL = 'Prefiro não responder';
export const OTHER_LABEL = 'Outro';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const OTHER: ChipOption = { value: '__other__', label: OTHER_LABEL };

function validText(value: string | string[]): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEmail(value: string | string[]): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function validUrl(value: string | string[]): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function inOptions(question: AvaQuestion, value: string | string[]): boolean {
  if (typeof value !== 'string') return false;
  return Boolean(question.options?.some((o) => o.value === value));
}

export function getQuestion(id: QuestionId): AvaQuestion {
  const q = AVA_QUESTIONS.find((item) => item.id === id);
  if (!q) throw new Error(`pergunta desconhecida: ${id}`);
  return q;
}

export function isSkippable(question: AvaQuestion): boolean {
  return !question.required;
}

/** Valida uma URL solta (usada no follow-up do catálogo — FR-023). Pura. */
export function validateUrlText(
  value: string | string[]
): { ok: true } | { ok: false; reason: ValidationReason } {
  return validUrl(value) ? { ok: true } : { ok: false, reason: 'INVALID_URL' };
}

/**
 * Última pergunta já respondida antes do passo corrente — alvo da ação
 * "corrigir resposta anterior" (FR-012). Pura; ignora respostas de passos à
 * frente (revise os descartaria indevidamente).
 */
export function previousAnsweredQuestion(
  stepIndex: number,
  answers: Partial<Record<QuestionId, unknown>>
): QuestionId | null {
  for (let i = Math.min(Math.max(stepIndex, 0), AVA_QUESTIONS.length) - 1; i >= 0; i--) {
    const id = AVA_QUESTIONS[i].id;
    if (answers[id]) return id;
  }
  return null;
}

/** Valida uma resposta para a pergunta (FR-010). Pura. */
export function validateAnswer(
  question: AvaQuestion,
  value: string | string[]
): { ok: true } | { ok: false; reason: ValidationReason } {
  switch (question.kind) {
    case 'text':
    case 'email':
      if (!validText(value)) return { ok: false, reason: 'EMPTY' };
      if (question.kind === 'email' && !validEmail(value)) return { ok: false, reason: 'INVALID_EMAIL' };
      return { ok: true };
    case 'url':
      return validUrl(value) ? { ok: true } : { ok: false, reason: 'INVALID_URL' };
    case 'chips':
      return inOptions(question, value) || validText(value)
        ? { ok: true }
        : { ok: false, reason: 'INVALID_OPTION' };
    case 'multi-chips': {
      if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'EMPTY_SELECTION' };
      const known = question.options?.map((o) => o.value) ?? [];
      const okAll = value.every((v) => known.includes(v) || v.trim().length > 0);
      return okAll ? { ok: true } : { ok: false, reason: 'INVALID_OPTION' };
    }
    case 'yesno':
      return value === 'sim' || value === 'nao' ? { ok: true } : { ok: false, reason: 'INVALID_OPTION' };
    case 'attachments':
      return { ok: true };
  }
}

/** Correção pedida em linguagem natural — nunca mensagem de erro técnica (FR-010). */
export function correctionMessage(question: AvaQuestion, reason: ValidationReason): string {
  switch (reason) {
    case 'EMPTY':
      return 'Essa aí eu preciso saber pra configurar sua conta 🙂 Pode me dizer?';
    case 'INVALID_EMAIL':
      return 'Hmm, esse e-mail parece incompleto — confere pra mim? Alguém@empresa.com, por exemplo.';
    case 'INVALID_URL':
      return 'Esse endereço não parece um link válido. Pode conferir? (ex.: https://suaempresa.com.br)';
    case 'EMPTY_SELECTION':
      return 'Escolhe pelo menos uma opção aí em cima — ou me conta do seu jeito 😉';
    case 'INVALID_OPTION':
      return 'Não entendi essa opção — pode escolher um dos botões ou escrever do seu jeito?';
  }
}

/**
 * O roteiro completo — 12 perguntas na ordem do FR-003.
 * 1–9: configuração da conta. 10–12: ativos de negócio (User Story 5).
 */
export const AVA_QUESTIONS: AvaQuestion[] = [
  {
    id: 'nome',
    order: 1,
    prompt: () => 'Pra começar: como você se chama?',
    kind: 'text',
    required: true,
    placeholder: 'Seu nome',
  },
  {
    id: 'empresa',
    order: 2,
    prompt: (ctx) => `Um prazer, ${ctx.firstName || 'tudo bem'}! 😄 E qual é o nome da empresa onde você trabalha?`,
    kind: 'text',
    required: true,
    placeholder: 'Nome da empresa',
  },
  {
    id: 'cargo',
    order: 3,
    prompt: () => 'E o seu cargo por lá?',
    kind: 'chips',
    required: false,
    allowOther: true,
    options: [
      { value: 'Fundador/CEO', label: 'Fundador/CEO' },
      { value: 'Comercial/Vendas', label: 'Comercial/Vendas' },
      { value: 'Marketing', label: 'Marketing' },
      { value: 'Operações', label: 'Operações' },
    ],
  },
  {
    id: 'setor',
    order: 4,
    prompt: (ctx) => `Em qual setor a ${ctx.companyName || 'sua empresa'} atua?`,
    kind: 'chips',
    required: false,
    allowOther: true,
    options: [
      { value: 'Tecnologia/SaaS', label: 'Tecnologia/SaaS' },
      { value: 'Serviços', label: 'Serviços' },
      { value: 'Indústria', label: 'Indústria' },
      { value: 'Varejo/E-commerce', label: 'Varejo/E-commerce' },
      { value: 'Saúde', label: 'Saúde' },
      { value: 'Educação', label: 'Educação' },
      { value: 'Serviços financeiros', label: 'Serviços financeiros' },
      { value: 'Imobiliário', label: 'Imobiliário' },
    ],
  },
  {
    id: 'tamanhoTime',
    order: 5,
    prompt: (ctx) => `E qual é o tamanho do time comercial da ${ctx.companyName || 'empresa'}?`,
    kind: 'chips',
    required: false,
    allowOther: true,
    options: [
      { value: 'Só eu', label: 'Só eu' },
      { value: '2–5', label: '2–5' },
      { value: '6–20', label: '6–20' },
      { value: '21–50', label: '21–50' },
      { value: '51+', label: '51+' },
    ],
  },
  {
    id: 'objetivo',
    order: 6,
    prompt: () => 'E me conta: o que te trouxe pro B2Base? O que você mais quer conquistar agora?',
    kind: 'chips',
    required: false,
    allowOther: true,
    options: [
      { value: 'Gerar mais leads', label: 'Gerar mais leads' },
      { value: 'Automatizar prospecção', label: 'Automatizar prospecção' },
      { value: 'Enriquecer minha base', label: 'Enriquecer minha base' },
      { value: 'Fechar mais vendas', label: 'Fechar mais vendas' },
      { value: 'Organizar meus contatos', label: 'Organizar meus contatos' },
    ],
  },
  {
    id: 'crm',
    order: 7,
    prompt: () => 'Você já usa algum CRM hoje?',
    kind: 'chips',
    required: false,
    allowOther: true,
    options: [
      { value: '__none__', label: 'Ainda não uso' },
      { value: 'Pipedrive', label: 'Pipedrive' },
      { value: 'HubSpot', label: 'HubSpot' },
      { value: 'RD Station', label: 'RD Station' },
      { value: 'Salesforce', label: 'Salesforce' },
      { value: 'Kommo', label: 'Kommo' },
    ],
  },
  {
    id: 'mercadoAlvo',
    order: 8,
    prompt: (ctx) =>
      `Qual é o mercado-alvo da ${ctx.companyName || 'empresa'}? Pode escolher mais de um.`,
    kind: 'multi-chips',
    required: false,
    allowOther: true,
    options: [
      { value: 'Pequenas empresas', label: 'Pequenas empresas' },
      { value: 'Médias empresas', label: 'Médias empresas' },
      { value: 'Grandes empresas', label: 'Grandes empresas' },
      { value: 'Consumidor final (B2C)', label: 'Consumidor final (B2C)' },
      { value: 'Órgãos públicos', label: 'Órgãos públicos' },
    ],
  },
  {
    id: 'email',
    order: 9,
    prompt: (ctx) =>
      `Qual e-mail você usa no dia a dia${ctx.email ? ` (confirmando: ${ctx.email}?)` : '?'} É por ele que a gente conecta tudo por aqui.`,
    kind: 'email',
    required: true,
    placeholder: 'voce@suaempresa.com',
  },
  {
    id: 'siteInstitucional',
    order: 10,
    prompt: (ctx) =>
      `Agora sobre a ${ctx.companyName || 'empresa'}: qual é o site institucional de vocês? Eu dou uma lida e aprendo sobre o negócio. (se não tiver, pode pular)`,
    kind: 'url',
    required: false,
    placeholder: 'https://suaempresa.com.br',
  },
  {
    id: 'materiais',
    order: 11,
    prompt: () =>
      'Se você tiver materiais de apresentação — pitch deck, apresentação, PDFs, documentos — anexa aqui. Eu leio tudo e aprendo o que vocês vendem. 📎',
    kind: 'attachments',
    required: false,
  },
  {
    id: 'catalogo',
    order: 12,
    prompt: () => 'E por último: vocês têm um catálogo de produtos online?',
    kind: 'yesno',
    required: false,
    yesOption: { value: 'sim', label: 'Tenho catálogo online' },
    noOption: { value: 'nao', label: 'Ainda não tenho' },
    urlFollowUpPrompt: () => 'Manda o endereço do catálogo que eu dou uma olhada 👀',
  },
];

/** Rótulos do resumo final (FR-013). */
export const SUMMARY_LABELS: Record<QuestionId, string> = {
  nome: 'Nome',
  empresa: 'Empresa',
  cargo: 'Cargo',
  setor: 'Setor',
  tamanhoTime: 'Tamanho do time',
  objetivo: 'Objetivo principal',
  crm: 'CRM em uso',
  mercadoAlvo: 'Mercado-alvo',
  email: 'E-mail',
  siteInstitucional: 'Site institucional',
  materiais: 'Materiais enviados',
  catalogo: 'Catálogo de produtos',
};

export { OTHER as OTHER_OPTION };
