/**
 * ScheduleView — agenda da campanha (US3, T039): janelas de envio por
 * dia/hora com fuso, ritmo por hora/dia, previsão de conclusão, fila com
 * motivos de retenção e guard-rails da automação (1º lote).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  approveFirstBatch,
  fetchQueue,
  paceCampaign,
  scheduleCampaign,
  StudioRequestError,
} from '../api';
import type { StudioCampaignDetail } from '../types';
import type { QueueRow, ScheduleForecast, StudioWindow } from '../api';

const DAY_LABEL = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']; // 1..7

export interface ScheduleViewProps {
  campaign: StudioCampaignDetail;
  onCampaignChange: (campaign: StudioCampaignDetail) => void;
}

export function ScheduleView({ campaign, onCampaignChange }: ScheduleViewProps) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);
  const [hourlyLimit, setHourlyLimit] = useState(campaign.schedule?.hourlyLimit ?? 5);
  const [dailyLimit, setDailyLimit] = useState(campaign.schedule?.dailyLimit ?? 30);
  const [timezone, setTimezone] = useState(campaign.schedule?.timezone ?? 'America/Sao_Paulo');
  const [startAt, setStartAt] = useState('');
  const [forecast, setForecast] = useState<ScheduleForecast | null>(null);
  const [queue, setQueue] = useState<{ rows: QueueRow[]; flowStatus: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(() => {
    void fetchQueue(campaign.id)
      .then(setQueue)
      .catch(() => setQueue(null));
  }, [campaign.id]);
  useEffect(loadQueue, [loadQueue]);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const handleSchedule = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const windows: StudioWindow[] = days.length > 0 ? [{ days, startHour, endHour }] : [];
      const result = await scheduleCampaign(campaign.id, {
        mode: startAt || windows.length > 0 ? 'scheduled' : 'immediate',
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        windows,
        hourlyLimit,
        dailyLimit,
        timezone,
      });
      onCampaignChange(result.campaign);
      setForecast(result.forecast ?? null);
      setNotice(
        result.campaign.status === 'scheduled'
          ? 'Campanha agendada — o scheduler libera os envios dentro da janela.'
          : 'Disparo imediato iniciado.'
      );
      loadQueue();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao agendar');
    } finally {
      setBusy(false);
    }
  };

  const handlePace = async () => {
    setError(null);
    try {
      const updated = await paceCampaign(campaign.id, { hourlyLimit, dailyLimit });
      onCampaignChange(updated);
      setNotice('Ritmo atualizado.');
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao alterar ritmo');
    }
  };

  const handleApproveFirstBatch = async () => {
    setError(null);
    try {
      const result = await approveFirstBatch(campaign.id);
      setNotice(`1º lote aprovado (${result.sample.length} lead(s) na amostra). Fila liberada.`);
      loadQueue();
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao aprovar 1º lote');
    }
  };

  const toggleDayButton = (day: number) => (
    <button
      key={day}
      type="button"
      onClick={() => toggleDay(day)}
      aria-pressed={days.includes(day)}
      className={`h-8 w-11 rounded-md border text-xs transition-colors ${
        days.includes(day)
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-border text-muted-foreground'
      }`}
    >
      {DAY_LABEL[day - 1]}
    </button>
  );

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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">Janela de envio</h3>
          <div className="flex flex-wrap gap-1">{[1, 2, 3, 4, 5, 6, 7].map(toggleDayButton)}</div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="start-hour">Início</label>
            <input id="start-hour" type="number" min={0} max={23} value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className="h-8 w-16 rounded-md border border-input bg-transparent px-2" />
            <label htmlFor="end-hour">Fim</label>
            <input id="end-hour" type="number" min={1} max={24} value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="h-8 w-16 rounded-md border border-input bg-transparent px-2" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="tz">Fuso</label>
            <input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="start-at">Início futuro (opcional)</label>
            <input id="start-at" type="datetime-local" value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2" />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">Ritmo</h3>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="hourly" className="w-32">Por hora</label>
            <input id="hourly" type="number" min={1} value={hourlyLimit}
              onChange={(e) => setHourlyLimit(Number(e.target.value))}
              className="h-8 w-20 rounded-md border border-input bg-transparent px-2" />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="daily" className="w-32">Por dia</label>
            <input id="daily" type="number" min={1} value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
              className="h-8 w-20 rounded-md border border-input bg-transparent px-2" />
          </div>
          <button
            type="button"
            onClick={handlePace}
            disabled={busy || campaign.status !== 'running'}
            className="h-8 rounded-md border border-border px-3 text-xs disabled:opacity-40"
            title="Alterar ritmo com a fila em execução"
          >
            Alterar ritmo em execução
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSchedule}
          disabled={busy || !['approved'].includes(campaign.status)}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
          title="Aprovar a campanha antes de agendar"
        >
          {busy ? 'Agendando…' : 'Agendar campanha'}
        </button>
        {campaign.approval?.automation === true && (
          <button
            type="button"
            onClick={handleApproveFirstBatch}
            className="h-9 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 text-sm font-medium text-amber-300"
            title="Automação opt-in: aprovar a amostra do primeiro lote"
          >
            Aprovar 1º lote (guard-rails)
          </button>
        )}
      </div>

      {forecast?.estimatedAt && (
        <p className="text-sm text-muted-foreground">
          Previsão de conclusão: <strong>{new Date(forecast.estimatedAt).toLocaleString('pt-BR')}</strong>
        </p>
      )}

      {queue && queue.rows.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">
            Fila ({queue.rows.length}) · fluxo: {queue.flowStatus}
          </h3>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
            {queue.rows.slice(0, 100).map((row) => (
              <li key={`${row.channel}-${row.prospectId}`} className="flex items-center justify-between px-3 py-1.5">
                <span>{row.prospectId}</span>
                <span className="text-xs text-muted-foreground">
                  {row.channel} · {row.status}
                  {row.retainedReason ? ` · retido: ${row.retainedReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
