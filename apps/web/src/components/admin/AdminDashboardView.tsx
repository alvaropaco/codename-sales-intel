import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Building2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  CreditCard,
  Target,
  LogOut,
  ArrowLeft,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  adminUsers,
  adminOrgs,
  adminSetOrgPlan,
  adminSummary,
  adminLogout,
  type AdminUserRow,
  type AdminOrgRow,
  type AdminSummary,
} from '@/services/admin';

type Tab = 'users' | 'orgs';

interface AdminDashboardViewProps {
  username: string;
  onLogout: () => void;
}

const badge = (plan: string) =>
  plan === 'premium'
    ? 'inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-300'
    : 'inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-bold text-slate-300';

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ username, onLogout }) => {
  const [tab, setTab] = useState<Tab>('orgs');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AdminSummary | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [orgs, setOrgs] = useState<AdminOrgRow[]>([]);
  const [orgsTotal, setOrgsTotal] = useState(0);

  const [q, setQ] = useState('');
  const [planFilter, setPlanFilter] = useState<'' | 'trial' | 'premium'>('');
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, u, o] = await Promise.all([
        adminSummary(),
        adminUsers(q),
        adminOrgs(q, planFilter),
      ]);
      setSummary(sum);
      setUsers(u.data);
      setUsersTotal(u.meta.total);
      setOrgs(o.data);
      setOrgsTotal(o.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, [q, planFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => reload(), 250);
    return () => window.clearTimeout(t);
  }, [reload, tab]);

  const handleTogglePlan = async (org: AdminOrgRow) => {
    const target: 'trial' | 'premium' = org.plan === 'premium' ? 'trial' : 'premium';
    const label = target === 'premium' ? 'premium' : 'trial';
    if (
      !window.confirm(
        `Mudar o plano de "${org.name}" para ${label.toUpperCase()}?`
      )
    ) {
      return;
    }
    setBusyOrg(org.id);
    setError(null);
    try {
      await adminSetOrgPlan(org.id, target);
      showToast(`Plano de "${org.name}" alterado para ${label.toUpperCase()}.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar plano.');
    } finally {
      setBusyOrg(null);
    }
  };

  const kpiCards = summary
    ? [
        { icon: Users, label: 'Usuários', value: summary.users, color: 'text-indigo-300 bg-indigo-500/15' },
        { icon: Building2, label: 'Contas', value: summary.orgs, color: 'text-sky-300 bg-sky-500/15' },
        { icon: Sparkles, label: 'Premium', value: summary.premiums, color: 'text-emerald-300 bg-emerald-500/15' },
        { icon: CreditCard, label: 'Trial', value: summary.trials, color: 'text-amber-300 bg-amber-500/15' },
        { icon: Target, label: 'Leads', value: summary.prospects, color: 'text-fuchsia-300 bg-fuchsia-500/15' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-900/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Painel Admin</h1>
              <p className="text-xs text-slate-400">B2Base · administração do sistema</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 sm:inline">
              {username}
            </span>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </a>
            <button
              onClick={async () => {
                await adminLogout();
                onLogout();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" /> Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {toast && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> {toast}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
            {error}
          </div>
        )}

        {/* KPIs */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpiCards.map((k) => (
            <div key={k.label} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${k.color}`}>
                <k.icon className="h-5 w-5" />
              </div>
              <div className="text-2xl font-black">{k.value}</div>
              <div className="text-xs font-semibold text-slate-400">{k.label}</div>
            </div>
          ))}
        </section>

        {/* Tabs + search */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-xl border border-white/10 bg-slate-900/60 p-1">
            {(
              [
                { id: 'orgs', label: 'Contas', icon: Building2 },
                { id: 'users', label: 'Usuários', icon: Users },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
                  tab === t.id ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
                <span className="rounded-full bg-black/10 px-1.5 text-xs">
                  {t.id === 'orgs' ? orgsTotal : usersTotal}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-col gap-2 sm:max-w-md sm:flex-row sm:items-center">
            {tab === 'orgs' && (
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value as '' | 'trial' | 'premium')}
                className="h-10 rounded-xl border border-white/10 bg-slate-900 px-3 text-sm font-semibold text-slate-300 outline-none focus:border-indigo-400/60"
              >
                <option value="">Todos os planos</option>
                <option value="trial">Só Trial</option>
                <option value="premium">Só Premium</option>
              </select>
            )}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === 'orgs' ? 'Buscar por nome ou CNPJ…' : 'Buscar por e-mail ou nome…'}
                className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/60 pl-9 pr-8 text-sm font-medium text-white placeholder:text-slate-500 outline-none focus:border-indigo-400/60"
              />
            </div>
            <button
              onClick={reload}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 text-sm font-bold text-slate-300 transition hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm font-semibold text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : tab === 'orgs' ? (
          <div className="space-y-3">
            {orgs.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-10 text-center text-sm text-slate-400">
                Nenhuma conta encontrada.
              </div>
            )}
            {orgs.map((org) => (
              <div
                key={org.id}
                className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 transition hover:border-white/20"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-black">{org.name}</span>
                      <span className={badge(org.plan)}>
                        {org.plan === 'premium' ? <Sparkles className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
                        {org.plan === 'premium' ? 'Premium' : 'Trial'}
                      </span>
                      {org.stripeSubscriptionId && (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-300">
                          Stripe: {org.stripePlanStatus || 'assinatura'}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                      <span>CNPJ: {org.cnpj || '—'}</span>
                      <span>{org._count.users} usuário(s)</span>
                      <span>{org._count.prospects} lead(s)</span>
                      <span>Criado: {new Date(org.createdAt).toLocaleDateString('pt-BR')}</span>
                    </div>
                    {org.users.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {org.users.map((u) => (
                          <span
                            key={u.id}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            {u.name || u.email}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {org.plan === 'premium' ? (
                      <button
                        onClick={() => handleTogglePlan(org)}
                        disabled={busyOrg === org.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-60"
                      >
                        {busyOrg === org.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                        Rebaixar p/ Trial
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTogglePlan(org)}
                        disabled={busyOrg === org.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        {busyOrg === org.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Tornar Premium
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-bold">Usuário</th>
                  <th className="px-4 py-3 font-bold">E-mail</th>
                  <th className="hidden px-4 py-3 font-bold sm:table-cell">Conta</th>
                  <th className="px-4 py-3 font-bold">Plano</th>
                  <th className="hidden px-4 py-3 font-bold md:table-cell">Criado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-bold text-white">{u.name || '—'}</div>
                      <div className="text-xs text-slate-400">role: {u.role}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{u.email}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <div className="font-semibold text-slate-200">{u.organization?.name || '—'}</div>
                      <div className="text-xs text-slate-400">{u.organization?.cnpj || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={badge(u.organization?.plan || 'trial')}>
                        {(u.organization?.plan || 'trial').toUpperCase()}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 md:table-cell">
                      {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};
