import React, { useState } from 'react';
import { X, Building2, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProspectStatus } from '@/types';
import { createProspect } from '@/services/api';

interface ProspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ProspectModal: React.FC<ProspectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [cnpj, setCnpj] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('Software');
  const [employees, setEmployees] = useState('100');
  const [status, setStatus] = useState<ProspectStatus>('prospect');
  const [revenueEstimate, setRevenueEstimate] = useState('2500000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnpj || !companyName) {
      setError('Por favor preencha o CNPJ e a Razão Social.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await createProspect({
        cnpj,
        companyName,
        industry,
        employees: parseInt(employees) || 50,
        status,
        revenueEstimate: parseInt(revenueEstimate) || 1000000,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar esta empresa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 relative">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Adicionar empresa à lista</h3>
              <p className="text-xs text-muted-foreground">Use apenas quando quiser acompanhar uma empresa específica.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/20 border border-destructive/30 text-destructive text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Identificação da empresa *</label>
              <Input
                placeholder="12.345.678/0001-99"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                className="bg-secondary/40 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Nome da empresa *</label>
              <Input
                placeholder="Nome da Empresa LTDA"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="bg-secondary/40 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Segmento de atuação</label>
              <Input
                placeholder="Software / Logística / Varejo"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="bg-secondary/40 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Nº de Funcionários</label>
              <Input
                type="number"
                placeholder="150"
                value={employees}
                onChange={(e) => setEmployees(e.target.value)}
                className="bg-secondary/40 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Estimativa de Receita (R$)</label>
              <Input
                type="number"
                placeholder="5000000"
                value={revenueEstimate}
                onChange={(e) => setRevenueEstimate(e.target.value)}
                className="bg-secondary/40 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Estágio Inicial</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProspectStatus)}
                className="h-10 w-full rounded-lg border border-border/80 bg-secondary/50 px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="lead">Nova oportunidade</option>
                <option value="prospect">Em avaliação</option>
                <option value="qualified">Pronta para contato</option>
              </select>
            </div>
          </div>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-border">
            <Button type="button" onClick={onClose} variant="ghost" size="sm" className="text-xs">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} variant="gradient" size="sm" className="text-xs gap-1.5">
              {loading ? 'Salvando...' : 'Salvar empresa'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
