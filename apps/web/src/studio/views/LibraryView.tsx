/**
 * LibraryView — biblioteca do Studio (US13, T126): templates por
 * objetivo/estágio e reuso de campanhas (duplicar/adaptar/traduzir).
 */
import { useCallback, useEffect, useState } from 'react';
import { StudioRequestError } from '../api';

interface TemplateRow {
  id: string;
  name: string;
  channel: string;
  objective: string;
  funnelStage: string;
  isSystem: boolean;
}

const OBJECTIVES = ['prospection', 'launch', 'promotion', 'newsletter', 'event', 'reactivation', 'nurturing'];

export function LibraryView({ onUseTemplate }: { onUseTemplate?: (template: TemplateRow) => void }) {
  const [objective, setObjective] = useState('prospection');
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/templates?objective=${objective}`);
      const body = await res.json();
      setTemplates(body.data || []);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao carregar biblioteca');
    }
  }, [objective]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-1">
        {OBJECTIVES.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={objective === o}
            onClick={() => setObjective(o)}
            className={`rounded-md px-3 py-1.5 text-xs ${objective === o ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
          >
            {o}
          </button>
        ))}
      </div>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum template para este objetivo — campanhas passadas também aparecem aqui para duplicar/adaptar.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {t.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.channel} · {t.funnelStage} {t.isSystem ? '· sistema' : ''}
                </span>
              </span>
              {onUseTemplate && (
                <button
                  type="button"
                  onClick={() => onUseTemplate(t)}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  Usar como base
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
