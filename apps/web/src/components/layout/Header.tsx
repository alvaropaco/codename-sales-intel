import React from 'react';
import { 
  Search, 
  Plus, 
  Bell, 
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActiveTab } from '@/types';

interface HeaderProps {
  activeTab: ActiveTab;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenCreateModal: () => void;
  onOpenQualifyModal: () => void;
}

const tabTitles: Record<ActiveTab, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Visão Geral Executiva',
    subtitle: 'Métricas em tempo real, forecast de receita e inteligência de mercado B2B.',
  },
  prospects: {
    title: 'Diretório de Prospectos & CNPJs',
    subtitle: 'Base completa de empresas qualificadas salvas no PostgreSQL.',
  },
  pipeline: {
    title: 'Funil CRM & Estágios de Venda',
    subtitle: 'Acompanhamento kanban de oportunidades e progressão de deals.',
  },
  risk: {
    title: 'Credit Risk & Intelligence Engine',
    subtitle: 'Avaliação automatizada de risco financeiro e scoring de CNPJ.',
  },
  workflows: {
    title: 'Automações & Regras de Qualificação',
    subtitle: 'Triggers automáticos para disparo de workflows de prospecção.',
  },
  settings: {
    title: 'Configurações do Sistema',
    subtitle: 'Gerenciamento de conta, multi-tenancy e chaves de integração.',
  },
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  searchQuery,
  setSearchQuery,
  onOpenCreateModal,
  onOpenQualifyModal,
}) => {
  const info = tabTitles[activeTab];

  return (
    <header className="h-20 border-b border-border bg-white dark:bg-background/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
      {/* Title & Breadcrumbs */}
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground mb-0.5 font-medium">
          <span>SalesIntel</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-slate-900 dark:text-foreground font-semibold capitalize">{activeTab}</span>
        </div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-foreground">
          {info.title}
        </h2>
      </div>

      {/* Actions & Search */}
      <div className="flex items-center gap-4">
        {/* Quick Search */}
        <div className="relative w-64 md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por CNPJ ou Empresa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 h-9 bg-slate-50 dark:bg-secondary/50 text-xs border-slate-200 dark:border-border/80 text-slate-900 dark:text-foreground rounded-lg focus:bg-white dark:focus:bg-background transition-all shadow-xs"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            onClick={onOpenQualifyModal}
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Qualificar CNPJ
          </Button>

          <Button
            onClick={onOpenCreateModal}
            variant="gradient"
            size="sm"
            className="h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20"
          >
            <Plus className="h-4 w-4" />
            Novo Prospecto
          </Button>
        </div>

        {/* Notifications Icon */}
        <button className="relative p-2 text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground rounded-lg hover:bg-slate-100 dark:hover:bg-secondary/60 transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-500 ring-2 ring-white dark:ring-background" />
        </button>
      </div>
    </header>
  );
};
