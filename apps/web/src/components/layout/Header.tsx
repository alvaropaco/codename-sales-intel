import React from 'react';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Command,
  Menu,
  Plus,
  Search,
  Sparkles,
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
    title: 'CRM Dashboard',
    subtitle: '16 Jul 2026 - 12 Aug 2026 · visão executiva do funil SalesIntel.',
  },
  prospects: {
    title: 'Leads & CNPJs',
    subtitle: 'Base completa de empresas qualificadas e persistidas no PostgreSQL.',
  },
  pipeline: {
    title: 'Sales Pipeline',
    subtitle: 'Acompanhamento kanban de oportunidades e progressão comercial.',
  },
  risk: {
    title: 'Credit Risk & Intelligence Engine',
    subtitle: 'Avaliação automatizada de risco financeiro e scoring de CNPJ.',
  },
  workflows: {
    title: 'Workflow Automation',
    subtitle: 'Triggers automáticos para cadências e regras de qualificação.',
  },
  enrichment: {
    title: 'CNPJ Enrichment',
    subtitle: 'Extração de sócios, emails e telefones dos CNPJs via MCP/PostgreSQL.',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Configurações de ambiente, multi-tenancy e integrações MCP.',
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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/85 sm:px-6 xl:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Open dashboard navigation"
            aria-controls="mobile-dashboard-navigation"
            onClick={() => document.getElementById('mobile-dashboard-navigation')?.scrollIntoView({ block: 'nearest', inline: 'start' })}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 lg:hidden dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>SalesIntel</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="truncate text-slate-950 dark:text-white">{info.title}</span>
            </div>
            <h2 className="truncate text-lg font-black tracking-tight text-slate-950 dark:text-white sm:text-xl">
              {info.title}
            </h2>
            <p className="hidden text-xs text-slate-500 dark:text-slate-400 md:block">{info.subtitle}</p>
          </div>
        </div>

        <div className="hidden flex-1 justify-center px-4 xl:flex">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search leads, CNPJ, opportunities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-20 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]"
            />
            <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-400 dark:border-white/10 dark:bg-white/5 lg:flex">
              <Command className="h-3 w-3" /> K
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={onOpenQualifyModal}
            variant="outline"
            size="sm"
            className="hidden h-10 gap-2 rounded-xl border-slate-200 bg-white text-xs font-bold dark:border-white/10 dark:bg-white/[0.03] sm:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            AI Qualify
          </Button>
          <Button
            onClick={onOpenCreateModal}
            size="sm"
            className="h-10 gap-2 rounded-xl bg-slate-950 px-4 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            <Plus className="h-4 w-4" />
            New Lead
          </Button>
          <button className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white">
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-slate-950" />
          </button>
          <button className="hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white md:block">
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
