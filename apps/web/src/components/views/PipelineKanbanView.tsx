import React, { useState } from 'react';
import { 
  ChevronRight, 
  ChevronLeft,
  Trash2,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Prospect, ProspectStatus } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';
import { updateProspect, bulkUpdateProspects } from '@/services/api';

interface PipelineKanbanViewProps {
  prospects: Prospect[];
  onSelectProspect: (prospect: Prospect) => void;
  onRefresh: () => void;
}

interface ColumnConfig {
  id: ProspectStatus;
  title: string;
  color: string;
}

const columns: ColumnConfig[] = [
  { id: 'lead', title: 'Novas oportunidades', color: 'border-blue-200 bg-blue-50/40 dark:border-blue-500/40 dark:bg-blue-500/5' },
  { id: 'prospect', title: 'Em Qualificação', color: 'border-amber-200 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5' },
  { id: 'qualified', title: 'Prontas para contato', color: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/40 dark:bg-emerald-500/5' },
  { id: 'closed', title: 'Clientes ganhos', color: 'border-purple-200 bg-purple-50/40 dark:border-purple-500/40 dark:bg-purple-500/5' },
];

const checkboxClasses =
  'h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/20 dark:bg-white/5';

export const PipelineKanbanView: React.FC<PipelineKanbanViewProps> = ({
  prospects,
  onSelectProspect,
  onRefresh,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleMoveStage = async (prospect: Prospect, newStatus: ProspectStatus) => {
    try {
      await updateProspect(prospect.id, { status: newStatus });
      onRefresh();
    } catch (err) {
      console.error('Erro ao mover estágio:', err);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleColumn = (colProspects: Prospect[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const ids = colProspects.map((p) => p.id);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkMove = async (status: ProspectStatus) => {
    if (!selectedIds.size) return;
    setBulkBusy(true);
    try {
      await bulkUpdateProspects(Array.from(selectedIds), 'move', status);
      clearSelection();
      onRefresh();
    } catch (err) {
      console.error('Erro ao mover em lote:', err);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    const label = selectedIds.size === 1 ? 'prospecto selecionado' : 'prospectos selecionados';
    if (!confirm(`Excluir ${selectedIds.size} ${label}? Esta ação não pode ser desfeita.`)) return;
    setBulkBusy(true);
    try {
      await bulkUpdateProspects(Array.from(selectedIds), 'delete');
      clearSelection();
      onRefresh();
    } catch (err) {
      console.error('Erro ao excluir em lote:', err);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
          Pipeline de oportunidades
        </h1>
        <p className="text-xs text-slate-500 dark:text-muted-foreground">
          Acompanhe a evolução dos leads sugeridos até virarem oportunidades comerciais reais.
        </p>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 backdrop-blur-md dark:border-indigo-500/30 dark:bg-indigo-500/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black text-indigo-900 dark:text-indigo-100">
              {selectedIds.size} {selectedIds.size === 1 ? 'selecionado' : 'selecionados'}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-100"
            >
              <X className="h-3.5 w-3.5" /> Limpar seleção
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value=""
              disabled={bulkBusy}
              onChange={(event) => {
                const status = event.target.value as ProspectStatus;
                if (status) handleBulkMove(status);
              }}
              className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-500/30 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="" disabled>
                Mover para…
              </option>
              {columns.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.title}
                </option>
              ))}
            </select>

            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={bulkBusy}
              className="h-9 gap-2 rounded-lg px-4 text-xs font-bold"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      {/* Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {columns.map((col) => {
          const colProspects = prospects.filter((p) => p.status === col.id);
          const totalValue = colProspects.reduce((sum, p) => sum + (p.revenueEstimate || 0), 0);
          const colIds = colProspects.map((p) => p.id);
          const colSelectedCount = colIds.filter((id) => selectedIds.has(id)).length;
          const allSelected = colIds.length > 0 && colSelectedCount === colIds.length;
          const someSelected = colSelectedCount > 0 && !allSelected;

          return (
            <div 
              key={col.id} 
              className={`rounded-2xl border ${col.color} p-4 flex flex-col h-[calc(100vh-250px)] backdrop-blur-md`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-border/60">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={colProspects.length === 0}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => toggleColumn(colProspects)}
                    className={checkboxClasses}
                    aria-label={`Selecionar todos em ${col.title}`}
                  />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-foreground">{col.title}</h3>
                  <span className="px-2 py-0.5 rounded-full bg-white dark:bg-secondary text-[11px] font-bold text-slate-700 dark:text-muted-foreground shadow-xs border border-slate-200 dark:border-transparent">
                    {colProspects.length}
                  </span>
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">
                  {formatCurrency(totalValue)}
                </span>
              </div>

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
                {colProspects.length > 0 ? (
                  colProspects.map((p) => {
                    const isSelected = selectedIds.has(p.id);
                    return (
                      <Card 
                        key={p.id}
                        className={`glass-card hover:border-indigo-400 hover:shadow-md transition-all duration-150 cursor-pointer bg-white ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : ''}`}
                        onClick={() => onSelectProspect(p)}
                      >
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(p.id)}
                                onClick={(e) => e.stopPropagation()}
                                className={`${checkboxClasses} mt-0.5`}
                                aria-label={`Selecionar ${p.companyName}`}
                              />
                              <h4 className="font-bold text-sm text-slate-900 dark:text-foreground line-clamp-1">
                                {p.companyName}
                              </h4>
                            </div>
                            <span className="shrink-0 font-extrabold text-xs text-indigo-600 dark:text-indigo-400">
                              {p.opportunityScore}/100
                            </span>
                          </div>

                          <div className="text-xs font-mono text-slate-500 dark:text-muted-foreground font-semibold">
                            {formatCNPJ(p.cnpj)}
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-muted-foreground pt-2 border-t border-slate-100 dark:border-border/40 font-medium">
                            <span>{p.industry || 'Segmento a confirmar'}</span>
                            <span className="font-bold text-slate-900 dark:text-foreground">
                              {p.revenueEstimate ? formatCurrency(p.revenueEstimate) : 'A confirmar'}
                            </span>
                          </div>

                          {/* Stage Movement Controls */}
                          <div className="flex items-center justify-between pt-2">
                            <Button
                              disabled={col.id === 'lead'}
                              onClick={(e) => {
                                e.stopPropagation();
                                const prevStage = col.id === 'closed' ? 'qualified' : col.id === 'qualified' ? 'prospect' : 'lead';
                                handleMoveStage(p, prevStage as ProspectStatus);
                              }}
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[10px] text-slate-500 dark:text-muted-foreground"
                            >
                              <ChevronLeft className="h-3 w-3 mr-0.5" /> Voltar
                            </Button>

                            <Button
                              disabled={col.id === 'closed'}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextStage = col.id === 'lead' ? 'prospect' : col.id === 'prospect' ? 'qualified' : 'closed';
                                handleMoveStage(p, nextStage as ProspectStatus);
                              }}
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[10px] font-bold border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-500/30 dark:text-indigo-300 dark:bg-indigo-500/20"
                            >
                              Avançar <ChevronRight className="h-3 w-3 ml-0.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <div className="h-32 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-border/60 text-slate-400 dark:text-muted-foreground text-xs text-center p-4">
                    <p className="font-semibold">Nenhum lead neste estágio</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
