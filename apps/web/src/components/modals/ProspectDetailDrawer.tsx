import React from 'react';
import { 
  X, 
  Building2, 
  ShieldCheck, 
  CheckCircle2, 
  Users, 
  DollarSign, 
  Calendar, 
  Activity,
  FileText,
  Trash2,
  Edit3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Prospect } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';

interface ProspectDetailDrawerProps {
  prospect: Prospect | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const ProspectDetailDrawer: React.FC<ProspectDetailDrawerProps> = ({
  prospect,
  onClose,
  onDelete,
}) => {
  if (!prospect) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-card border-l border-border shadow-2xl p-6 flex flex-col justify-between overflow-y-auto">
          {/* Top Bar */}
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground leading-tight">
                    {prospect.companyName}
                  </h3>
                  <p className="text-xs font-mono text-muted-foreground">
                    {formatCNPJ(prospect.cnpj)}
                  </p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Status Bar */}
            <div className="my-5 p-4 rounded-xl bg-secondary/40 border border-border/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Potencial comercial</span>
                <p className="text-2xl font-black text-indigo-400">{prospect.opportunityScore}/100</p>
              </div>
              <Badge variant={prospect.status === 'qualified' ? 'qualified' : 'prospect'}>
                {prospect.status.toUpperCase()}
              </Badge>
            </div>

            {/* Details Grid */}
            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground font-semibold">Segmento de atuação</span>
                <p className="font-medium text-foreground">{prospect.industry || 'Software & Serviços'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Funcionários</span>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    {prospect.employees || 150} colaboradores
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Faturamento Est.</span>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatCurrency(prospect.revenueEstimate || 5000000)}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Saúde financeira: favorável</span>
                </div>
                <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                  Sem pendências fiscais na Receita Federal. Histórico de pagamento pontual verificado.
                </p>
              </div>

              {/* Activity Timeline */}
              <div className="pt-4 border-t border-border space-y-3">
                <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-indigo-400" />
                  Histórico de Atividades
                </h4>
                <div className="space-y-2.5 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                    <p className="font-semibold text-foreground">Disparo de Qualificação Automática</p>
                    <p className="text-muted-foreground text-[10px]">Hoje, 11:35 • Recomendação comercial</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                    <p className="font-semibold text-foreground">Empresa salva na sua lista</p>
                    <p className="text-muted-foreground text-[10px]">Data de criação: {new Date(prospect.createdAt).toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
            <Button
              onClick={() => {
                onDelete(prospect.id);
                onClose();
              }}
              variant="destructive"
              size="sm"
              className="text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>

            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
