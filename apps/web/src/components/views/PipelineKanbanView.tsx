import React from 'react';
import { 
  ChevronRight, 
  ChevronLeft
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Prospect, ProspectStatus } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';
import { updateProspect } from '@/services/api';

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

export const PipelineKanbanView: React.FC<PipelineKanbanViewProps> = ({
  prospects,
  onSelectProspect,
  onRefresh,
}) => {
  const handleMoveStage = async (prospect: Prospect, newStatus: ProspectStatus) => {
    try {
      await updateProspect(prospect.id, { status: newStatus });
      onRefresh();
    } catch (err) {
      console.error('Erro ao mover estágio:', err);
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

      {/* Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {columns.map((col) => {
          const colProspects = prospects.filter((p) => p.status === col.id);
          const totalValue = colProspects.reduce((sum, p) => sum + (p.revenueEstimate || 0), 0);

          return (
            <div 
              key={col.id} 
              className={`rounded-2xl border ${col.color} p-4 flex flex-col h-[calc(100vh-250px)] backdrop-blur-md`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-border/60">
                <div className="flex items-center gap-2">
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
                  colProspects.map((p) => (
                    <Card 
                      key={p.id}
                      className="glass-card hover:border-indigo-400 hover:shadow-md transition-all duration-150 cursor-pointer bg-white"
                      onClick={() => onSelectProspect(p)}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <h4 className="font-bold text-sm text-slate-900 dark:text-foreground line-clamp-1">
                            {p.companyName}
                          </h4>
                          <span className="font-extrabold text-xs text-indigo-600 dark:text-indigo-400">
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
                  ))
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
