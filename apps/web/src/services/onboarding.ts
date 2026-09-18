/**
 * services/onboarding.ts — FRONTEIRA ÚNICA de serviço do onboarding conversacional
 * (feature 004). Implementação v1 em memória + storage injetável (sessionStorage
 * na produção); a troca por um client HTTP na integração real não muda telas
 * (FR-018). Contrato: specs/004-ai-onboarding/contracts/frontend-service.md.
 *
 * Invariante 1: answer/skip/revise não fazem I/O — só complete() (storage) e
 * extractBusinessContext() (fetch) tocam o mundo exterior.
 */

import {
  AVA_QUESTIONS,
  INTRO_MESSAGE,
  SKIP_LABEL,
  correctionMessage,
  getQuestion,
  isSkippable,
  validateAnswer,
  validateUrlText,
  type AvaQuestion,
  type PromptContext,
} from '@/lib/avaScript';
import type {
  AddFilesResult,
  Answer,
  AnswerResult,
  BusinessAsset,
  ChatMessage,
  ExtractionOutcome,
  ExtractionPayload,
  ExtractionResponse,
  OnboardingResult,
  OnboardingState,
  QuestionId,
  ValidationReason,
} from '@/types/onboarding';

export const DONE_STORAGE_KEY = 'b2base.avaOnboardingDone';

/** Limites de materiais (Assumptions da spec): 5 arquivos × 20 MB, formatos legíveis. */
export const MAX_DOCUMENTS = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const ACCEPTED_DOC_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** Cliente HTTP padrão do endpoint stateless de extração (contracts/http-api.md). */
async function defaultExtract(payload: ExtractionPayload): Promise<ExtractionResponse> {
  const form = new FormData();
  if (payload.siteUrl) form.append('siteUrl', payload.siteUrl);
  if (payload.catalogUrl) form.append('catalogUrl', payload.catalogUrl);
  for (const file of payload.files) form.append('files', file, file.name);
  const res = await fetch('/api/onboarding/ava/extract', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const code = json && json.error && json.error.code ? json.error.code : `HTTP_${res.status}`;
    throw new Error(code);
  }
  return {
    businessContext: (json.data && json.data.businessContext) || null,
    warnings: (json.data && json.data.warnings) || [],
  };
}

export interface OnboardingServiceDeps {
  /** sessionStorage na produção; fake nos testes (invariante de I/O). */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Dados já conhecidos da conta — pré-preenchimento (FR-008). */
  prefill?: PromptContext;
  /** Cliente de extração injetável (testes); default: POST ao endpoint. */
  extract?: (payload: ExtractionPayload) => Promise<ExtractionResponse>;
}

let assetSeq = 0;

