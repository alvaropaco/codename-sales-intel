import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Factory,
  Flag,
  Landmark,
  MailCheck,
  MoreHorizontal,
  PhoneCall,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Prospect, PipelineAnalytics, ForecastAnalytics, QualificationResult } from '@/types';
import { cn, formatCNPJ, formatCurrency } from '@/lib/utils';
import { qualifyCompany } from '@/services/api';

interface ExecutiveDashboardViewProps {
  prospects: Prospect[];
  analytics: PipelineAnalytics;
  forecast: ForecastAnalytics;
  onSelectProspect: (prospect: Prospect) => void;
  onNavigateToTab: (tab: any) => void;
}

const statusConfig = {
  qualified: { label: 'Pronto para contato', color: '#10b981', badge: 'qualified' as const, weight: 0.72 },
  prospect: { label: 'Lead', color: '#6366f1', badge: 'prospect' as const, weight: 0.38 },
  lead: { label: 'Nova oportunidade', color: '#3b82f6', badge: 'lead' as const, weight: 0.18 },
  contacted: { label: 'Contato iniciado', color: '#f59e0b', badge: 'prospect' as const, weight: 0.48 },
  proposal: { label: 'Proposta enviada', color: '#8b5cf6', badge: 'closed' as const, weight: 0.82 },
  closed: { label: 'Cliente ganho', color: '#14b8a6', badge: 'closed' as const, weight: 1 },
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const safeNumber = (value?: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 transition-all duration-700"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  trend: string;
  icon: React.ElementType;
  tone: 'indigo' | 'emerald' | 'sky' | 'amber';
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
    sky: 'bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',
    amber: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  };

  return (
    <Card className="group overflow-hidden border-slate-200/80 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-xl dark:border-white/10 dark:bg-slate-950/70">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{title}</p>
            <div className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{value}</div>
          </div>
          <div className={cn('rounded-2xl border p-2.5 shadow-sm', tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{subtitle}</p>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
            <ArrowUpRight className="mr-1 h-3 w-3" />
            {trend}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export const ExecutiveDashboardView: React.FC<ExecutiveDashboardViewProps> = ({
  prospects,
  analytics,
  forecast,
  onSelectProspect,
  onNavigateToTab,
}) => {
  const [quickQualifyName, setQuickQualifyName] = useState('');
  const [quickResult, setQuickResult] = useState<QualificationResult | null>(null);
  const [isQualifying, setIsQualifying] = useState(false);

  const derived = useMemo(() => {
    const forecastPool = safeNumber(forecast.q3_projection) || safeNumber(forecast.next_month) || safeNumber(forecast.this_month);
    const scoreWeight = prospects.reduce((sum, p) => sum + Math.max(1, safeNumber(p.opportunityScore)), 0) || 1;
    const dealValueById = prospects.reduce<Record<string, number>>((acc, p) => {
      const explicitRevenue = safeNumber(p.revenueEstimate);
      acc[p.id] = explicitRevenue > 0
        ? explicitRevenue
        : forecastPool * (Math.max(1, safeNumber(p.opportunityScore)) / scoreWeight);
      return acc;
    }, {});

    const totalRevenue = prospects.reduce((sum, p) => sum + (dealValueById[p.id] || 0), 0);
    const avgTicket = prospects.length ? totalRevenue / prospects.length : 0;
    const weightedPipeline = prospects.reduce((sum, p) => {
      const config = statusConfig[p.status as keyof typeof statusConfig] || statusConfig.prospect;
      return sum + (dealValueById[p.id] || 0) * config.weight;
    }, 0);

    const industries = prospects.reduce<Record<string, { count: number; revenue: number }>>((acc, p) => {
      const key = p.industry || 'Não classificado';
      acc[key] = acc[key] || { count: 0, revenue: 0 };
      acc[key].count += 1;
      acc[key].revenue += dealValueById[p.id] || 0;
      return acc;
    }, {});

    const industryChart = Object.entries(industries)
      .map(([name, value]) => ({ name, count: value.count, revenue: value.revenue }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const pipeline = Object.entries(statusConfig).map(([status, config]) => {
      const rows = prospects.filter((p) => p.status === status);
      const revenue = rows.reduce((sum, p) => sum + (dealValueById[p.id] || 0), 0);
      return {
        status,
        label: config.label,
        count: rows.length,
        revenue,
        color: config.color,
        pct: prospects.length ? Math.round((rows.length / prospects.length) * 100) : 0,
      };
    }).filter((stage) => stage.count > 0 || ['qualified', 'prospect', 'lead'].includes(stage.status));

    const qRate = Math.round((analytics.qualification_rate || 0) * 100);
    const targetProgress = Math.min(100, Math.round((analytics.qualified / Math.max(analytics.total_prospects || 1, 1)) * 100));
    const highIntent = prospects.filter((p) => safeNumber(p.opportunityScore) >= 75).length;

    const revenueChart = [
      { month: 'Hoje', revenue: totalRevenue, deals: prospects.length },
      { month: 'Mês atual', revenue: forecast.this_month, deals: Math.max(analytics.qualified, 1) },
      { month: 'Próx. mês', revenue: forecast.next_month, deals: Math.max(analytics.qualified + analytics.prospects, 1) },
      { month: 'Q3', revenue: forecast.q3_projection, deals: Math.max(prospects.length + analytics.leads, 1) },
    ];

    const priorityTasks = prospects
      .slice()
      .sort((a, b) => safeNumber(b.opportunityScore) - safeNumber(a.opportunityScore))
      .slice(0, 3)
      .map((p, index) => ({
        title: index === 0 ? `Retomar conversa com ${p.companyName}` : index === 1 ? `Preparar proposta para ${p.companyName}` : `Confirmar informações de ${p.companyName}`,
        subtitle: `${p.industry || 'Lead'} · Potencial ${p.opportunityScore}/100`,
        priority: index === 0 ? 'Alta' : index === 1 ? 'Média' : 'Baixa',
        due: index === 0 ? 'Hoje' : index === 1 ? 'Amanhã' : 'Esta semana',
        prospect: p,
      }));

    return { totalRevenue, avgTicket, weightedPipeline, industryChart, pipeline, qRate, targetProgress, highIntent, revenueChart, priorityTasks, dealValueById };
  }, [prospects, analytics, forecast]);

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

  const topProspects = prospects
    .slice()
    .sort((a, b) => safeNumber(b.opportunityScore) - safeNumber(a.opportunityScore))
    .slice(0, 5);

  return (
    <div className="space-y-6 animate-fadeIn">
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.16),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.12),transparent_32%)]" />
          <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300" variant="outline">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Inteligência comercial
                </Badge>
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300" variant="outline">
                  Dados atualizados
                </Badge>
              </div>
              <div>
                <h1 className="max-w-4xl text-3xl font-black tracking-tight text-slate-950 dark:text-white md:text-5xl">
                  Descubra leads com potencial de compra e priorize as melhores oportunidades.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Acompanhe sinais comerciais, potencial de receita e próximos passos para transformar leads em oportunidades de venda.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => onNavigateToTab('prospects')} className="h-11 gap-2 rounded-xl bg-slate-950 px-5 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
                  <Plus className="h-4 w-4" /> Descobrir leads
                </Button>
                <Button onClick={() => onNavigateToTab('prospects')} variant="outline" className="h-11 gap-2 rounded-xl border-slate-200 bg-white/70 px-5 dark:border-white/10 dark:bg-white/5">
                  Ver leads sugeridos <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="min-w-[280px] rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Meta comercial</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{derived.targetProgress}% completo</p>
                </div>
                <Target className="h-10 w-10 text-indigo-500" />
              </div>
              <ProgressBar value={derived.targetProgress} className="mt-4" />
              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {analytics.qualified} de {analytics.total_prospects || prospects.length} leads já estão qualificados para avanço comercial.
              </p>
            </div>
          </div>
        </div>

        <Card className="border-slate-200 bg-slate-950 text-white shadow-xl dark:border-white/10">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Pipeline ponderado</p>
                <p className="mt-3 text-3xl font-black">{formatCurrency(derived.weightedPipeline)}</p>
              </div>
              <CircleDollarSign className="h-11 w-11 text-emerald-300" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[11px] text-slate-400">Ticket médio</p>
                <p className="mt-1 text-sm font-bold">{formatCurrency(derived.avgTicket)}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[11px] text-slate-400">Alta intenção</p>
                <p className="mt-1 text-sm font-bold">{derived.highIntent} contas</p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-400/15 p-2 text-emerald-300">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-bold">Projeção do trimestre</p>
                  <p className="text-[11px] text-slate-400">Estimativa de receita potencial</p>
                </div>
              </div>
              <p className="text-sm font-black">{formatCurrency(forecast.q3_projection)}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {prospects.length === 0 && (
        <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-sky-50/60 to-emerald-50/60 p-5 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:via-sky-500/5 dark:to-emerald-500/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-white p-2.5 text-indigo-600 shadow-sm dark:bg-white/10 dark:text-indigo-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black text-slate-950 dark:text-white">Nenhum lead gerado ainda</p>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 dark:text-slate-300">
                  A Inteligência Comercial gera os leads a partir da <strong>descoberta</strong> de empresas reais
                  (segmentos/CNAEs e localizações do onboarding). Vá em <strong>Descobrir leads</strong>, revise
                  os critérios do seu perfil e adicione as empresas que tiverem potencial de compra — elas
                  aparecerão aqui no dashboard.
                </p>
              </div>
            </div>
            <Button onClick={() => onNavigateToTab('prospects')} className="h-10 shrink-0 gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> Descobrir e gerar leads
            </Button>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Leads alvo" value={analytics.total_prospects || prospects.length} subtitle="Leads sugeridos" trend="Atual" icon={Building2} tone="indigo" />
        <MetricCard title="Oportunidades qualificadas" value={analytics.qualified} subtitle="Prontas para venda" trend={`${derived.qRate}%`} icon={Trophy} tone="emerald" />
        <MetricCard title="Receita potencial" value={formatCurrency(derived.totalRevenue)} subtitle="Soma das oportunidades" trend="Previsto" icon={Landmark} tone="sky" />
        <MetricCard title="Em prospecção" value={analytics.prospects + analytics.leads} subtitle="Aguardando maturação" trend="Ativo" icon={Users} tone="amber" />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 dark:border-white/10">
            <div>
              <CardTitle className="text-base font-black">Previsão de receita</CardTitle>
              <CardDescription>Potencial da carteira atual e projeções para os próximos períodos.</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Download className="h-3.5 w-3.5" /> Baixar
            </Button>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={derived.revenueChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="enterpriseRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${Number(val) / 1000}k`} />
                  <Tooltip
                    contentStyle={{ borderRadius: 14, borderColor: '#e2e8f0', boxShadow: '0 20px 45px rgba(15,23,42,0.12)', fontSize: 12 }}
                    formatter={(value: any) => [formatCurrency(Number(value)), 'Receita']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={3} fill="url(#enterpriseRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="border-b border-slate-100 dark:border-white/10">
            <CardTitle className="text-base font-black">Oportunidades por segmento</CardTitle>
            <CardDescription>Onde há mais leads com aderência ao seu perfil comercial.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <div className="h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={derived.industryChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} interval={0} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 14, borderColor: '#e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#4f46e5" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-3">
              {derived.industryChart.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      {index === 0 ? <Factory className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-950 dark:text-white">{item.name}</p>
                      <p className="text-[11px] text-slate-500">{formatCurrency(item.revenue)}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-white dark:bg-white/5">{item.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-white/10">
            <div>
              <CardTitle className="text-base font-black">Próximas ações</CardTitle>
              <CardDescription>Recomendações priorizadas por potencial e valor comercial.</CardDescription>
            </div>
            <Button onClick={() => onNavigateToTab('workflows')} size="sm" variant="outline" className="gap-2 text-xs">
              <Plus className="h-3.5 w-3.5" /> Nova ação
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {derived.priorityTasks.map((task) => (
              <button
                key={task.title}
                onClick={() => onSelectProspect(task.prospect)}
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50/50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-indigo-500/10"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <div className="mt-0.5 rounded-xl bg-white p-2 text-indigo-600 shadow-sm dark:bg-white/10 dark:text-indigo-300">
                      {task.priority === 'Alta' ? <Flag className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-950 dark:text-white">{task.title}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{task.subtitle}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={task.priority === 'Alta' ? 'destructive' : 'outline'} className="text-[10px]">{task.priority}</Badge>
                    <p className="mt-2 text-[11px] font-medium text-slate-500">{task.due}</p>
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-white/10">
            <div>
              <CardTitle className="text-base font-black">Pipeline de vendas</CardTitle>
              <CardDescription>Oportunidades atuais por estágio do funil comercial.</CardDescription>
            </div>
            <Button onClick={() => onNavigateToTab('pipeline')} variant="ghost" size="sm" className="gap-1 text-xs text-indigo-600 dark:text-indigo-300">
              Pipeline <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {derived.pipeline.map((stage) => (
              <div key={stage.status} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{stage.label}</span>
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {stage.count} oportunidades · {formatCurrency(stage.revenue)}
                  </span>
                </div>
                <ProgressBar value={stage.pct} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Card className="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-white/10">
            <div>
              <CardTitle className="text-base font-black">Leads prioritários</CardTitle>
              <CardDescription>Contas com maior potencial para abordagem comercial.</CardDescription>
            </div>
            <Button onClick={() => onNavigateToTab('prospects')} variant="outline" size="sm" className="text-xs">Ver todos</Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:bg-white/[0.03]">
                  <tr>
                    <th className="px-6 py-3.5 font-black">Lead</th>
                    <th className="px-6 py-3.5 font-black">Momento</th>
                    <th className="px-6 py-3.5 font-black">ID do lead</th>
                    <th className="px-6 py-3.5 font-black">Valor</th>
                    <th className="px-6 py-3.5 font-black">Potencial</th>
                    <th className="px-6 py-3.5 text-right font-black">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                  {topProspects.map((p) => {
                    const config = statusConfig[p.status as keyof typeof statusConfig] || statusConfig.prospect;
                    return (
                      <tr key={p.id} className="transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-xs font-black text-white shadow-sm">
                              {getInitials(p.companyName)}
                            </div>
                            <div>
                              <p className="font-bold text-slate-950 dark:text-white">{p.companyName}</p>
                              <p className="text-[11px] text-slate-500">{p.industry || 'Não classificado'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4"><Badge variant={config.badge}>{config.label}</Badge></td>
                        <td className="px-6 py-4 font-mono font-medium text-slate-500">{formatCNPJ(p.cnpj)}</td>
                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">{formatCurrency(derived.dealValueById[p.id] || safeNumber(p.revenueEstimate))}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-indigo-600 dark:text-indigo-300">{p.opportunityScore}</span>
                            <div className="w-16"><ProgressBar value={p.opportunityScore} className="h-1.5" /></div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button onClick={() => onSelectProspect(p)} variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardHeader className="border-b border-slate-100 dark:border-white/10">
            <CardTitle className="flex items-center gap-2 text-base font-black"><Zap className="h-4 w-4 text-indigo-500" /> Análise rápida de potencial</CardTitle>
            <CardDescription>Informe um lead e veja se ele combina com seu perfil comercial.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <form onSubmit={handleQuickQualify} className="space-y-3">
              <Input
                placeholder="Ex: lead do segmento escolhido"
                value={quickQualifyName}
                onChange={(e) => setQuickQualifyName(e.target.value)}
                className="h-11 rounded-xl bg-slate-50 text-xs dark:bg-white/[0.04]"
              />
              <Button type="submit" disabled={isQualifying || !quickQualifyName.trim()} className="h-11 w-full gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700">
                <Sparkles className="h-4 w-4" /> {isQualifying ? 'Analisando...' : 'Analisar potencial'}
              </Button>
            </form>
            {quickResult ? (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700 dark:text-indigo-300">Resultado</p>
                  <Badge variant={quickResult.level === 'qualified' ? 'qualified' : quickResult.level === 'prospect' ? 'prospect' : 'lead'}>{quickResult.level}</Badge>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] text-slate-500">Potencial da oportunidade</p>
                    <p className="text-3xl font-black text-slate-950 dark:text-white">{quickResult.score}/100</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Confiança</p>
                    <p className="text-lg font-black text-emerald-600">{Math.round(Number(quickResult.confidence) * 100)}%</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-8 w-8 text-emerald-500" />
                  <div>
                    <p className="text-sm font-bold text-slate-950 dark:text-white">Pronto para análise</p>
                    <p className="text-xs text-slate-500">Informe um lead para receber uma recomendação comercial.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
