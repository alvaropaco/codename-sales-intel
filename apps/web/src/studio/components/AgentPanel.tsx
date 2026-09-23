/**
 * AgentPanel — AI Campaign Agent (US9, T095): objetivo em linguagem natural →
 * plano revisável item a item. Conversão cria campanha em REVISÃO — o agente
 * nunca ativa disparo (FR-058). Inclui fila de recomendações pendentes.
 */
import { useCallback, useEffect, useState } from 'react';
import { StudioRequestError } from '../api';

interface Proposal {
  id: string;
  status: string;
  plan: {
    audience?: { criteria?: unknown; rationale?: string };
    strategy?: { channels?: string[]; timing?: string };
    contents?: Array<{ channel: string; subject?: string; text?: string }>;
    tracking?: unknown;
    error?: string;
  };
  campaignId?: string | null;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/studio${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  if (!res.ok) throw new StudioRequestError(payload.error || 'ERROR', res.status, payload.message);
  return payload.data as T;
}

export function AgentPanel() {
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({
    audience: 'accepted',
    strategy: 'accepted',
    contents: 'accepted',
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const propose = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/studio/agent/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok) throw new StudioRequestError(body.error, res.status, body.message);
      const proposalId = body.data.proposalId;
      // Polling até o plano ficar pronto (execução inline no servidor).
      for (let i = 0; i < 100; i++) {
        const p = await api<Proposal>(`/agent/proposals/${proposalId}`, 'GET');
        if (p && (p.status === 'proposed' || p.plan?.error)) {
          setProposal(p);
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao propor campanha');
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(decisions).map(([key, decision]) => ({ key, decision }));
      const data = await api<{ campaignId?: string }>(
        `/agent/proposals/${proposal.id}/decide`,
        'POST',
        { items, confirm: true }
      );
      setNotice(
        data.campaignId
          ? `Campanha criada em REVISÃO (${data.campaignId}) — aprove no detalhe da campanha.`
          : 'Decisão registrada.'
      );
      setProposal(null);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha na decisão');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="agent-prompt" className="block text-sm font-medium">
          Descreva o objetivo da campanha
        </label>
        <textarea
          id="agent-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Ex.: quero vender software ERP para empresas industriais de SP"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={propose}
          disabled={busy || !prompt.trim()}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? 'Planejando…' : 'Propor campanha'}
        </button>
      </div>

      {proposal && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Plano proposto — avalie item a item</h3>
          {[
            { key: 'audience', title: 'Audiência', detail: proposal.plan.audience?.rationale || 'segmento sugerido' },
            { key: 'strategy', title: 'Estratégia', detail: `${(proposal.plan.strategy?.channels || []).join(' + ')} · ${proposal.plan.strategy?.timing || ''}` },
            { key: 'contents', title: 'Conteúdos', detail: (proposal.plan.contents || []).map((c) => c.channel).join(', ') },
          ].map((item) => (
            <div key={item.key} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">{item.title}</p>
                <span className="flex gap-1">
                  {(['accepted', 'rejected'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={decisions[item.key] === d}
                      onClick={() => setDecisions({ ...decisions, [item.key]: d })}
                      className={`rounded px-2 py-0.5 text-xs ${
                        decisions[item.key] === d ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'
                      }`}
                    >
                      {d === 'accepted' ? 'Aceitar' : 'Rejeitar'}
                    </button>
                  ))}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={decide}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {busy ? 'Convertendo…' : 'Criar campanha a partir do plano'}
          </button>
        </div>
      )}
    </div>
  );
}
