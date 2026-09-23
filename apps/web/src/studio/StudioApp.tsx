/**
 * StudioApp — shell próprio do Campaign Studio (specs/010, T005).
 *
 * Área separada do app: rota `/studio` renderizada FORA do shell de tabs
 * (App.tsx), com layout e navegação próprios e tema dark forçado via classe
 * `dark` no wrapper (tokens `.dark` já existem em index.css).
 *
 * Navegação interna por pathname (`/studio/campaigns`, `/studio/campaigns/:id`,
 * …) sem react-router — mesmo padrão de `tabFromPath` do App.
 */
import { useCallback, useEffect, useState } from 'react';
import { CampaignsListView } from './views/CampaignsListView';
import { CampaignDetailView } from './views/CampaignDetailView';
import { AgentPanel } from './components/AgentPanel';
import { BrandSettings } from './components/BrandSettings';
import type { StudioCampaignSummary } from './types';

function studioPath(): string {
  return window.location.pathname.replace(/^\/studio/, '') || '/';
}

function navigateStudio(path: string) {
  window.history.pushState(null, '', `/studio${path === '/' ? '' : path}`);
  // Dispara a sincronização do shell com a nova rota.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface StudioAppProps {
  userName?: string | null;
  onExit?: () => void;
}

export function StudioApp({ userName, onExit }: StudioAppProps) {
  const [path, setPath] = useState(studioPath);

  useEffect(() => {
    const onPopState = () => setPath(studioPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const exitStudio = useCallback(() => {
    if (onExit) {
      onExit();
      return;
    }
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [onExit]);

  // ── Roteamento interno ─────────────────────────────────────────────────
  const campaignMatch = path.match(/^\/campaigns\/([\w-]+)\/?$/);

  let content: React.ReactNode;
  if (campaignMatch) {
    content = <CampaignDetailView campaignId={campaignMatch[1]} />;
  } else if (path === '/agent') {
    content = <AgentPanel />;
  } else if (path === '/brand') {
    content = <BrandSettings />;
  } else {
    content = (
      <CampaignsListView
        onOpenCampaign={(c: StudioCampaignSummary) => navigateStudio(`/campaigns/${c.id}`)}
      />
    );
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col">
        {/* Header do Studio — identidade própria, fora do shell padrão. */}
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
              S
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Campaign Studio</h1>
              <p className="text-xs text-muted-foreground">
                Crie, revise e orquestre campanhas — nada sai sem sua aprovação
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <nav className="flex gap-2">
              <button
                type="button"
                onClick={() => navigateStudio('/')}
                className="rounded-md px-2 py-1 hover:bg-accent"
              >
                Campanhas
              </button>
              <button
                type="button"
                onClick={() => navigateStudio('/agent')}
                className="rounded-md px-2 py-1 hover:bg-accent"
              >
                Agente IA
              </button>
              <button
                type="button"
                onClick={() => navigateStudio('/brand')}
                className="rounded-md px-2 py-1 hover:bg-accent"
              >
                Marca
              </button>
            </nav>
            {userName && <span>{userName}</span>}
            <button
              type="button"
              onClick={exitStudio}
              className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-accent"
            >
              Sair do Studio
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">{content}</main>
      </div>
    </div>
  );
}
