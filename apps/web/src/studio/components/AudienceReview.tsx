/**
 * AudienceReview — declaração e conferência da audiência (US1/US2, T021/T030).
 * Três formas combináveis de declarar: segmento salvo, lista (CNPJs/e-mails)
 * e IDs manuais. Mostra contagens, excluídos com motivo e exclusão manual.
 * Lead protegido (supressão/opt-out) nunca é incluível (FR-012).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchSegments,
  setListAudience,
  setManualAudience,
  setSegmentAudience,
  StudioRequestError,
} from '../api';
import type { AudienceView } from '../api';
import type { StudioCampaignDetail } from '../types';
import { SegmentBuilder } from './SegmentBuilder';

const REASON_LABEL: Record<string, string> = {
  suppressed: 'Supressão',
  opt_out: 'Opt-out',
  recent_contact: 'Contato recente',
  manual: 'Excluído manualmente',
  fatigue: 'Fadiga',
  no_consent: 'Sem base legal',
  not_found: 'Lead não encontrado na org',
};

export function reasonLabel(reason: string | null): string {
  return reason ? REASON_LABEL[reason] || reason : '';
}

const MODES = ['Segmento salvo', 'Colar lista', 'IDs manuais'] as const;
type Mode = (typeof MODES)[number];

export interface AudienceReviewProps {
  campaign: StudioCampaignDetail;
  onCampaignChange?: (campaign: StudioCampaignDetail) => void;
}

export function AudienceReview({ campaign }: AudienceReviewProps) {
  const [mode, setMode] = useState<Mode>('Segmento salvo');
  const [segments, setSegments] = useState<Awaited<ReturnType<typeof fetchSegments>>>([]);
  const [segmentId, setSegmentId] = useState('');
  const [rawList, setRawList] = useState('');
  const [manualIds, setManualIds] = useState('');
  const [audience, setAudience] = useState<AudienceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSegments = useCallback(() => {
    void fetchSegments().then(setSegments).catch(() => setSegments([]));
  }, []);
  useEffect(loadSegments, [loadSegments]);

  const run = async (fn: () => Promise<AudienceView>) => {
    setBusy(true);
    setError(null);
    try {
      setAudience(await fn());
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao aplicar audiência');
    } finally {
      setBusy(false);
    }
  };

  const handleApply = () => {
    if (mode === 'Segmento salvo') {
      if (!segmentId) return setError('Selecione um segmento salvo.');
      return void run(() => setSegmentAudience(campaign.id, segmentId));
    }
    if (mode === 'Colar lista') {
      const list = rawList.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) return setError('Cole ao menos um CNPJ ou e-mail.');
      return void run(() => setListAudience(campaign.id, list));
    }
    const ids = manualIds.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return setError('Informe ao menos um ID de lead.');
    return void run(() => setManualAudience(campaign.id, ids));
  };

  const handleRemove = (prospectId: string) => {
    if (!audience) return;
    const remaining = audience.members
      .filter((m) => m.prospectId !== prospectId && m.included)
      .map((m) => m.prospectId);
    void run(() => setManualAudience(campaign.id, remaining));
  };

  const included = audience?.members.filter((m) => m.included) ?? [];
  const excluded = audience?.members.filter((m) => !m.included) ?? [];

  return (
    <div className="space-y-4">
      {/* Modos de declaração */}
      <div role="tablist" aria-label="Modo de audiência" className="flex gap-1">
        {MODES.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === m ? 'bg-primary font-medium text-primary-foreground' : 'border border-border text-muted-foreground'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'Segmento salvo' && (
        <div className="space-y-2">
          <select
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="Segmento salvo"
          >
            <option value="">Selecione um segmento…</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.lastCount != null ? ` (${s.lastCount} leads)` : ''}
              </option>
            ))}
          </select>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Criar novo segmento com filtros
            </summary>
            <SegmentBuilder />
          </details>
        </div>
      )}

      {mode === 'Colar lista' && (
        <div>
          <label htmlFor="audience-list" className="mb-1 block text-sm font-medium">
            CNPJs ou e-mails (um por linha — resolvidos contra a sua conta)
          </label>
          <textarea
            id="audience-list"
            value={rawList}
            onChange={(e) => setRawList(e.target.value)}
            rows={4}
            placeholder={'11.222.333/0001-81\ncontato@empresa.com.br'}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      {mode === 'IDs manuais' && (
        <div>
          <label htmlFor="audience-ids" className="mb-1 block text-sm font-medium">
            IDs dos leads (um por linha)
          </label>
          <textarea
            id="audience-ids"
            value={manualIds}
            onChange={(e) => setManualIds(e.target.value)}
            rows={4}
            placeholder={'ID do lead 1\nID do lead 2'}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      <button
        type="button"
        onClick={handleApply}
        disabled={busy}
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Aplicando…' : 'Aplicar audiência'}
      </button>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {audience && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full border border-border px-3 py-1">
              Total: <strong>{audience.totalCount}</strong>
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              Incluídos: <strong>{audience.includedCount}</strong>
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300">
              Excluídos: <strong>{audience.excludedCount}</strong>
            </span>
          </div>

          {excluded.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">Excluídos (com motivo)</h4>
              <ul className="space-y-1">
                {excluded.map((m) => (
                  <li key={m.prospectId} className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-sm">
                    {m.companyName || m.prospectId} — {reasonLabel(m.excludeReason)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {included.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">Incluídos</h4>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {included.map((m) => (
                  <li key={m.prospectId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{m.companyName || m.prospectId}</span>
                    <button
                      type="button"
                      onClick={() => handleRemove(m.prospectId)}
                      className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                    >
                      Remover da audiência
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            A audiência congela na aprovação: leads que entrarem depois não
            recebem a campanha sem nova ação sua.
          </p>
        </div>
      )}
    </div>
  );
}
