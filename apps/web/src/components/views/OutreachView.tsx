import React, { useEffect, useState } from 'react';
import {
  Send,
  Plus,
  Mail,
  ShieldBan,
  RefreshCw,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Inbox,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Prospect, EmailAccount, OutreachCampaign, SuppressionEntry } from '@/types';
import {
  fetchGmailAuthUrl,
  fetchGmailAccounts,
  disconnectGmailAccount,
  fetchOutreachCampaigns,
  createOutreachCampaign,
  startOutreachCampaign,
  fetchSuppressionList,
  addToSuppressionList,
  removeFromSuppressionList,
} from '@/services/api';

interface OutreachViewProps {
  prospects: Prospect[];
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'qualified' | 'prospect' | 'lead' | 'closed' }> = {
  draft: { label: 'Rascunho', variant: 'outline' },
  active: { label: 'Ativa', variant: 'qualified' },
  paused: { label: 'Pausada', variant: 'prospect' },
  completed: { label: 'Concluída', variant: 'secondary' },
};

export const OutreachView: React.FC<OutreachViewProps> = ({ prospects }) => {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [suppression, setSuppression] = useState<SuppressionEntry[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startCampaignId, setStartCampaignId] = useState<string>('');
  const [startAccountId, setStartAccountId] = useState<string>('');

  const [suppressEmail, setSuppressEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [c, a, s] = await Promise.all([
      fetchOutreachCampaigns(),
      fetchGmailAccounts(),
      fetchSuppressionList(),
    ]);
    setCampaigns(c);
    setAccounts(a);
    setSuppression(s);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedAccounts = accounts.filter((a) => a.status === 'connected');

  const handleConnectGmail = async () => {
    setError(null);
    try {
      const url = await fetchGmailAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar o Gmail');
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createOutreachCampaign({ name: name.trim(), description: description.trim() || undefined });
      setCampaigns([created, ...campaigns]);
      setName('');
      setDescription('');
      setNotice(`Campanha "${created.name}" criada. Use "Iniciar" para lançar em leads.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar campanha');
    } finally {
      setCreating(false);
    }
  };

  const handleStartCampaign = async (campaignId: string) => {
    setError(null);
    if (selectedIds.size === 0) {
      setError('Selecione ao menos um lead para iniciar a campanha.');
      return;
    }
    if (!startAccountId && connectedAccounts.length === 1) {
      await doStart(campaignId, Array.from(selectedIds), connectedAccounts[0].id);
      return;
    }
    await doStart(campaignId, Array.from(selectedIds), startAccountId || null);
  };

  const doStart = async (campaignId: string, ids: string[], accountId: string | null) => {
    setStarting(campaignId);
    try {
      const result = await startOutreachCampaign(campaignId, ids, accountId);
      setNotice(`Campanha iniciada: ${result.jobsQueued} lead(s) na fila.`);
      setSelectedIds(new Set());
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar campanha');
    } finally {
      setStarting(null);
    }
  };

  const toggleProspect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Desconectar esta conta do Gmail?')) return;
    await disconnectGmailAccount(id);
    await loadAll();
  };

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppressEmail.trim()) return;
    try {
      await addToSuppressionList(suppressEmail.trim());
      setSuppressEmail('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar à supressão');
    }
  };

  const handleRemoveSuppression = async (id: string) => {
    await removeFromSuppressionList(id);
    await loadAll();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Outreach automático
          </h1>
          <p className="text-xs text-muted-foreground">
            Crie campanhas de cold email, conecte o Gmail e acompanhe aberturas e respostas em tempo real.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

      {(notice || error) && (
        <div
          className={
            error
              ? 'rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300'
              : 'rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
          }
        >
          {error || notice}
        </div>
      )}

      {/* Connected Gmail accounts */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-red-500/10 p-2 text-red-500">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Contas do Gmail</CardTitle>
                <CardDescription>Remetente usado para disparar os emails</CardDescription>
              </div>
            </div>
            <Button variant="gradient" size="sm" onClick={handleConnectGmail} className="gap-2">
              <ExternalLink className="h-4 w-4" /> Conectar Gmail
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : connectedAccounts.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl bg-secondary/30 p-4 text-sm text-muted-foreground">
              <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <p>
                Nenhuma conta conectada. Conecte uma conta do Gmail para começar a enviar campanhas de outreach.
              </p>
            </div>
          ) : (
            connectedAccounts.map((acct) => (
              <div
                key={acct.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-secondary/30 p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-sm font-black text-red-500">
                    {acct.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{acct.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Conectada em {new Date(acct.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDisconnect(acct.id)} className="text-red-500 hover:text-red-600">
                  Desconectar
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Create campaign + list */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-500">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Nova campanha</CardTitle>
                <CardDescription>Crie uma sequência para um grupo de leads</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nome da campanha</label>
                <Input
                  placeholder="Ex: Lançamento SDR - Q4"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Descrição (opcional)</label>
                <Input
                  placeholder="Segmento, objetivo, etc."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>
              <Button type="submit" variant="gradient" className="w-full gap-2 text-xs" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar campanha
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold">Campanhas ({campaigns.length})</CardTitle>
            <CardDescription>Sequências de email criadas na sua organização</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando campanhas…
              </div>
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma campanha ainda. Crie a primeira ao lado.</p>
            ) : (
              campaigns.map((campaign) => {
                const meta = STATUS_META[campaign.status] || { label: campaign.status, variant: 'outline' as const };
                return (
                  <div
                    key={campaign.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-secondary/30 p-4 md:flex-row md:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Send className="h-4 w-4 text-indigo-400" />
                        <h4 className="text-sm font-bold text-foreground">{campaign.name}</h4>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {campaign.description || 'Sem descrição'} · Criada em {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStartCampaignId(campaign.id);
                        setStartAccountId(connectedAccounts.length === 1 ? connectedAccounts[0].id : '');
                      }}
                      className="gap-2 self-start md:self-auto"
                    >
                      <PlayCircleIcon /> Iniciar em leads
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Launch panel */}
      {startCampaignId && (
        <Card className="border-indigo-200 bg-indigo-50/40 dark:border-indigo-500/20 dark:bg-indigo-500/5">
          <CardHeader>
            <CardTitle className="text-base font-bold">Lançar campanha em leads</CardTitle>
            <CardDescription>
              Selecione os leads e escolha a conta remetente para iniciar a sequência.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <select
                value={startAccountId}
                onChange={(e) => setStartAccountId(e.target.value)}
                className="h-10 rounded-lg border border-border/80 bg-background/50 px-3 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
              >
                <option value="">Selecionar conta do Gmail…</option>
                {connectedAccounts.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.email}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStartCampaignId('')}>
                  Cancelar
                </Button>
                <Button
                  variant="gradient"
                  size="sm"
                  onClick={() => handleStartCampaign(startCampaignId)}
                  disabled={starting === startCampaignId || selectedIds.size === 0}
                  className="gap-2"
                >
                  {starting === startCampaignId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Iniciar ({selectedIds.size})
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">
                  Leads selecionados para esta campanha
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-xs">
                  Limpar
                </Button>
              </div>
              <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
                {prospects.map((prospect) => {
                  const checked = selectedIds.has(prospect.id);
                  return (
                    <button
                      key={prospect.id}
                      type="button"
                      onClick={() => toggleProspect(prospect.id)}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition ${
                        checked
                          ? 'border-indigo-400 bg-indigo-500/10 text-indigo-100'
                          : 'border-border/80 bg-secondary/30 text-muted-foreground hover:border-indigo-300 hover:bg-indigo-500/5'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-muted-foreground'
                        }`}
                      >
                        {checked && <CheckCircle2 className="h-3 w-3" />}
                      </span>
                      <span className="truncate font-semibold">{prospect.companyName}</span>
                      <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
                        {prospect.cnpj}
                      </span>
                    </button>
                  );
                })}
              </div>
              {prospects.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Nenhum lead cadastrado. Adicione leads em "Descobrir leads" primeiro.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suppression list */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2 text-amber-500">
                <ShieldBan className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Lista de supressão</CardTitle>
                <CardDescription>Emails que nunca devem receber campanhas</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleAddSuppression} className="flex gap-2">
            <Input
              type="email"
              placeholder="contato@empresa.com.br"
              value={suppressEmail}
              onChange={(e) => setSuppressEmail(e.target.value)}
              className="bg-secondary/40 text-xs"
            />
            <Button type="submit" variant="outline" size="sm" className="shrink-0 gap-2">
              <ShieldBan className="h-4 w-4" /> Adicionar
            </Button>
          </form>
          {suppression.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum email na lista de supressão.</p>
          ) : (
            <div className="space-y-2">
              {suppression.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-secondary/30 p-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.reason || 'manual'} · {new Date(entry.addedAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleRemoveSuppression(entry.id)} className="text-red-500 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

function PlayCircleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
}