function nextAssetId(): string {
  assetSeq += 1;
  return `asset-${assetSeq}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

let messageSeq = 0;

/**
 * Nomes genéricos demais para virar o workspace — a Ava confirma antes de
 * aceitar (Edge Case da spec: "a empresa é 'Minha Empresa' mesmo?").
 */
const GENERIC_COMPANY_NAMES = new Set([
  'minha empresa',
  'minha empresa ltda',
  'minha empresa me',
  'empresa',
  'empresa ltda',
  'empresa teste',
  'teste',
  'testando',
  'nome da empresa',
  'sua empresa',
]);

function isGenericCompanyName(value: string): boolean {
  return GENERIC_COMPANY_NAMES.has(value.trim().toLowerCase());
}

function nextMessageId(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

function userMessage(text: string): ChatMessage {
  return { id: nextMessageId(), from: 'user', kind: 'text', text };
}

/** Mensagem de pergunta a partir do roteiro (render mapeado pelo kind). */
function questionMessage(question: AvaQuestion, ctx: PromptContext): ChatMessage {
  const base = {
    id: nextMessageId(),
    from: 'ava' as const,
    text: question.prompt(ctx),
    questionId: question.id,
  };
  switch (question.kind) {
    case 'chips':
    case 'multi-chips':
      return { ...base, kind: 'chips', options: question.options, multi: question.kind === 'multi-chips' };
    case 'yesno':
      return { ...base, kind: 'chips', options: [question.yesOption!, question.noOption!] };
    case 'attachments':
      return { ...base, kind: 'input', allowAttachments: true };
    default:
      return { ...base, kind: 'input' };
  }
}

/** Eco legível da resposta do usuário (rótulo do chip quando houver). */
function answerEcho(question: AvaQuestion, value: string | string[]): string {
  if (Array.isArray(value)) return value.join(', ');
  const option = question.options?.find((o) => o.value === value);
  return option ? option.label : value;
}

export function createOnboardingService(deps: OnboardingServiceDeps) {
  const prefill: PromptContext = deps.prefill ?? {};
  const extractFn = deps.extract || defaultExtract;
  let awaitingCatalogUrl = false;
  // Aguardando a confirmação de nome de empresa genérico (Edge Case da spec).
  let awaitingCompanyConfirmation = false;
  let state = buildInitialState();

  function buildInitialState(): OnboardingState {
    awaitingCatalogUrl = false;
    awaitingCompanyConfirmation = false;
    return {
      stepIndex: 0,
      messages: [
        { id: nextMessageId(), from: 'ava', kind: 'text', text: INTRO_MESSAGE },
        questionMessage(AVA_QUESTIONS[0], prefill),
      ],
      answers: {},
      assets: [],
      businessContext: null,
      completed: false,
    };
  }

  /** Contexto de interpolação: respostas já dadas vencem o pre-fill da conta. */
  function promptContext(): PromptContext {
    return {
      firstName: (state.answers.nome?.value as string) || prefill.firstName,
      companyName: (state.answers.empresa?.value as string) || prefill.companyName,
      email: (state.answers.email?.value as string) || prefill.email,
    };
  }

  function currentQuestion(): AvaQuestion {
    return AVA_QUESTIONS[Math.min(state.stepIndex, AVA_QUESTIONS.length - 1)];
  }

  /** Avança para a próxima pergunta (ou encerra a conversa no resumo). */
  function advance(): void {
    if (state.stepIndex < AVA_QUESTIONS.length - 1) {
      state.stepIndex += 1;
      state.messages.push(questionMessage(currentQuestion(), promptContext()));
    } else {
      state.stepIndex = AVA_QUESTIONS.length;
      state.messages.push({ id: nextMessageId(), from: 'ava', kind: 'summary', text: null });
    }
  }

  function storeAnswer(questionId: QuestionId, value: string | string[] | null, via: Answer['via']): void {
    state.answers[questionId] = { questionId, value, via, answeredAt: Date.now() };
  }

  function rejectWithCorrection(question: AvaQuestion, reason: ValidationReason): { ok: false; reason: ValidationReason } {
    state.messages.push({ id: nextMessageId(), from: 'ava', kind: 'text', text: correctionMessage(question, reason) });
    return { ok: false, reason };
  }

  return {
    getState(): OnboardingState {
      return {
        ...state,
        messages: [...state.messages],
        answers: { ...state.answers },
        assets: [...state.assets],
      };
    },

    answer(questionId: QuestionId, value: string | string[], via: Answer['via']): AnswerResult {
      if (state.completed) return { ok: false, reason: 'EMPTY' };
      const question = currentQuestion();
      if (questionId !== question.id) return { ok: false, reason: 'INVALID_OPTION' };

      // Follow-up do catálogo: depois do "sim", a próxima resposta é a URL (FR-023).
      if (awaitingCatalogUrl) {
        state.messages.push(userMessage(typeof value === 'string' ? value : value.join(', ')));
        const validation = validateUrlText(value);
        if (!validation.ok) return rejectWithCorrection(question, validation.reason);
        storeAnswer('catalogo', typeof value === 'string' ? value.trim() : value, via);
        awaitingCatalogUrl = false;
        advance();
        return { ok: true };
      }

      const validation = validateAnswer(question, value);
      state.messages.push(userMessage(answerEcho(question, value)));
      if (!validation.ok) return rejectWithCorrection(question, validation.reason);

      // Nome de empresa genérico: confirma antes de aceitar (Edge Case da
      // spec) — a submissão seguinte é tratada como confirmação explícita.
      if (
        question.id === 'empresa' &&
        !awaitingCompanyConfirmation &&
        typeof value === 'string' &&
        isGenericCompanyName(value)
      ) {
        awaitingCompanyConfirmation = true;
        state.messages.push({
          id: nextMessageId(),
          from: 'ava',
          kind: 'input',
          questionId: 'empresa',
          text: `A empresa é "${value.trim()}" mesmo? Se sim, manda de novo que eu registro — ou escreve o nome certinho dela 🙂`,
        });
        return { ok: true };
      }
      awaitingCompanyConfirmation = false;

      storeAnswer(questionId, Array.isArray(value) ? [...value] : value.trim(), via);

      // Catálogo "sim" não avança: pede a URL do catálogo antes.
      if (question.id === 'catalogo' && value === 'sim') {
        awaitingCatalogUrl = true;
        state.messages.push({
          id: nextMessageId(),
          from: 'ava',
          kind: 'input',
          questionId: 'catalogo',
          text: question.urlFollowUpPrompt!(promptContext()),
        });
        return { ok: true };
      }

      advance();
      return { ok: true };
    },

    skip(questionId: QuestionId): AnswerResult {
      if (state.completed) return { ok: false, reason: 'EMPTY' };
      const question = currentQuestion();
      if (questionId !== question.id) return { ok: false, reason: 'INVALID_OPTION' };
      if (!isSkippable(question)) return { ok: false, reason: 'EMPTY' };
      state.messages.push(userMessage(SKIP_LABEL));
      storeAnswer(questionId, null, 'skipped');
      advance();
      return { ok: true };
    },

    /**
     * Volta a conversa para uma pergunta já respondida (correção retroativa —
     * FR-012 no meio da conversa; FR-014 a partir do resumo). Descarta a
     * resposta revisada e todas as posteriores, mantendo as anteriores.
     */
    revise(questionId: QuestionId): AnswerResult {
      if (state.completed) return { ok: false, reason: 'EMPTY' };
      const index = AVA_QUESTIONS.findIndex((q) => q.id === questionId);
      if (index < 0 || !state.answers[questionId]) return { ok: false, reason: 'INVALID_OPTION' };

      const discarded = new Set(AVA_QUESTIONS.slice(index).map((q) => q.id));
      for (const q of AVA_QUESTIONS.slice(index)) {
        delete state.answers[q.id];
      }
      // Ativos de negócio das perguntas descartadas também saem (FR-014).
      if (discarded.has('siteInstitucional')) state.assets = state.assets.filter((a) => a.type !== 'site');
      if (discarded.has('materiais')) state.assets = state.assets.filter((a) => a.type !== 'document');
      if (discarded.has('catalogo')) state.assets = state.assets.filter((a) => a.type !== 'catalog');
      // Trunca a conversa na mensagem original da pergunta revisada e re-apresenta.
      const questionMessageIndex = state.messages.findIndex(
        (m) => m.from === 'ava' && m.questionId === questionId
      );
      if (questionMessageIndex >= 0) state.messages = state.messages.slice(0, questionMessageIndex);
      state.stepIndex = index;
      awaitingCatalogUrl = false;
      awaitingCompanyConfirmation = false;
      state.messages.push(questionMessage(AVA_QUESTIONS[index], promptContext()));
      return { ok: true };
    },

    /**
     * Confirmação do resumo (FR-015): exige as 3 obrigatórias respondidas e a
     * conversa concluída. Persiste o flag da sessão (FR-019) e devolve o
     * resultado que o App distribui para sidebar/dashboard (FR-016/FR-017).
     */
    complete(): OnboardingResult | null {
      if (state.completed) return buildResult();
      const required = AVA_QUESTIONS.filter((q) => q.required);
      const allAnswered = required.every((q) => state.answers[q.id]);
      if (!allAnswered || state.stepIndex < AVA_QUESTIONS.length) return null;

      const crmValue = state.answers.crm?.value;
      const crmAnswered = typeof crmValue === 'string' && crmValue !== '__none__';
      const mercado = state.answers.mercadoAlvo?.value;

      state.completed = true;
      deps.storage.setItem(DONE_STORAGE_KEY, '1');
      return buildResult();

      function buildResult(): OnboardingResult {
        return {
          companyName: (state.answers.empresa?.value as string) || '',
          userName: (state.answers.nome?.value as string) || '',
          userEmail: (state.answers.email?.value as string) || '',
          crm: {
            name: crmAnswered ? (crmValue as string) : null,
            connected: crmAnswered,
          },
          mercadoAlvo: Array.isArray(mercado) ? mercado : [],
          businessContext: state.businessContext,
          answers: { ...state.answers },
        };
      }
    },

    /** Registra o site institucional / catálogo online como ativo (FR-021/FR-023). */
    addUrlAsset(type: BusinessAsset['type'], url: string): AnswerResult {
      const validation = validateUrlText(url);
      if (!validation.ok) return validation;
      const trimmed = url.trim();
      state.assets = state.assets.filter((a) => a.type !== type);
      state.assets.push({
        id: nextAssetId(),
        type,
        name: hostOf(trimmed),
        url: trimmed,
        file: null,
        blob: null,
        status: 'pending',
        warning: null,
      });
      return { ok: true };
    },

    /**
     * Anexa materiais de apresentação (FR-022). Valida formato, tamanho (20 MB)
     * e limite de 5 arquivos; recusas voltam como motivo conversacional.
     */
    addFiles(files: File[]): AddFilesResult {
      const accepted: File[] = [];
      const rejected: Array<{ file: File; reason: string }> = [];
      const existing = state.assets.filter((a) => a.type === 'document').length;

      for (const file of files) {
        if (existing + accepted.length >= MAX_DOCUMENTS) {
          rejected.push({ file, reason: `limite de ${MAX_DOCUMENTS} arquivos` });
          continue;
        }
        if (!ACCEPTED_DOC_MIMES.has(file.type)) {
          rejected.push({ file, reason: `formato não suportado (${file.type || 'desconhecido'})` });
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          rejected.push({ file, reason: 'arquivo maior que 20 MB' });
          continue;
        }
        accepted.push(file);
      }

      if (accepted.length > 0) {
        state.messages.push(userMessage(accepted.map((f) => f.name).join(', ')));
        for (const file of accepted) {
          state.assets.push({
            id: nextAssetId(),
            type: 'document',
            name: file.name,
            url: null,
            file: { name: file.name, size: file.size, mime: file.type },
            blob: file,
            status: 'pending',
            warning: null,
          });
          state.messages.push({
            id: nextMessageId(),
            from: 'ava',
            kind: 'text',
            text: `Recebi o ${file.name} ✅ Vou ler e aprender com ele.`,
          });
        }
        for (const r of rejected) {
          state.messages.push({
            id: nextMessageId(),
            from: 'ava',
            kind: 'text',
            text: `O ${r.file.name} não entrou: ${r.reason}. 😅`,
          });
        }
      }

      return { accepted, rejected };
    },

    /**
     * Encerra a pergunta de materiais: avança registrando os arquivos anexados
     * (ou a ausência deles) — FR-022.
     */
    finishAttachments(): AnswerResult {
      if (state.completed) return { ok: false, reason: 'EMPTY' };
      const question = currentQuestion();
      if (question.id !== 'materiais') return { ok: false, reason: 'INVALID_OPTION' };
      const documents = state.assets.filter((a) => a.type === 'document');
      if (documents.length === 0) {
        state.messages.push(userMessage(SKIP_LABEL));
        storeAnswer('materiais', null, 'skipped');
      } else {
        state.messages.push(userMessage('Pronto, é isso! 📎'));
        storeAnswer('materiais', documents.map((d) => d.name), 'chip');
      }
      advance();
      return { ok: true };
    },

    /**
     * Extração dos ativos pendentes durante a conversa (FR-024): chama o
     * endpoint stateless, guarda o contexto de negócio no estado e a Ava
     * confirma em linguagem natural o que absorveu (ou o que falhou).
     */
    async extractBusinessContext(): Promise<ExtractionOutcome> {
      const siteUrl = state.assets.find((a) => a.type === 'site' && a.url)?.url ?? null;
      const catalogUrl = state.assets.find((a) => a.type === 'catalog' && a.url)?.url ?? null;
      const files = state.assets
        .filter((a) => a.type === 'document' && a.blob && a.status === 'pending')
        .map((a) => a.blob as File);
      if (!siteUrl && !catalogUrl && files.length === 0) {
        return { ok: false, reason: 'NOTHING_TO_EXTRACT' };
      }

      for (const asset of state.assets) {
        if (asset.status === 'pending') asset.status = 'extracting';
      }

      try {
        const response = await extractFn({ siteUrl, catalogUrl, files });
        state.businessContext = response.businessContext;
        for (const asset of state.assets) {
          if (asset.status === 'extracting') asset.status = 'extracted';
        }
        // Warnings por arquivo marcam o ativo correspondente (nome citado).
        for (const warning of response.warnings) {
          for (const asset of state.assets) {
            if (asset.name && warning.includes(asset.name)) {
              asset.status = warning.startsWith('DOCUMENT_UNSUPPORTED_FORMAT') ? 'unsupported' : 'failed';
              asset.warning = warning;
            }
          }
        }

        const context = response.businessContext;
        if (context && context.products.length > 0) {
          const names = context.products.map((p) => p.name).slice(0, 3).join(', ');
          state.messages.push({
            id: nextMessageId(),
            from: 'ava',
            kind: 'text',
            text:
              `Pronto, absorvi tudo! 🧠 Identifiquei ${context.products.length === 1 ? 'o produto' : 'os produtos'} ` +
              `${names}${context.valueProposition ? ` — "${context.valueProposition}"` : ''}. ` +
              'Vou usar isso pra falar a língua do seu negócio nas prospecções.',
          });
        } else {
          state.messages.push({
            id: nextMessageId(),
            from: 'ava',
            kind: 'text',
            text:
              'Li o que mandou, mas não consegui absorver conteúdo aproveitável agora — ' +
              'pode ser o formato. Sem crise: dá pra complementar depois nas configurações. 🙂',
          });
        }
        return { ok: true, businessContext: context };
      } catch {
        for (const asset of state.assets) {
          if (asset.status === 'extracting') asset.status = 'failed';
        }
        state.messages.push({
          id: nextMessageId(),
          from: 'ava',
          kind: 'text',
          text:
            'Não consegui processar seus materiais agora — parece um problema de conexão. ' +
            'A conversa segue normalmente, tentamos de novo mais tarde. 🙂',
        });
        return { ok: false, reason: 'REQUEST_FAILED' };
      }
    },

    reset(): void {
      state = buildInitialState();
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
