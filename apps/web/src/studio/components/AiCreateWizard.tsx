/**
 * AiCreateWizard — criação de campanha por IA (US4, T049): fonte (URL ou
 * prompt) → extração confirmável → compose com tons → polling do lote.
 * O pacote cai em REVISÃO — o wizard nunca dispara nada (FR-002).
 */
import { useState } from 'react';
import {
  composeCampaign,
  confirmMaterial,
  createMaterialFromPrompt,
  createMaterialFromUrl,
  extractMaterial,
  fetchBatchProgress,
  fetchCampaign,
  StudioRequestError,
} from '../api';
import type { BatchProgress, StudioMaterial } from '../api';
import type { StudioCampaignDetail } from '../types';

const TONES = ['formal', 'comercial', 'tecnico', 'urgente'];

export interface AiCreateWizardProps {
  campaign: StudioCampaignDetail;
  onCampaignChange: (campaign: StudioCampaignDetail) => void;
}

export function AiCreateWizard({ campaign, onCampaignChange }: AiCreateWizardProps) {
  const [source, setSource] = useState<'url' | 'prompt'>('url');
  const [url, setUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [material, setMaterial] = useState<StudioMaterial | null>(null);
  const [edits, setEdits] = useState({ product: '', offer: '', audience: '', cta: '' });
  const [tones, setTones] = useState<string[]>(['formal', 'comercial']);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreateMaterial = async () => {
    setBusy('material');
    setError(null);
    try {
      const m =
        source === 'url' ? await createMaterialFromUrl(url) : await createMaterialFromPrompt(prompt);
      setMaterial(m);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao criar material');
    } finally {
      setBusy(null);
    }
  };

  const handleExtract = async () => {
    if (!material) return;
    setBusy('extract');
    setError(null);
    try {
      setMaterial(await extractMaterial(material.id));
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha na extração');
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (!material) return;
    setBusy('confirm');
    setError(null);
    try {
      setMaterial(
        await confirmMaterial(material.id, {
          product: edits.product || undefined,
          offer: edits.offer || undefined,
          audience: edits.audience || undefined,
          cta: edits.cta || undefined,
        })
      );
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao confirmar');
    } finally {
      setBusy(null);
    }
  };

  const handleCompose = async () => {
    if (!material) return;
    setBusy('compose');
    setError(null);
    try {
      const { batchId } = await composeCampaign(campaign.id, {
        materialId: material.id,
        tones: tones.length ? tones : ['formal', 'comercial'],
      });
      // Polling do lote (execução inline no servidor em v1).
      let last: BatchProgress | null = null;
      for (let i = 0; i < 100; i++) {
        last = await fetchBatchProgress(batchId);
        setProgress(last);
        if (last.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      onCampaignChange(await fetchCampaign(campaign.id));
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao compor pacote');
    } finally {
      setBusy(null);
    }
  };

  const extraction = material?.extraction;

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* 1. Fonte */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">1. Fonte do material</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSource('url')}
            aria-pressed={source === 'url'}
            className={`rounded-md px-3 py-1.5 text-sm ${source === 'url' ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
          >
            URL do produto
          </button>
          <button
            type="button"
            onClick={() => setSource('prompt')}
            aria-pressed={source === 'prompt'}
            className={`rounded-md px-3 py-1.5 text-sm ${source === 'prompt' ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
          >
            Prompt
          </button>
        </div>
        {source === 'url' ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://suaempresa.com.br/produto"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          />
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Descreva o que quer vender, para quem e o objetivo da campanha…"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        )}
        <button
          type="button"
          onClick={handleCreateMaterial}
          disabled={busy !== null}
          className="h-8 rounded-md border border-border px-3 text-xs disabled:opacity-40"
        >
          {busy === 'material' ? 'Enviando…' : 'Carregar material'}
        </button>
      </div>

      {/* 2. Extração + confirmação (FR-024) */}
      {material && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">2. Extração da IA (confirme antes de gerar)</h3>
          <p className="text-xs text-muted-foreground">
            Status: {material.extractionStatus}
            {material.extractionError ? ` — ${material.extractionError}` : ''}
          </p>
          {material.extractionStatus === 'pending' && (
            <button
              type="button"
              onClick={handleExtract}
              disabled={busy !== null}
              className="h-8 rounded-md border border-border px-3 text-xs disabled:opacity-40"
            >
              {busy === 'extract' ? 'Extraindo…' : 'Extrair com IA'}
            </button>
          )}
          {material.extractionStatus === 'extracted' && !material.confirmedAt && (
            <div className="space-y-2 text-sm">
              {(['product', 'offer', 'audience', 'cta'] as const).map((field) => (
                <div key={field} className="flex items-center gap-2">
                  <label htmlFor={`edit-${field}`} className="w-24 text-xs text-muted-foreground">
                    {field}
                  </label>
                  <input
                    id={`edit-${field}`}
                    value={edits[field]}
                    placeholder={String(extraction?.[field] ?? '')}
                    onChange={(e) => setEdits({ ...edits, [field]: e.target.value })}
                    className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                  />
                </div>
              ))}
              {Array.isArray(extraction?.benefits) && extraction.benefits.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Benefícios: {extraction.benefits.join(', ')}
                </p>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy !== null}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {busy === 'confirm' ? 'Confirmando…' : 'Confirmar extração'}
              </button>
            </div>
          )}
          {material.confirmedAt && (
            <p className="text-xs text-emerald-300">Extração confirmada ✓</p>
          )}
        </div>
      )}

      {/* 3. Compose com tons */}
      {material?.confirmedAt && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">3. Gerar pacote (tons)</h3>
          <div className="flex flex-wrap gap-1">
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                aria-pressed={tones.includes(tone)}
                onClick={() =>
                  setTones((prev) => (prev.includes(tone) ? prev.filter((t) => t !== tone) : [...prev, tone]))
                }
                className={`rounded-md px-3 py-1.5 text-xs ${tones.includes(tone) ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
              >
                {tone}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleCompose}
            disabled={busy !== null}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {busy === 'compose'
              ? `Gerando…${progress ? ` (${progress.done}/${progress.total})` : ''}`
              : 'Gerar pacote de campanha'}
          </button>
          <p className="text-xs text-muted-foreground">
            O pacote cai em <strong>revisão</strong> — nada é enviado sem sua aprovação.
          </p>
        </div>
      )}
    </div>
  );
}
