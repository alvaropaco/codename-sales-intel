/**
 * CampaignsListView — lista de campanhas do Studio (T013).
 * Estados de carregamento/erro/vazio explícitos; criação inline (US1 usa o
 * mesmo endpoint — toda campanha nasce `draft`, FR-002).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createCampaign,
  fetchCampaigns,
  StudioRequestError,
} from '../api';
import type { StudioCampaignSummary } from '../types';

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

const ORIGIN_LABEL: Record<string, string> = {
  manual: 'Manual',
  ai_prompt: 'IA · prompt',
  material: 'IA · material',
  url: 'IA · URL',
  company_data: 'IA · dados da conta',
  duplicate: 'Duplicada',
  template: 'Template',
  agent: 'Agente IA',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

export function originLabel(origin: string): string {
  return ORIGIN_LABEL[origin] || origin;
}

export interface CampaignsListViewProps {
  onOpenCampaign: (campaign: StudioCampaignSummary) => void;
}

export function CampaignsListView({ onOpenCampaign }: CampaignsListViewProps) {
  const [campaigns, setCampaigns] = useState<StudioCampaignSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setCampaigns(await fetchCampaigns());
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao carregar campanhas');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim() || `Campanha ${new Date().toLocaleDateString('pt-BR')}`;
    setIsCreating(true);
    try {
      const created = await createCampaign({ name, channels: ['email', 'whatsapp'] });
      setNewName('');
      onOpenCampaign({ ...created, audienceCount: 0, sentCount: 0 });
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao criar campanha');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section aria-label="Campanhas">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Campanhas</h2>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da nova campanha"
            className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {isCreating ? 'Criando…' : 'Nova campanha'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando campanhas…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium">Nenhuma campanha ainda</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie sua primeira campanha acima — ela nasce em rascunho e só dispara
            após revisão e aprovação.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {campaigns.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpenCampaign(c)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {originLabel(c.origin)} · {(c.channels || []).join(' + ') || 'sem canal'} ·{' '}
                    {c.audienceCount ?? 0} leads
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs">
                  {statusLabel(c.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
