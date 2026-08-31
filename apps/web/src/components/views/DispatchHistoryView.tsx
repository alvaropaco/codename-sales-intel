import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  History,
  RefreshCw,
  Mail,
  MessageCircle,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DispatchHistoryItem, DispatchHistoryResult } from '@/types';
import { fetchDispatchHistory, DispatchHistoryFilters } from '@/services/api';

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
};

const ORIGIN_META: Record<string, { label: string; title: string }> = {
  auto: { label: 'Auto', title: 'Disparado automaticamente pós-enriquecimento' },
  manual: { label: 'Manual', title: 'Disparado manualmente em uma campanha' },
  conversation: { label: 'Conversa', title: 'Enviado manualmente numa conversa 1:1' },
};

const STATUS_LABEL: Record<string, string> = {
  // email
  GENERATING: 'Gerando',
  SCHEDULED: 'Agendado',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  BOUNCED: 'Bounce',
  // whatsapp
  PENDING: 'Pendente',
  DELIVERED: 'Entregue',
  READ: 'Lida',
};

const BUCKET_META: Record<string, { label: string; variant: 'qualified' | 'prospect' | 'destructive'; icon: React.ReactNode }> = {
  sent: { label: 'Enviado', variant: 'qualified', icon: <CheckCircle2 className="h-3 w-3" /> },
  pending: { label: 'Pendente', variant: 'prospect', icon: <Clock className="h-3 w-3" /> },
  failed: { label: 'Falha', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
};

const formatWhen = (iso: string | null): string => {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PAGE_SIZE = 50;

export const DispatchHistoryView: React.FC = () => {
  const [data, setData] = useState<DispatchHistoryResult | null>(null);
  const [items, setItems] = useState<DispatchHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState<'' | 'email' | 'whatsapp'>('');
  const [status, setStatus] = useState<'' | 'sent' | 'pending' | 'failed'>('');
  const [campaignId, setCampaignId] = useState('');
  const [search, setSearch] = useState('');

  // Debounce da busca livre para não bater na API a cada tecla.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const buildFilters = useCallback(
    (offset: number): DispatchHistoryFilters => ({
      channel: channel || undefined,
      status: status || undefined,
      campaignId: campaignId || undefined,
      q: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [channel, status, campaignId, debouncedSearch]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDispatchHistory(buildFilters(0));
      setData(result);
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const result = await fetchDispatchHistory(buildFilters(items.length));
      setData(result);
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...result.items.filter((i) => !seen.has(i.id))];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar mais disparos');
    } finally {
      setLoadingMore(false);
    }
  };

  const counters = [
    { label: 'Total no filtro', value: data?.total ?? 0, icon: <History className="h-4 w-4" /> },
    { label: 'Enviados', value: data?.counts.sent ?? 0, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
    { label: 'Pendentes', value: data?.counts.pending ?? 0, icon: <Clock className="h-4 w-4 text-amber-500" /> },
    { label: 'Falhas', value: data?.counts.failed ?? 0, icon: <XCircle className="h-4 w-4 text-red-500" /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Histórico de disparos</h1>
          <p className="text-xs text-muted-foreground">
            Todos os envios de email e WhatsApp disparados pelas suítes e campanhas, com status e erros.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Contadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {counters.map((c) => (
          <Card key={c.label} className="glass-card py-0">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-secondary/50 p-2">{c.icon}</div>
              <div>
                <p className="text-lg font-black text-foreground">{c.value}</p>
                <p className="text-[11px] text-muted-foreground">{c.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base font-bold">Disparos</CardTitle>
          <CardDescription>Ordenados do mais recente para o mais antigo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filtros */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar lead, destino, campanha…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-secondary/40 pl-9 text-xs"
              />
            </div>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as '' | 'email' | 'whatsapp')}
              className="h-9 rounded-lg border border-border/80 bg-background/50 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              <option value="">Todos os canais</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as '' | 'sent' | 'pending' | 'failed')}
              className="h-9 rounded-lg border border-border/80 bg-background/50 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              <option value="">Todos os status</option>
              <option value="sent">Enviados</option>
              <option value="pending">Pendentes</option>
              <option value="failed">Falhas</option>
            </select>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="h-9 rounded-lg border border-border/80 bg-background/50 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              <option value="">Todas as campanhas</option>
              {(data?.campaigns || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {CHANNEL_LABEL[c.channel] ? `${CHANNEL_LABEL[c.channel]} · ` : ''}
                  {c.name || '(sem nome)'}
                </option>
              ))}
            </select>
          </div>

          {/* Lista */}
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando disparos…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
              Nenhum disparo encontrado
              {channel || status || campaignId || debouncedSearch
                ? ' com os filtros atuais. Ajuste os filtros ou limpe a busca.'
                : ' ainda. Lance uma campanha ou ative uma suíte para começar.'}
            </div>
          ) : (
            <>
              {/* Tabela (desktop) */}
              <div className="hidden overflow-x-auto rounded-xl border border-border/80 md:block">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-bold">Quando</th>
                      <th className="px-3 py-2 font-bold">Canal</th>
                      <th className="px-3 py-2 font-bold">Lead</th>
                      <th className="px-3 py-2 font-bold">Destino</th>
                      <th className="px-3 py-2 font-bold">Campanha</th>
                      <th className="px-3 py-2 font-bold">Mensagem</th>
                      <th className="px-3 py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {items.map((d) => {
                      const bucket = BUCKET_META[d.bucket];
                      return (
                        <tr key={d.id} className="bg-background/30 align-top hover:bg-secondary/20">
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatWhen(d.sentAt || d.createdAt)}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className="gap-1">
                              {d.channel === 'email' ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                              {CHANNEL_LABEL[d.channel]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="max-w-44 truncate font-semibold text-foreground">{d.companyName || 'Lead removido'}</p>
                            {d.cnpj && <p className="text-[10px] uppercase text-muted-foreground">{d.cnpj}</p>}
                          </td>
                          <td className="max-w-40 truncate px-3 py-2.5 text-muted-foreground">{d.destination || '—'}</td>
                          <td className="max-w-40 px-3 py-2.5">
                            <p className="truncate text-muted-foreground">{d.campaignName || '—'}</p>
                            {d.origin === 'auto' && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-500" title={ORIGIN_META.auto.title}>
                                <Zap className="h-3 w-3 fill-emerald-400" /> auto
                              </span>
                            )}
                          </td>
                          <td className="max-w-64 px-3 py-2.5">
                            <p className="truncate text-muted-foreground" title={d.error || d.preview || undefined}>
                              {d.preview || '—'}
                            </p>
                            {d.error && <p className="max-w-64 truncate text-[10px] font-semibold text-red-500">{d.error}</p>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <Badge variant={bucket.variant} className="gap-1">
                              {bucket.icon} {STATUS_LABEL[d.status] || bucket.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards (mobile) */}
              <div className="space-y-2 md:hidden">
                {items.map((d) => {
                  const bucket = BUCKET_META[d.bucket];
                  return (
                    <div key={d.id} className="space-y-2 rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="gap-1">
                          {d.channel === 'email' ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                          {CHANNEL_LABEL[d.channel]}
                        </Badge>
                        <Badge variant={bucket.variant} className="gap-1">
                          {bucket.icon} {STATUS_LABEL[d.status] || bucket.label}
                        </Badge>
                      </div>
                      <p className="font-bold text-foreground">{d.companyName || 'Lead removido'}</p>
                      <p className="text-muted-foreground">{d.destination || '—'} · {formatWhen(d.sentAt || d.createdAt)}</p>
                      {d.campaignName && (
                        <p className="text-muted-foreground">
                          {d.origin === 'auto' && <Zap className="mr-0.5 inline h-3 w-3 fill-emerald-400 text-emerald-500" />}
                          {d.campaignName}
                        </p>
                      )}
                      <p className="line-clamp-2 text-muted-foreground">{d.preview || '—'}</p>
                      {d.error && <p className="text-[10px] font-semibold text-red-500">{d.error}</p>}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Exibindo {items.length} de {data?.total ?? items.length} disparo(s)
                </span>
                {data?.hasMore && (
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} className="gap-2">
                    {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                    Carregar mais
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
