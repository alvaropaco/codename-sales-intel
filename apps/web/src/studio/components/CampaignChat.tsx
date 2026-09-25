/**
 * CampaignChat — criação da campanha por conversa (chat-first, specs/010).
 * O assistente pergunta preferências e monta objetivo, audiência, conteúdo e
 * agenda; o usuário pode anexar PDFs/imagens (upload) e colar links. Painel
 * lateral mostra o estado real da campanha; aprovação permanece explícita.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { StudioRequestError } from '../api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cards: Array<{ type: string; label: string; detail: string }>;
  createdAt: string;
}

interface CampaignState {
  campaign: {
    id: string;
    name: string;
    status: string;
    objective?: string | null;
    offer?: string | null;
    channels: string[];
    schedule?: { hourlyLimit?: number; dailyLimit?: number; windows?: Array<{ startHour: number; endHour: number }> };
  };
  extras: {
    audienceCount: number | null;
    contentSummary: Array<{ channel: string; tone?: string | null; subject?: string | null }>;
    materials: Array<{ id: string; kind: string; status: string; confirmed: boolean; product?: string | null }>;
  };
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  in_review: 'Aguardando revisão',
  approved: 'Aprovada',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  retained: 'Retida',
};

async function jsonFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/studio${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new StudioRequestError(payload.error || 'ERROR', res.status, payload.message);
  return payload.data as T;
}

export interface CampaignChatProps {
  campaignId: string;
  onStateChange?: () => void;
}

export function CampaignChat({ campaignId, onStateChange }: CampaignChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<CampaignState | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [history, currentState] = await Promise.all([
        jsonFetch<ChatMessage[]>('GET', `/campaigns/${campaignId}/chat`),
        jsonFetch<CampaignState>('GET', `/campaigns/${campaignId}/state`),
      ]);
      setMessages(history);
      setState(currentState);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao carregar conversa');
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    // Mensagem do usuário aparece na hora (o POST persiste e responde).
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: 'user', text, cards: [], createdAt: new Date().toISOString() },
    ]);
    setInput('');
    try {
      await jsonFetch('POST', `/campaigns/${campaignId}/chat`, { message: text });
      await load();
      onStateChange?.();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const handleAttach = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/studio/materials', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new StudioRequestError(body.error || 'UPLOAD_FAILED', res.status, body.message);
      await send(`Analise o material que acabei de anexar (${file.name}) e extraia produto, oferta e público.`);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha no upload');
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async () => {
    setError(null);
    try {
      await jsonFetch('POST', `/campaigns/${campaignId}/approve`, { confirm: true });
      await load();
      onStateChange?.();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao aprovar');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Conversa */}
      <div className="flex flex-col rounded-lg border border-border" style={{ minHeight: 480 }}>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 520 }}>
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Oi! Vamos montar sua campanha juntos.</p>
              <p className="mt-1">
                Me conta o que você quer vender e para quem. Você pode colar um link do produto, anexar
                um PDF/imagem, e me dizer como quer o disparo (ex.: “20 por hora em horário comercial”).
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted/60'
                }`}
              >
                {m.role === 'assistant' ? (
                  <div className="space-y-2 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_strong]:font-semibold">
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}
                {m.cards?.map((card, i) => (
                  <div key={i} className="mt-2 rounded-lg border border-border bg-background/80 p-2 text-xs">
                    <p className="font-semibold">{card.label}</p>
                    {card.detail && <p className="mt-0.5 text-muted-foreground">{card.detail}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Montando… pode levar alguns segundos.
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p role="alert" className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <label
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent"
              title="Anexar PDF, imagem ou documento"
            >
              {uploading ? '…' : '+'}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAttach(file);
                  e.target.value = '';
                }}
              />
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Ex.: vender ERP para indústrias de SP, 20 envios/hora em horário comercial…"
              className="max-h-32 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>

      {/* Painel de estado — o que o bot já montou */}
      <aside className="space-y-3 rounded-lg border border-border p-4 text-sm">
        <h3 className="font-semibold">Sua campanha</h3>
        {state && (
          <>
            <div className="space-y-1.5 text-xs">
              <p>
                Status:{' '}
                <strong>{STATUS_LABEL[state.campaign.status] || state.campaign.status}</strong>
              </p>
              <p>
                Objetivo: <strong>{state.campaign.objective || '— defina na conversa'}</strong>
              </p>
              <p>
                Audiência:{' '}
                <strong>{state.extras.audienceCount != null ? `${state.extras.audienceCount} leads` : '—'}</strong>
              </p>
              <p>
                Conteúdos:{' '}
                <strong>
                  {state.extras.contentSummary.length > 0
                    ? state.extras.contentSummary.map((c) => `${c.channel} (${c.tone || 'base'})`).join(', ')
                    : '—'}
                </strong>
              </p>
              <p>
                Ritmo:{' '}
                <strong>
                  {state.campaign.schedule?.hourlyLimit
                    ? `${state.campaign.schedule.hourlyLimit}/h · ${state.campaign.schedule.dailyLimit}/dia`
                    : '—'}
                </strong>
              </p>
              {state.extras.materials.length > 0 && (
                <p>
                  Materiais:{' '}
                  <strong>
                    {state.extras.materials
                      .map((m) => `${m.kind}${m.confirmed ? ' ✓' : ''}`)
                      .join(', ')}
                  </strong>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleApprove}
              disabled={state.campaign.status !== 'in_review'}
              className="h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40"
              title="Confere o painel antes de aprovar — audiência congela na aprovação"
            >
              Aprovar campanha
            </button>
            <p className="text-[11px] text-muted-foreground">
              Nada é enviado sem aprovação. Audiência congela aqui; ajustes finos ficam nas abas abaixo.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
