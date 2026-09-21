import React, { useEffect, useState } from 'react';
import { Loader2, Radar, RefreshCw } from 'lucide-react';
import { DiscoveryJobStatusPayload, DiscoveryJobStatus } from '@/types';
import { fetchDiscoveryJob } from '@/services/api';

/**
 * DiscoveryJobProgress (T049) — progresso do job de discovery com estado
 * INDEPENDENTE por provider (SC-001 na UI): provider falho não esconde o
 * resultado dos demais. Faz polling enquanto o job não é terminal.
 */

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-400',
  running: 'bg-blue-500/15 text-blue-400',
  queued: 'bg-secondary/60 text-muted-foreground',
  partial: 'bg-amber-500/15 text-amber-400',
  failed: 'bg-rose-500/15 text-rose-400',
  skipped: 'bg-secondary/60 text-muted-foreground',
};

const ERROR_LABEL: Record<string, string> = {
  NOT_CONFIGURED: 'sem credenciais',
  BUDGET_EXHAUSTED: 'orçamento esgotado',
  TIMEOUT: 'tempo esgotado',
  RATE_LIMIT: 'limite de taxa',
  INVALID_INPUT: 'sem semente aplicável',
  PROVIDER_UNAVAILABLE: 'indisponível',
};

const TERMINAL: DiscoveryJobStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

export function DiscoveryJobProgress({ jobId, onJobDone }: { jobId: string; onJobDone?: (status: DiscoveryJobStatusPayload) => void }) {
  const [status, setStatus] = useState<DiscoveryJobStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const data = await fetchDiscoveryJob(jobId);
        if (!active) return;
        if (!data) throw new Error('job não encontrado');
        setStatus(data);
        if (!TERMINAL.includes(data.job.status)) {
          timer = setTimeout(poll, 2500);
        } else {
          onJobDone?.(data);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao consultar progresso');
      }
    }
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-400">
        <RefreshCw className="h-3.5 w-3.5" /> {error}
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando discovery…
      </div>
    );
  }

  const { job, providers, progress } = status;
  const pct = progress.total > 0 ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${STATUS_STYLE[job.status] || STATUS_STYLE.queued}`}>
          {job.status === 'running' || job.status === 'queued' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Radar className="h-3 w-3" />
          )}
          {job.status}
        </span>
        <span className="text-muted-foreground">
          {progress.done}/{progress.total} providers · {job.itemsFound} itens ·{' '}
          {job.estimatedCost > 0 ? `~R$ ${(job.estimatedCost / 100).toFixed(2)}` : 'sem custo'}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{pct}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {providers.map((run) => (
          <span
            key={run.provider}
            title={`${run.provider} — ${run.items} item(ns)${run.errorCode ? ` (${ERROR_LABEL[run.errorCode] || run.errorCode})` : ''}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[run.status] || 'bg-secondary/60 text-muted-foreground'}`}
          >
            {run.provider}
            {run.status === 'failed' && run.errorCode ? ` · ${ERROR_LABEL[run.errorCode] || run.errorCode}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
