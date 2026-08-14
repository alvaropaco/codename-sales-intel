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
      name: 'Priorizar leads com alto potencial',
      trigger: 'Quando um novo lead combinar com o perfil ideal',
      action: 'Enviar para o vendedor responsável',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      name: 'Alerta de atenção financeira',
      trigger: 'Risco de crédito < 60',
      action: 'Marcar para revisão comercial',
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ]);

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('Novo lead sugerido');
  const [action, setAction] = useState('Criar próxima ação para o vendedor');

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
          Ações automáticas de vendas
        </h1>
        <p className="text-xs text-muted-foreground">
          Configure regras para priorizar oportunidades, distribuir leads e lembrar o time dos próximos contatos.
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
                <CardTitle className="text-base font-bold">Nova regra comercial</CardTitle>
                <CardDescription>Defina quando a plataforma deve sugerir uma ação</CardDescription>
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
                <label className="text-xs font-semibold text-muted-foreground">Quando isso acontecer</label>
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
                Ativar regra
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Active Workflows List */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold">Regras ativas ({workflows.length})</CardTitle>
            <CardDescription>Ações comerciais prontas para apoiar o time de vendas</CardDescription>
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
