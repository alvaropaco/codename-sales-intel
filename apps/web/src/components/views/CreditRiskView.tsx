import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Sparkles, 
  Zap, 
  Search, 
  CheckCircle, 
  AlertTriangle,
  TrendingDown,
  Building
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CreditRiskResult } from '@/types';
import { assessCreditRisk } from '@/services/api';
import { formatCNPJ } from '@/lib/utils';

export const CreditRiskView: React.FC = () => {
  const [cnpjInput, setCnpjInput] = useState('');
  const [riskData, setRiskData] = useState<CreditRiskResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnpjInput.trim()) return;
    setLoading(true);
    try {
      const res = await assessCreditRisk(cnpjInput);
      setRiskData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Risco e potencial do lead
        </h1>
        <p className="text-xs text-muted-foreground">
          Avalie se um lead tem perfil financeiro adequado para avançar no funil comercial.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Search Card */}
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Consultar lead</CardTitle>
                <CardDescription>Informe a identificação do lead para análise</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAnalyze} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Identificação do lead</label>
                <Input
                  placeholder="Ex: 12.345.678/0001-95"
                  value={cnpjInput}
                  onChange={(e) => setCnpjInput(e.target.value)}
                  className="bg-secondary/40 text-xs font-mono"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !cnpjInput.trim()}
                variant="gradient"
                className="w-full text-xs gap-2"
              >
                {loading ? (
                  <>Consultando indicadores financeiros...</>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Analisar Saúde Financeira
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results Card */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold">Resumo financeiro e comercial</CardTitle>
            <CardDescription>
              {riskData ? `Resultado para ${formatCNPJ(cnpjInput)}` : 'Aguardando consulta do lead'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {riskData ? (
              <div className="space-y-6 animate-fadeIn">
                {/* Score Gauge Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-secondary/40 border border-border/80 text-center">
                    <span className="text-xs text-muted-foreground font-semibold uppercase">Segurança comercial</span>
                    <p className="text-4xl font-black text-indigo-400 mt-1">{riskData.score}/100</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Quanto maior, menor o risco</p>
                  </div>

                  <div className="p-4 rounded-xl bg-secondary/40 border border-border/80 text-center">
                    <span className="text-xs text-muted-foreground font-semibold uppercase">Nível de Risco</span>
                    <div className="mt-2">
                      <Badge variant={riskData.level === 'low' ? 'qualified' : 'prospect'}>
                        {riskData.level === 'low' ? 'RISCO BAIXO' : 'RISCO MÉDIO'}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">Aprovado para limite padrão</p>
                  </div>

                  <div className="p-4 rounded-xl bg-secondary/40 border border-border/80 text-center">
                    <span className="text-xs text-muted-foreground font-semibold uppercase">Momento comercial</span>
                    <p className="text-sm font-bold text-emerald-400 mt-2">ALTA CAPACIDADE</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Sem restrições ativas</p>
                  </div>
                </div>

                {/* Risk Factors List */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fatores Analisados</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {riskData.factors.map((factor, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-300">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                        <span className="capitalize font-semibold">{factor.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-muted-foreground text-center">
                <ShieldAlert className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-semibold">Nenhuma consulta realizada ainda</p>
                <p className="text-xs mt-1">Insira o CNPJ de um lead no campo ao lado para visualizar a avaliação de risco completa.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
