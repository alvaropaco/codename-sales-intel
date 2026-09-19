import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Trash2,
  X,
  Loader2,
  Mail,
  MessageCircle,
  Sparkles,
  RotateCcw,
  CircleAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Prospect, ProspectStatus } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';
import {
  updateProspect,
  bulkUpdateProspects,
  rerunDeepAnalysis,
  fetchPlan,
} from '@/services/api';

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

// Pipeline da feature 005: Em Qualificação → Análise profunda → Prontas para
// contato → Clientes ganhos, com Descartados como destino final. O estágio
// "Novas oportunidades" (lead) foi removido — leads novos entram direto em
// "Em Qualificação" (FR-001/FR-002).
const columns: ColumnConfig[] = [
  { id: 'prospect', title: 'Em Qualificação', color: 'border-amber-200 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5' },
  { id: 'deep_analysis', title: 'Análise profunda', color: 'border-sky-200 bg-sky-50/40 dark:border-sky-500/40 dark:bg-sky-500/5' },
  { id: 'qualified', title: 'Prontas para contato', color: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/40 dark:bg-emerald-500/5' },
  { id: 'closed', title: 'Clientes ganhos', color: 'border-purple-200 bg-purple-50/40 dark:border-purple-500/40 dark:bg-purple-500/5' },
  { id: 'discarded', title: 'Descartados', color: 'border-slate-200 bg-slate-50/40 dark:border-slate-500/40 dark:bg-slate-500/5' },
];

// Movimentos manuais — o backend (pipeline-transitions.js) é a fonte da verdade
// e bloqueia o que aqui estiver errado; a UI apenas não oferece o que ele
// veda: retorno para "Em Qualificação", pulos de estágio e saída de
// "Descartados" que não seja a restauração.
const PREV_STAGE: Partial<Record<ProspectStatus, ProspectStatus>> = {
  closed: 'qualified',
};
const NEXT_STAGE: Partial<Record<ProspectStatus, ProspectStatus>> = {
  prospect: 'deep_analysis',
  deep_analysis: 'qualified',
  qualified: 'closed',
};

const checkboxClasses =
  'h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/20 dark:bg-white/5';

export const PipelineKanbanView: React.FC<PipelineKanbanViewProps> = ({
  prospects,
  onSelectProspect,
  onRefresh,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [isPremium, setIsPremium] = useState(true);
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);

  // Banner premium (FR-018): orgs sem o recurso veem a coluna com aviso e
  // fluxo inalterado — nenhum card entra em "Análise profunda" para elas.
  useEffect(() => {
    let cancelled = false;
    fetchPlan()
      .then((plan) => {
        if (!cancelled) setIsPremium(plan.plan === 'premium');
      })
      .catch(() => {
        // falha ao obter o plano não derruba o kanban; assume premium e
        // deixa o backend validar as ações
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMoveStage = async (prospect: Prospect, newStatus: ProspectStatus) => {
    try {
      await updateProspect(prospect.id, { status: newStatus });
      onRefresh();
    } catch (err) {
      // Regras de transição vêm do backend (enriquecimento/análise pendente,
      // retorno proibido etc.) — mostra o motivo.
      alert(err instanceof Error ? err.message : 'Erro ao mover estágio.');
    }
  };

  const handleRestore = async (prospect: Prospect) => {
    setCardBusyId(prospect.id);
    try {
      // Restauração: volta para "Análise profunda" e dispara reanálise (FR-011).
      await handleMoveStage(prospect, 'deep_analysis');
    } finally {
      setCardBusyId(null);
    }
  };

  const handleRerunAnalysis = async (prospect: Prospect) => {
    setCardBusyId(prospect.id);
    try {
      await rerunDeepAnalysis(prospect.id);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao reexecutar a análise.');
    } finally {
      setCardBusyId(null);
    }
  };

  // Polling leve enquanto houver análise em andamento (US4): o card evolui
  // sozinho de "Analisando…" para o veredito, sem ação do usuário. O callback
  // vai por ref para o intervalo não ser recriado a cada render.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const hasPendingAnalysis = prospects.some(
    (p) =>
      p.status === 'deep_analysis' &&
      (p.analysisStatus === 'running' || p.analysisStatus === 'not_started')
  );
  useEffect(() => {
    if (!hasPendingAnalysis) return;
    const timer = setInterval(() => onRefreshRef.current(), 8000);
    return () => clearInterval(timer);
  }, [hasPendingAnalysis]);

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
      const { count, skipped } = await bulkUpdateProspects(Array.from(selectedIds), 'move', status);
      clearSelection();
      onRefresh();
      if (skipped > 0) {
        alert(
          `${count} ${count === 1 ? 'lead movido' : 'leads movidos'}. ${skipped} ${
            skipped === 1 ? 'lead não pôde ser movido' : 'leads não puderam ser movidos'
          } (enriquecimento ou análise em andamento, ou transição não permitida).`
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao mover em lote.');
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

      {/* Aviso premium (FR-018): análise profunda exclusiva do plano premium */}
      {!isPremium && (
        <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-xs font-semibold text-sky-800 backdrop-blur-md dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <Sparkles className="h-4 w-4 shrink-0" />
          A Análise profunda por IA — veredito automático sobre score e contato — é um recurso do
          plano <strong>Premium</strong>. Seus leads continuam avançando direto para "Prontas para
          contato" após o enriquecimento.
        </div>
      )}

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
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
                  {col.id === 'deep_analysis' && (
                    <Sparkles className="h-3.5 w-3.5 text-sky-500" aria-hidden />
                  )}
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

                          {/* Badge "Contatado" — canais em que o lead já recebeu contato real */}
                          {Array.isArray(p.contactedChannels) && p.contactedChannels.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                Contatado
                              </span>
                              {p.contactedChannels.includes('email') && (
                                <span title="Contatado por email" className="text-indigo-400">
                                  <Mail className="h-3 w-3" />
                                </span>
                              )}
                              {p.contactedChannels.includes('whatsapp') && (
                                <span title="Contatado por WhatsApp" className="text-emerald-500">
                                  <MessageCircle className="h-3 w-3" />
                                </span>
                              )}
                            </div>
                          )}

                          {/* Estado da análise profunda (FR-012): card em "Análise
                              profunda" comunica analisando / veredito / falha. */}
                          {col.id === 'deep_analysis' && (
                            <DeepAnalysisCardStatus
                              prospect={p}
                              busy={cardBusyId === p.id}
                              onRerun={handleRerunAnalysis}
                            />
                          )}

                          {/* Veredito resumido no card descartado (FR-010) */}
                          {col.id === 'discarded' && p.verdict === 'no_contact' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400"
                              title="A análise profunda concluiu que não faz sentido entrar em contato — veja o motivo na página de detalhes"
                            >
                              <Sparkles className="h-3 w-3" /> Não contatar (IA)
                            </span>
                          )}

                          {/* Stage Movement Controls */}
                          <div className="flex items-center justify-between pt-2">
                            {/* Voltar: apenas Clientes ganhos → Prontas para contato.
                                Os demais estágios não retroagem (fonte da verdade no
                                backend — pipeline-transitions.js). */}
                            {PREV_STAGE[col.id] && (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveStage(p, PREV_STAGE[col.id]!);
                                }}
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[10px] text-slate-500 dark:text-muted-foreground"
                              >
                                <ChevronLeft className="h-3 w-3 mr-0.5" /> Voltar
                              </Button>
                            )}

                            {/* Avançar / estados de espera */}
                            {col.id === 'prospect' &&
                              (!p.enrichmentStatus || p.enrichmentStatus === 'pending') && (
                                <span
                                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                                  title={
                                    isPremium
                                      ? "O card avança automaticamente para 'Análise profunda' quando o enriquecimento concluir"
                                      : "O card avança automaticamente para 'Prontas para contato' quando o enriquecimento concluir"
                                  }
                                >
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Enriquecendo dados…
                                </span>
                              )}

                            {col.id === 'prospect' &&
                              p.enrichmentStatus &&
                              p.enrichmentStatus !== 'pending' && (
                                <Button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStage(p, 'deep_analysis');
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="ml-auto h-7 px-2 text-[10px] font-bold border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-500/30 dark:text-indigo-300 dark:bg-indigo-500/20"
                                  title="Enriquecimento concluído — avançar para 'Análise profunda'"
                                >
                                  Avançar <ChevronRight className="h-3 w-3 ml-0.5" />
                                </Button>
                              )}

                            {col.id === 'deep_analysis' &&
                              (p.analysisStatus === 'not_started' || p.analysisStatus === 'running') && (
                                <span
                                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
                                  title="A IA está analisando o lead — o veredito define o próximo passo automaticamente"
                                >
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {p.analysisStatus === 'running' ? 'Analisando…' : 'Na fila para análise…'}
                                </span>
                              )}

                            {col.id === 'deep_analysis' &&
                              (p.analysisStatus === 'completed' || p.analysisStatus === 'failed') && (
                                <Button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStage(p, 'qualified');
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="ml-auto h-7 px-2 text-[10px] font-bold border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-500/30 dark:text-indigo-300 dark:bg-indigo-500/20"
                                  title={
                                    p.analysisStatus === 'completed'
                                      ? "Avançar para 'Prontas para contato'"
                                      : 'Análise falhou — avançar manualmente ou reexecutar'
                                  }
                                >
                                  Avançar <ChevronRight className="h-3 w-3 ml-0.5" />
                                </Button>
                              )}

                            {col.id === 'qualified' && (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveStage(p, 'closed');
                                }}
                                variant="outline"
                                size="sm"
                                className="ml-auto h-7 px-2 text-[10px] font-bold border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-500/30 dark:text-indigo-300 dark:bg-indigo-500/20"
                              >
                                Avançar <ChevronRight className="h-3 w-3 ml-0.5" />
                              </Button>
                            )}

                            {/* Restaurar: Descartados → Análise profunda (reanálise) */}
                            {col.id === 'discarded' && (
                              <Button
                                disabled={cardBusyId === p.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestore(p);
                                }}
                                variant="outline"
                                size="sm"
                                className="ml-auto h-7 gap-1 px-2 text-[10px] font-bold border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100 dark:border-slate-500/30 dark:text-slate-300 dark:bg-slate-500/20"
                                title="Restaura para 'Análise profunda' e executa nova análise"
                              >
                                {cardBusyId === p.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                Restaurar
                              </Button>
                            )}
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

/**
 * Estado da análise profunda no card (US4/FR-012): aprovado (selo), falha
 * (erro + reexecutar). Estados de espera são renderizados nos controles de
 * movimento (spinner "Analisando…").
 */
function DeepAnalysisCardStatus({
  prospect,
  busy,
  onRerun,
}: {
  prospect: Prospect;
  busy: boolean;
  onRerun: (p: Prospect) => void;
}) {
  if (prospect.analysisStatus === 'completed') {
    return prospect.verdict === 'contact' ? (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
        title="A análise profunda aprovou o lead — avance ou aguarde o avanço automático"
      >
        <Sparkles className="h-3 w-3" /> Aprovado pela IA
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400"
        title="A IA concluiu que não faz sentido entrar em contato — avance manualmente se discordar (fica registrado) ou veja o motivo nos detalhes"
      >
        <Sparkles className="h-3 w-3" /> Não contatar (IA)
      </span>
    );
  }

  if (prospect.analysisStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        <CircleAlert className="h-3 w-3" />
        Falha na análise
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onRerun(prospect);
          }}
          className="ml-1 inline-flex items-center gap-1 rounded-full border border-rose-300 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-500/20"
          title="Reexecutar a análise profunda"
        >
          {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
          Reexecutar
        </button>
      </span>
    );
  }

  return null;
};
