import React from 'react';
import { 
  LayoutDashboard, 
  Building2, 
  Kanban, 
  ShieldCheck, 
  Workflow, 
  Settings, 
  Sparkles, 
  Sun, 
  Moon, 
  Database
} from 'lucide-react';
import { ActiveTab } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  totalProspectsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isDark,
  setIsDark,
  totalProspectsCount,
}) => {
  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: 'Visão Geral (Dashboard)',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'prospects' as ActiveTab,
      label: 'Diretório de CNPJs',
      icon: Building2,
      badge: totalProspectsCount > 0 ? `${totalProspectsCount}` : null,
    },
    {
      id: 'pipeline' as ActiveTab,
      label: 'Pipeline & Funil CRM',
      icon: Kanban,
      badge: 'Kanban',
    },
    {
      id: 'risk' as ActiveTab,
      label: 'Risco de Crédito & AI',
      icon: ShieldCheck,
      badge: 'AI Engine',
      isNew: true,
    },
    {
      id: 'workflows' as ActiveTab,
      label: 'Automações & Regras',
      icon: Workflow,
      badge: null,
    },
  ];

  return (
    <aside className="w-72 bg-sidebar border-r border-sidebar-border flex flex-col justify-between h-screen sticky top-0 z-40 transition-colors duration-200">
      {/* Top Brand Header */}
      <div>
        <div className="h-16 px-6 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/25">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight leading-none text-sidebar-foreground">
                Sales<span className="text-indigo-600 dark:text-indigo-400">Intel</span>
              </h1>
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mt-0.5">
                Enterprise CRM
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:bg-emerald-500/10">
            PROD
          </Badge>
        </div>

        {/* Navigation Section */}
        <div className="p-4 space-y-6">
          <div>
            <p className="px-3 text-[11px] font-bold text-slate-400 dark:text-muted-foreground uppercase tracking-wider mb-2">
              Plataforma
            </p>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all duration-150 group relative",
                      isActive
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "text-slate-600 dark:text-sidebar-foreground/80 hover:bg-slate-100 dark:hover:bg-sidebar-accent hover:text-slate-900 dark:hover:text-sidebar-foreground"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", isActive ? "text-white" : "text-slate-400 dark:text-muted-foreground")} />
                      <span>{item.label}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {item.isNew && (
                        <span className="h-2 w-2 rounded-full bg-indigo-400 animate-ping" />
                      )}
                      {item.badge && (
                        <span className={cn(
                          "px-2 py-0.5 text-[10px] rounded-full font-bold",
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 text-slate-600 dark:bg-sidebar-accent dark:text-muted-foreground"
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Quick Metrics Callout Card */}
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-gradient-to-b dark:from-indigo-500/10 dark:to-transparent p-4 relative overflow-hidden">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 mb-1.5">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">CNPJ Engine AI</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-muted-foreground leading-relaxed">
              Base enriquecida conectada ao PostgreSQL com inteligência comercial em tempo real.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Sidebar Settings & User Profile */}
      <div className="p-4 border-t border-sidebar-border space-y-3">
        {/* Dark/Light mode toggle */}
        <button
          onClick={() => setIsDark(!isDark)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-sidebar-foreground/80 hover:bg-slate-100 dark:hover:bg-sidebar-accent transition-colors border border-slate-200/80 dark:border-sidebar-border bg-white dark:bg-transparent"
        >
          <div className="flex items-center gap-2.5">
            {isDark ? <Moon className="h-4 w-4 text-indigo-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
            <span>{isDark ? 'Modo Escuro' : 'Modo Claro'}</span>
          </div>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 dark:bg-sidebar-accent text-slate-600 dark:text-muted-foreground">
            {isDark ? 'Dark' : 'Light (Padrão)'}
          </span>
        </button>

        {/* User Card */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100/70 dark:bg-sidebar-accent/50 border border-slate-200/80 dark:border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">
              AP
            </div>
            <div className="truncate">
              <p className="text-xs font-bold text-slate-900 dark:text-sidebar-foreground truncate">
                Álvaro Paco
              </p>
              <p className="text-[10px] text-slate-500 dark:text-muted-foreground truncate">
                SalesIntel Demo
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('settings')}
            className="p-1 text-slate-400 hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground rounded transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
