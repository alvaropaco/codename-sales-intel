/**
 * PersonalizationPanel — personalização com IA por lead (US7, T077): nível,
 * lote com progresso, grade de prévia por lead com status e edição isolada.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchBatchProgress,
  fetchCampaign,
  fetchCampaignSample,
  patchPersonalization,
  runPersonalization,
  StudioRequestError,
} from '../api';
import type { BatchProgress } from '../api';

const LEVELS: Array<{ id: 'greeting' | 'intro' | 'full'; label: string }> = [
  { id: 'greeting', label: 'Só saudação' },
  { id: 'intro', label: 'Introdução personalizada' },
  { id: 'full', label: 'Proposta completa' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  generated: 'Gerada',
  edited: 'Editada',
  base_fallback: 'Sem dados — versão base',
};

export interface PersonalizationPanelProps {
  campaignId: string;
}

export function PersonalizationPanel({ campaignId }: PersonalizationPanelProps) {
  const [level, setLevel] = useState<'greeting' | 'intro' | 'full'>('intro');
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [rows, setRows] = useState<Array<{ prospectId: string; companyName: string | null; status: string; rendered: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      // Prioriza conteúdo de e-mail base existente.
      const detail = await fetchCampaign(campaignId);
      const email = ((detail.contents || []) as Array<Record<string, unknown>>).find(
        (c) => c.channel === 'email' && c.kind === 'base' && c.variantLabel === 'A'
      ) as { id: string } | undefined;
      if (!email) return;
      const data = await fetchCampaignSample(campaignId, 10).catch(() => []);
      void data;
      const preview = await fetch(
        `/api/studio/campaigns/${campaignId}/personalization-preview?contentId=${email.id}&sample=10`
      ).then((r) => r.json());
      setRows(preview.data || []);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha na prévia');
    }
  }, [campaignId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const handleRun = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await fetchCampaign(campaignId);
      const email = ((detail.contents || []) as Array<Record<string, unknown>>).find(
        (c) => c.channel === 'email' && c.kind === 'base' && c.variantLabel === 'A'
      ) as { id: string } | undefined;
      if (!email) {
        setError('Crie o conteúdo de e-mail base antes de personalizar.');
        return;
      }
      const { batchId } = await runPersonalization(campaignId, { contentId: email.id, level });
      let last = null;
      for (let i = 0; i < 200; i++) {
        last = await fetchBatchProgress(batchId);
        setProgress(last);
        if (last.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await loadPreview();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha na personalização');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (prospectId: string) => {
    if (!editing) return;
    try {
      await patchPersonalization(editing, prospectId, { overrides: { intro: editText } });
      setEditing(null);
      await loadPreview();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao salvar edição');
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Nível:</span>
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={level === l.id}
            onClick={() => setLevel(l.id)}
            className={`rounded-md px-3 py-1.5 text-xs ${level === l.id ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
          >
            {l.label}
          </button>
        ))}
        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? `Gerando…${progress ? ` (${progress.done}/${progress.total})` : ''}` : 'Personalizar lote (IA)'}
        </button>
        {progress?.status === 'running' && (
          <span className="text-xs text-muted-foreground">
            {progress.done}/{progress.total} — aguardando…
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Defina a audiência e o conteúdo base para personalizar.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.prospectId} className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {row.companyName || row.prospectId} · {STATUS_LABEL[row.status] || row.status}
                </span>
                {row.status !== 'base_fallback' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(row.prospectId);
                      setEditText(row.rendered.split('\n')[0] || '');
                    }}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    Editar só este lead
                  </button>
                )}
              </div>
              {editing === row.prospectId ? (
                <div className="space-y-1">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="w-full rounded border border-input bg-transparent px-2 py-1 text-sm"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(row.prospectId)}
                      className="h-7 rounded bg-primary px-2 text-xs text-primary-foreground"
                    >
                      Salvar (só este lead)
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="h-7 rounded border border-border px-2 text-xs">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{row.rendered}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
