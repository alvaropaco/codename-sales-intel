import React, { useState } from 'react';
import { 
  Workflow, 
  Plus, 
  Zap, 
  CheckCircle2, 
  Play, 
  Pause, 
  Sliders,
  ArrowRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { WorkflowItem } from '@/types';
import { createWorkflow } from '@/services/api';

export const WorkflowsView: React.FC = () => {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([
    {
      id: 1,
      name: 'Qualificação Automática CNPJ > 70',
      trigger: 'Ao cadastrar novo prospecto',
      action: 'Mover para Qualificado & Notificar Vendedor',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      name: 'Alerta de Risco Financeiro Médio',
      trigger: 'Risco de crédito < 60',
      action: 'Marcar para revisão de compliance',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ]);

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('Novo CNPJ cadastrado');
  const [action, setAction] = useState('Disparar enriquecimento de dados');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const newWf = await createWorkflow({ name, trigger, action });
      setWorkflows([newWf, ...workflows]);
      setName('');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Automações & Workflows de Qualificação
        </h1>
        <p className="text-xs text-muted-foreground">
          Crie gatilhos automáticos para qualificação, distribuição de leads e inteligência de dados.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Workflow Card */}
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
                <Workflow className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Novo Workflow</CardTitle>
                <CardDescription>Configure uma nova regra de automação</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nome da Regra</label>
                <Input
                  placeholder="Ex: Auto-distribuição por Região"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Gatilho (Trigger)</label>
                <Input
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Ação Executada</label>
                <Input
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>

              <Button
                type="submit"
                variant="gradient"
                className="w-full text-xs gap-2"
              >
                <Plus className="h-4 w-4" />
                Ativar Workflow
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Active Workflows List */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold">Workflows Ativos ({workflows.length})</CardTitle>
            <CardDescription>Regras em execução em tempo real na plataforma</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workflows.map((wf) => (
              <div 
                key={wf.id}
                className="p-4 rounded-xl bg-secondary/30 border border-border/80 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <h4 className="font-bold text-sm text-foreground">{wf.name}</h4>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Gatilho: <strong className="text-foreground">{wf.trigger}</strong></span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>Ação: <strong className="text-indigo-400">{wf.action}</strong></span>
                  </div>
                </div>

                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 self-start md:self-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Ativo
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
