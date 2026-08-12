import React, { useState } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  TrendingUp, 
  DollarSign, 
  ArrowUpRight, 
  Sparkles,
  Zap,
  ChevronRight,
  Plus
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Prospect, PipelineAnalytics, ForecastAnalytics, QualificationResult } from '@/types';
import { formatCNPJ, formatCurrency } from '@/lib/utils';
import { qualifyCompany } from '@/services/api';

interface ExecutiveDashboardViewProps {
  prospects: Prospect[];
  analytics: PipelineAnalytics;
  forecast: ForecastAnalytics;
  onOpenCreateModal: () => void;
  onSelectProspect: (prospect: Prospect) => void;
  onNavigateToTab: (tab: any) => void;
}

const mockRevenueChartData = [
  { month: 'Jan', revenue: 95000, qualified: 12 },
  { month: 'Fev', revenue: 110000, qualified: 15 },
  { month: 'Mar', revenue: 125000, qualified: 18 },
  { month: 'Abr', revenue: 140000, qualified: 22 },
  { month: 'Mai', revenue: 165000, qualified: 25 },
  { month: 'Jun (Forecast)', revenue: 185000, qualified: 30 },
];

export const ExecutiveDashboardView: React.FC<ExecutiveDashboardViewProps> = ({
  prospects,
  analytics,
  forecast,
  onOpenCreateModal,
  onSelectProspect,
  onNavigateToTab,
}) => {
  const [quickQualifyName, setQuickQualifyName] = useState('');
  const [quickResult, setQuickResult] = useState<QualificationResult | null>(null);
  const [isQualifying, setIsQualifying] = useState(false);

  const handleQuickQualify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickQualifyName.trim()) return;
    setIsQualifying(true);
    try {
      const res = await qualifyCompany(quickQualifyName);
      setQuickResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsQualifying(false);
    }
  };

  const statusBreakdownData = [
    { name: 'Qualificados', count: analytics.qualified, color: '#10b981' },
    { name: 'Prospectos', count: analytics.prospects, color: '#f59e0b' },
    { name: 'Leads', count: analytics.leads, color: '#3b82f6' },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Banner Callout */}
      <div className="relative rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-slate-900 p-6 md:p-8 overflow-hidden shadow-xl text-white">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white border border-white/20 text-xs font-bold">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Inteligência de Mercado B2B & CNPJ Engine</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Painel de Performance & Qualificação CNPJ
            </h1>
            <p className="text-sm text-indigo-100 leading-relaxed">
              Monitore métricas de conversão de leads, forecast de vendas e execute qualificação automática integrada ao banco PostgreSQL.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              onClick={() => onNavigateToTab('prospects')}
              variant="outline" 
              className="border-white/30 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
            >
              Ver Todos Prospectos ({prospects.length})
            </Button>
            <Button 
              onClick={onOpenCreateModal}
              className="bg-white text-indigo-700 hover:bg-slate-100 font-bold gap-2 text-xs shadow-lg"
            >
              <Plus className="h-4 w-4" />
              Novo Prospecto
            </Button>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Total Prospects */}
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
                Total de Prospectos
              </span>
              <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
                <Building2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-foreground">
                {analytics.total_prospects}
              </span>
              <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:bg-emerald-500/10 text-[11px]">
                <ArrowUpRight className="h-3 w-3 mr-0.5" /> +14.2%
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-muted-foreground mt-2">
              Empresas cadastradas no banco
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Qualified Leads */}
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
                Leads Qualificados
              </span>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
                {analytics.qualified}
              </span>
              <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:bg-emerald-500/10 text-[11px]">
                Prontos para Venda
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-muted-foreground mt-2">
              Superaram os critérios de score
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Qualification Rate */}
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
                Taxa de Qualificação
              </span>
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-foreground">
                {Math.round(analytics.qualification_rate * 100)}%
              </span>
              <span className="text-xs text-amber-700 dark:text-amber-400 font-bold">
                Meta: 75%
              </span>
            </div>
            {/* Mini Progress Bar */}
            <div className="w-full bg-slate-100 dark:bg-secondary h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${analytics.qualification_rate * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Forecast Revenue */}
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
                Forecast Este Mês
              </span>
              <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 border border-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20">
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-foreground">
                {formatCurrency(forecast.this_month)}
              </span>
              <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-500/30 dark:text-purple-400 dark:bg-purple-500/10 text-[11px]">
                Q3 Forecast
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-muted-foreground mt-2">
              Projeção Q3: {formatCurrency(forecast.q3_projection)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Area Chart - Revenue Projections */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100 dark:border-border/60">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-foreground">Projeção de Receita & Conversão</CardTitle>
              <CardDescription className="text-slate-500 dark:text-muted-foreground">Evolução mensal de faturamento e entrada de leads qualificados</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700 bg-indigo-50 dark:border-indigo-500/30 dark:text-indigo-400 dark:bg-indigo-500/10 font-bold">
              6 Meses
            </Badge>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockRevenueChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(val) => `R$${val/1000}k`} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      color: '#0f172a',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      fontSize: '12px'
                    }}
                    formatter={(value: any) => [formatCurrency(Number(value)), 'Receita']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#4f46e5" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Quick CNPJ Qualification Engine Widget */}
        <Card className="glass-card flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-border/60">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base font-bold text-slate-900 dark:text-foreground">Qualificador Express AI</CardTitle>
                <CardDescription className="text-slate-500 dark:text-muted-foreground">Qualifique qualquer empresa em tempo real</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <form onSubmit={handleQuickQualify} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-muted-foreground">
                  Razão Social ou Nome Fantasia
                </label>
                <Input
                  placeholder="Ex: Mercado Livre Brasil LTDA"
                  value={quickQualifyName}
                  onChange={(e) => setQuickQualifyName(e.target.value)}
                  className="bg-slate-50 dark:bg-secondary/40 text-xs border-slate-200 dark:border-border"
                />
              </div>
              <Button 
                type="submit" 
                disabled={isQualifying || !quickQualifyName.trim()}
                className="w-full h-9 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20"
              >
                {isQualifying ? (
                  <>Analisando Dados CNPJ...</>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Executar Análise AI
                  </>
                )}
              </Button>
            </form>

            {/* Quick Result Output */}
            {quickResult && (
              <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 space-y-2 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 uppercase">Score Oportunidade</span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{quickResult.score}/100</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-muted-foreground font-semibold">Classificação:</span>
                  <Badge variant={quickResult.level === 'qualified' ? 'qualified' : 'prospect'}>
                    {quickResult.level.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-muted-foreground font-semibold">Grau de Confiança:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-200">{(Number(quickResult.confidence) * 100).toFixed(0)}%</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Prospects Table & Pipeline Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* High-Value Prospects Table */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-border/60">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-foreground">Principais Prospectos no Banco</CardTitle>
              <CardDescription className="text-slate-500 dark:text-muted-foreground">Registros persistidos e sincronizados com PostgreSQL</CardDescription>
            </div>
            <Button 
              onClick={() => onNavigateToTab('prospects')}
              variant="ghost" 
              size="sm" 
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-bold gap-1"
            >
              Ver Todos <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-secondary/40 text-slate-500 dark:text-muted-foreground uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-border/80">
                  <tr>
                    <th className="px-6 py-3.5">Empresa</th>
                    <th className="px-6 py-3.5">CNPJ</th>
                    <th className="px-6 py-3.5">Setor</th>
                    <th className="px-6 py-3.5">Score</th>
                    <th className="px-6 py-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-border/60">
                  {prospects.slice(0, 5).map((p) => (
                    <tr 
                      key={p.id} 
                      onClick={() => onSelectProspect(p)}
                      className="hover:bg-slate-50 dark:hover:bg-secondary/30 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-3.5 font-bold text-slate-900 dark:text-foreground">
                        {p.companyName}
                      </td>
                      <td className="px-6 py-3.5 font-mono text-slate-500 dark:text-muted-foreground">
                        {formatCNPJ(p.cnpj)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-600 dark:text-foreground/90">
                        {p.industry || 'Tecnologia'}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="font-extrabold text-indigo-600 dark:text-indigo-400">
                          {p.opportunityScore}/100
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge variant={p.status === 'qualified' ? 'qualified' : p.status === 'prospect' ? 'prospect' : 'lead'}>
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pipeline Distribution Bar Chart */}
        <Card className="glass-card">
          <CardHeader className="border-b border-slate-100 dark:border-border/60">
            <CardTitle className="text-base font-bold text-slate-900 dark:text-foreground">Distribuição do Funil</CardTitle>
            <CardDescription className="text-slate-500 dark:text-muted-foreground">Quantidade de prospectos por estágio</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBreakdownData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" stroke="#64748b" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      color: '#0f172a',
                      fontSize: '12px'
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {statusBreakdownData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
