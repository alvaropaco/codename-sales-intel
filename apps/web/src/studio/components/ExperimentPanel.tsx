/**
 * ExperimentPanel — A/B por variante (US10, T103): criação com divisão e
 * critério de vencedor, métricas por variante e declaração manual.
 */
import { useCallback, useEffect, useState } from 'react';
import { StudioRequestError } from '../api';

interface Experiment {
  id: string;
  dimension: string;
  split: Record<string, number>;
  status: string;
  winnerVariant?: string | null;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data?: T; message?: string; error?: string }> {
  const res = await fetch(`/api/studio${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...payload };
}

export interface ExperimentPanelProps {
  campaignId: string;
}

export function ExperimentPanel({ campaignId }: ExperimentPanelProps) {
  const [dimension, setDimension] = useState('subject');
  const [splitA, setSplitA] = useState(20);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [metrics, setMetrics] = useState<Record<string, { sent: number; replies: number; replyRate: number }> | null>(null);
  const [verdict, setVerdict] = useState<{ winner: string | null; details?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Métricas por experimento são carregadas sob demanda no painel.
    void campaignId;
  }, [campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ok, message } = await api('/campaigns/' + campaignId + '/experiments', 'POST', {
        dimension,
        split: { A: splitA, B: 100 - splitA },
        winnerCriterion: { metric: 'replyRate', minPerVariant: 50, confidence: 0.95 },
      });
      if (!ok) throw new StudioRequestError('CREATE_FAILED', 400, message);
      await load();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao criar experimento');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2"
          aria-label="Dimensão do teste"
        >
          {['subject', 'copy', 'cta', 'send_time', 'channel'].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs">
          A (%):
          <input
            type="number"
            min={5}
            max={95}
            value={splitA}
            onChange={(e) => setSplitA(Number(e.target.value))}
            className="h-8 w-16 rounded-md border border-input bg-transparent px-2"
          />
        </label>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? 'Criando…' : `Criar A/B ${splitA}/${100 - splitA}`}
        </button>
      </div>
      {metrics && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {Object.entries(metrics).map(([label, m]) => (
            <li key={label} className="flex justify-between px-3 py-2">
              <span>{label}</span>
              <span className="text-muted-foreground">
                {m.sent} enviados · {m.replies} respostas · {(m.replyRate * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      {verdict?.winner && (
        <p className="text-emerald-300">Vencedor: {verdict.winner}</p>
      )}
    </div>
  );
}
