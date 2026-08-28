import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Download,
  Mail,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LockedText } from '@/components/ui/locked-text';
import { EnrichedCnpjContact } from '@/types';
import { extractCnpjContacts, fetchEnrichedCnpjContacts } from '@/services/api';
import { cn, formatCNPJ, whatsappLink } from '@/lib/utils';
import { usePlan } from '@/hooks/usePlan';

const statusVariant: Record<string, 'qualified' | 'prospect' | 'lead' | 'destructive' | 'outline'> = {
  enriched: 'qualified',
  pending: 'prospect',
  unavailable: 'lead',
  error: 'destructive',
};

const contactStatusLabel: Record<string, string> = {
  enriched: 'Informações completas',
  pending: 'Aguardando atualização',
  unavailable: 'Sem contato disponível',
  error: 'Revisar manualmente',
};

export const CnpjEnrichmentView: React.FC = () => {
  const [contacts, setContacts] = useState<EnrichedCnpjContact[]>([]);
  // Empty defaults mean "all leads" — the backend only applies the enrichedAt
  // range when these are explicitly set. Previously they defaulted to the last
  // 30 days, which silently excluded every lead that had never been enriched
  // (enrichedAt = null) or was enriched outside that window, leaving the
  // "Inteligência comercial" view empty despite the dashboard being populated.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { canExport } = usePlan();

  const loadContacts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchEnrichedCnpjContacts({ from, to, status });
      setContacts(data);
    } catch (err: any) {
      setError(err.message || 'Não foi possível carregar as informações comerciais');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExtract = async () => {
    setIsExtracting(true);
    setError(null);
    try {
      await extractCnpjContacts({ from, to, refresh: true, limit: 25 });
      await loadContacts();
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar as informações de contato');
    } finally {
      setIsExtracting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter((item) =>
      item.companyName.toLowerCase().includes(q) ||
      item.cnpj.includes(q) ||
      (item.email || '').toLowerCase().includes(q) ||
      item.partners.some((partner) => (partner.name || '').toLowerCase().includes(q))
    );
  }, [contacts, search]);

  const totalPartners = filtered.reduce((sum, item) => sum + item.partners.length, 0);
  const totalEmails = filtered.filter((item) => item.email).length;
  const totalPhones = filtered.reduce((sum, item) => sum + item.phones.length, 0);

  const handleExport = () => {
    if (!canExport) {
      window.location.href = '/settings?plan=upgrade';
      return;
    }
    const rows = filtered.map((item) => ({
      cnpj: item.cnpj,
      companyName: item.companyName,
      email: item.email || '',
      phones: item.phones.join(' | '),
      partners: item.partners.map((p) => `${p.name || 'N/A'} (${p.qualification || 'N/A'})`).join(' | '),
      enrichmentStatus: item.enrichmentStatus,
      enrichedAt: item.enrichedAt || '',
    }));
    const csv = [
      ['Identificação', 'Lead', 'Email', 'Telefones', 'Sócios', 'Momento', 'Atualizado em'].join(','),
      ...rows.map((row) => [
        row.cnpj,
        `"${row.companyName}"`,
        row.email,
        `"${row.phones}"`,
        `"${row.partners}"`,
        row.enrichmentStatus,
        row.enrichedAt,
      ].join(',')),
    ].join('\n');
    const link = document.createElement('a');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    link.download = `b2base_inteligencia_comercial_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Inteligência comercial
            </Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white md:text-4xl">
              Informações do lead para vender melhor.
            </h1>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Veja contatos, sócios, sinais comerciais e dados úteis para decidir quem abordar primeiro e como iniciar a conversa.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleExtract} disabled={isExtracting} className="h-11 gap-2 rounded-xl bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950">
              <RefreshCw className={cn('h-4 w-4', isExtracting && 'animate-spin')} />
              {isExtracting ? 'Atualizando...' : 'Atualizar informações'}
            </Button>
            <Button onClick={handleExport} variant="outline" className="h-11 gap-2 rounded-xl" disabled={!filtered.length}>
              {canExport ? (
                <><Download className="h-4 w-4" /> Baixar lista</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Exportar (Premium)</>
              )}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric title="Leads analisados" value={filtered.length} icon={ShieldCheck} tone="indigo" />
        <Metric title="Decisores mapeados" value={totalPartners} icon={UsersRound} tone="emerald" />
        <Metric title="Emails encontrados" value={totalEmails} icon={Mail} tone="sky" />
        <Metric title="Telefones encontrados" value={totalPhones} icon={Phone} tone="amber" />
      </section>

      <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_160px_170px_auto_auto] lg:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por lead, contato, email ou decisor..." className="h-10 rounded-xl pl-9 text-xs" />
            </div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl text-xs" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl text-xs" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
              <option value="all">Todos os momentos</option>
              <option value="enriched">Informações completas</option>
              <option value="pending">Aguardando atualização</option>
              <option value="unavailable">Sem contato disponível</option>
              <option value="error">Revisar manualmente</option>
            </select>
            <Button onClick={loadContacts} variant="outline" className="h-10 gap-2 rounded-xl text-xs" disabled={isLoading}>
              <CalendarDays className="h-4 w-4" /> Filtrar
            </Button>
            <Badge variant="outline" className="justify-center rounded-xl px-3 py-2 text-xs">{from || to ? `${from || '…'} → ${to || '…'}` : 'Todos os leads'}</Badge>
          </div>
          {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</p>}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader className="border-b border-slate-100 dark:border-white/10">
          <CardTitle className="text-base font-black">Informações para contato</CardTitle>
          <CardDescription>Dados comerciais prontos para priorizar abordagens e transformar leads em oportunidades.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:bg-white/[0.03]">
                <tr>
                  <th className="px-6 py-3.5 font-black">Lead</th>
                  <th className="px-6 py-3.5 font-black">Email</th>
                  <th className="px-6 py-3.5 font-black">Telefones</th>
                  <th className="px-6 py-3.5 font-black">Sócios</th>
                  <th className="px-6 py-3.5 font-black">Momento</th>
                  <th className="px-6 py-3.5 font-black">Atualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">Carregando informações comerciais...</td></tr>
                ) : filtered.length ? filtered.map((item) => (
                  <tr key={item.id} className="align-top transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-950 dark:text-white">{item.companyName}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">{formatCNPJ(item.cnpj)}</p>
                      {item.tradeName && <p className="mt-1 text-[11px] text-slate-500">Fantasia: {item.tradeName}</p>}
                    </td>
                    <td className="px-6 py-4">
                      {item.email ? (
                        item.dataRestricted ? (
                          <LockedText className="font-semibold text-slate-800 dark:text-slate-200">{item.email}</LockedText>
                        ) : (
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{item.email}</span>
                        )
                      ) : (
                        <span className="text-slate-400">Não disponível</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {item.phones.length ? item.phones.map((phone) => {
                        const wa = item.dataRestricted ? null : whatsappLink(phone);
                        return wa ? (
                          <a
                            key={phone}
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Conversar no WhatsApp: ${phone}`}
                            className="mb-1 mr-1 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-indigo-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-indigo-300 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                          >
                            <Phone className="h-3 w-3" />{phone}
                          </a>
                        ) : item.dataRestricted ? (
                          <LockedText key={phone} className="mb-1 mr-1 inline-flex">{phone}</LockedText>
                        ) : (
                          <Badge key={phone} variant="outline" className="mb-1 mr-1">{phone}</Badge>
                        );
                      }) : <span className="text-slate-400">Não disponível</span>}
                    </td>
                    <td className="px-6 py-4 min-w-[260px]">
                      {item.partners.length ? item.partners.slice(0, 3).map((partner, index) => (
                        <div key={`${partner.name}-${index}`} className="mb-2 flex items-start gap-2">
                          <UserRound className="mt-0.5 h-3.5 w-3.5 text-indigo-500" />
                          <div>
                            {item.dataRestricted ? (
                              <LockedText className="font-bold text-slate-800 dark:text-slate-200">
                                {partner.name || 'Sócio não informado'}
                              </LockedText>
                            ) : (
                              <p className="font-bold text-slate-800 dark:text-slate-200">{partner.name || 'Sócio não informado'}</p>
                            )}
                            <p className="text-[11px] text-slate-500">{partner.qualification || 'Qualificação não informada'}</p>
                          </div>
                        </div>
                      )) : <span className="text-slate-400">Não disponível</span>}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={statusVariant[item.enrichmentStatus] || 'outline'}>{contactStatusLabel[item.enrichmentStatus] || 'Em análise'}</Badge>
                      {item.enrichmentError && <p className="mt-2 max-w-[220px] text-[11px] text-red-500">{item.enrichmentError}</p>}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {item.enrichedAt ? new Date(item.enrichedAt).toLocaleString('pt-BR') : 'Pendente'}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">Nenhuma informação comercial encontrada para o filtro atual.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

function Metric({ title, value, icon: Icon, tone }: { title: string; value: number; icon: React.ElementType; tone: 'indigo' | 'emerald' | 'sky' | 'amber' }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{value}</p>
        </div>
        <div className={cn('rounded-2xl p-3', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
