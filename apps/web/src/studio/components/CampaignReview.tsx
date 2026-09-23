/**
 * CampaignReview — revisão e aprovação (US1, T020).
 * Mostra o conteúdo por canal, a amostra real por lead e os botões de fluxo:
 * nada é enviado sem o clique em Aprovar + disparo explícito.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  approveCampaign,
  fetchCampaignSample,
  scheduleImmediate,
  submitReview,
  StudioRequestError,
} from '../api';
import type { SampleRow } from '../api';
import type { StudioCampaignDetail } from '../types';

export interface CampaignReviewProps {
  campaign: StudioCampaignDetail;
  onCampaignChange: (campaign: StudioCampaignDetail) => void;
}

export function CampaignReview({ campaign, onCampaignChange }: CampaignReviewProps) {
  const [sample, setSample] = useState<SampleRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSample = useCallback(() => {
    void fetchCampaignSample(campaign.id)
      .then(setSample)
      .catch(() => setSample([]));
  }, [campaign.id]);

  useEffect(loadSample, [loadSample]);

  const run = async (action: string, fn: () => Promise<StudioCampaignDetail>) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const updated = await fn();
      onCampaignChange(updated);
      setNotice(`Campanha agora está em "${updated.status}".`);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha na operação');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {campaign.statusReason && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Motivo: {campaign.statusReason}
        </p>
      )}
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

      {/* Ações de fluxo — a ordem é a regra: revisar → aprovar → disparar. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || !['draft', 'paused', 'retained'].includes(campaign.status)}
          onClick={() => run('submit-review', () => submitReview(campaign.id))}
          className="h-9 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-40"
        >
          {busy === 'submit-review' ? 'Enviando…' : 'Enviar para revisão'}
        </button>
        <button
          type="button"
          disabled={busy !== null || campaign.status !== 'in_review'}
          onClick={() => run('approve', () => approveCampaign(campaign.id))}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
          title="Aprovar congela a audiência e roda o Compliance Guard"
        >
          {busy === 'approve' ? 'Avaliando…' : 'Aprovar campanha'}
        </button>
        <button
          type="button"
          disabled={busy !== null || campaign.status !== 'approved'}
          onClick={() => run('dispatch', () => scheduleImmediate(campaign.id))}
          className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-40"
          title="Disparo imediato (janelas e ritmo chegam na US3)"
        >
          {busy === 'dispatch' ? 'Disparando…' : 'Disparar agora'}
        </button>
      </div>

      {/* Amostra real: o que cada lead receberá (FR-004). */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Amostra — o que cada lead recebe ({sample.length} primeiros)
        </h3>
        {sample.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Defina a audiência na aba Audiência para ver a prévia por lead.
          </p>
        ) : (
          <ul className="space-y-3">
            {sample.map((row) => (
              <li key={row.prospectId} className="rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {row.companyName || row.prospectId}
                  {row.contactName ? ` · ${row.contactName}` : ''}
                </p>
                {row.renders.map((r, i) => (
                  <div key={i} className="mt-1 rounded bg-muted/40 p-2 text-sm">
                    {r.subject && <p className="font-medium">{r.subject}</p>}
                    <p className="whitespace-pre-wrap text-muted-foreground">{r.text}</p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
