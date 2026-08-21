import React, { useEffect, useState, useCallback } from 'react';
import {
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
  Send,
  Loader2,
  QrCode,
  Unplug,
  PlayCircle,
  PauseCircle,
  XCircle,
  Inbox,
  UserCheck,
  ShieldBan,
  ArrowLeft,
  Radio,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Prospect,
  WhatsAppAccount,
  WhatsAppCampaign,
  WhatsAppConversation,
  WhatsAppMessage,
} from '@/types';
import {
  fetchWhatsAppAccounts,
  createWhatsAppAccount,
  connectWhatsAppAccount,
  fetchWhatsAppQr,
  disconnectWhatsAppAccount,
  reconnectWhatsAppAccount,
  removeWhatsAppAccount,
  fetchWhatsAppConversations,
  fetchWhatsAppMessages,
  sendWhatsAppMessage,
  assignWhatsAppConversation,
  fetchWhatsAppCampaigns,
  createWhatsAppCampaign,
  startWhatsAppCampaign,
  pauseWhatsAppCampaign,
  resumeWhatsAppCampaign,
  cancelWhatsAppCampaign,
  markDoNotContact,
} from '@/services/api';

interface WhatsAppViewProps {
  prospects: Prospect[];
}

type SubTab = 'connections' | 'campaigns' | 'inbox';

const ACCOUNT_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'qualified' | 'prospect' | 'lead' | 'closed' }> = {
  CONNECTED: { label: 'Conectado', variant: 'qualified' },
  QR_REQUIRED: { label: 'QR Code', variant: 'prospect' },
  STARTING: { label: 'Conectando', variant: 'prospect' },
  DISCONNECTED: { label: 'Desconectado', variant: 'secondary' },
  STOPPED: { label: 'Parada', variant: 'secondary' },
  ERROR: { label: 'Erro', variant: 'destructive' },
  CREATED: { label: 'Criada', variant: 'outline' },
};

const CAMPAIGN_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'qualified' | 'prospect' | 'lead' | 'closed' }> = {
  DRAFT: { label: 'Rascunho', variant: 'outline' },
  SCHEDULED: { label: 'Agendada', variant: 'prospect' },
  RUNNING: { label: 'Em execução', variant: 'qualified' },
  PAUSED: { label: 'Pausada', variant: 'prospect' },
  COMPLETED: { label: 'Concluída', variant: 'secondary' },
  CANCELLED: { label: 'Cancelada', variant: 'destructive' },
};

const CONVERSATION_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'qualified' | 'prospect' | 'lead' | 'closed' }> = {
  ACTIVE: { label: 'Ativa', variant: 'qualified' },
  PAUSED: { label: 'Pausada', variant: 'prospect' },
  HUMAN_HANDOFF: { label: 'Atendimento humano', variant: 'lead' },
  CLOSED: { label: 'Encerrada', variant: 'secondary' },
  OPTED_OUT: { label: 'Opt-out', variant: 'destructive' },
};

export const WhatsAppView: React.FC<WhatsAppViewProps> = ({ prospects }) => {
  const [tab, setTab] = useState<SubTab>('connections');

  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);

  const [qr, setQr] = useState<{ qrCode?: string | null; raw?: string | null } | null>(null);
  const [qrAccountId, setQrAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccounts(await fetchWhatsAppAccounts());
  }, []);
  const loadCampaigns = useCallback(async () => {
    setCampaigns(await fetchWhatsAppCampaigns());
  }, []);
  const loadConversations = useCallback(async () => {
    setConversations(await fetchWhatsAppConversations());
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadAccounts(), loadCampaigns(), loadConversations()]);
    setLoading(false);
  }, [loadAccounts, loadCampaigns, loadConversations]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling do QR/status enquanto uma conta está conectando.
  useEffect(() => {
    if (!qrAccountId) return;
    const id = setInterval(async () => {
      await loadAccounts();
      const acc = (await fetchWhatsAppAccounts()).find((a) => a.id === qrAccountId);
      if (acc && acc.status === 'CONNECTED') {
        setQr(null);
        setQrAccountId(null);
        setNotice('WhatsApp conectado com sucesso!');
        await loadAll();
      }
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrAccountId]);

  const handleConnect = async () => {
    setError(null);
    setNotice(null);
    try {
      let account = accounts[0];
      if (!account) {
        account = await createWhatsAppAccount();
      }
      const result = await connectWhatsAppAccount(account.id);
      setQrAccountId(account.id);
      setQr(result.qr || null);
      await loadAccounts();
      if (result.qr && result.qr.qrCode) {
        setNotice('Escaneie o QR Code com o seu WhatsApp para conectar.');
      } else {
        setNotice('Abrindo conexão… aguarde o QR Code.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar o WhatsApp');
    }
  };

  const handleRefreshQr = async (accountId: string) => {
    setError(null);
    const qr = await fetchWhatsAppQr(accountId);
    setQr(qr);
    setQrAccountId(accountId);
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Desconectar este WhatsApp?')) return;
    await disconnectWhatsAppAccount(id);
    await loadAccounts();
  };

  const handleReconnect = async (id: string) => {
    await reconnectWhatsAppAccount(id);
    setQrAccountId(id);
    await loadAccounts();
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remover esta conexão? O histórico de conversas será mantido, mas a conexão será desfeita.')) return;
    await removeWhatsAppAccount(id);
    await loadAccounts();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">WhatsApp</h1>
          <p className="text-xs text-muted-foreground">
            Conecte o seu WhatsApp, crie campanhas de prospecção e atenda conversas em um só lugar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadAll} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
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

      <div className="flex gap-2 border-b border-border pb-px">
        {([
          ['connections', 'Conexões'],
          ['campaigns', 'Campanhas'],
          ['inbox', 'Conversas'],
        ] as [SubTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-bold transition ${
              tab === id
                ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-300'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'connections' && (
        <ConnectionsTab
          loading={loading}
          accounts={accounts}
          qr={qr}
          qrAccountId={qrAccountId}
          onConnect={handleConnect}
          onRefreshQr={handleRefreshQr}
          onDisconnect={handleDisconnect}
          onReconnect={handleReconnect}
          onRemove={handleRemove}
        />
      )}

      {tab === 'campaigns' && (
        <CampaignsTab
          loading={loading}
          campaigns={campaigns}
          accounts={accounts}
          prospects={prospects}
          onReload={loadAll}
          setError={setError}
          setNotice={setNotice}
        />
      )}

      {tab === 'inbox' && (
        <InboxTab
          loading={loading}
          conversations={conversations}
          onReload={loadConversations}
          setError={setError}
        />
      )}
    </div>
  );
};

// ─── Conexões ────────────────────────────────────────────────────────────────

function ConnectionsTab(props: {
  loading: boolean;
  accounts: WhatsAppAccount[];
  qr: { qrCode?: string | null; raw?: string | null } | null;
  qrAccountId: string | null;
  onConnect: () => void;
  onRefreshQr: (id: string) => void;
  onDisconnect: (id: string) => void;
  onReconnect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { loading, accounts, qr, qrAccountId, onConnect, onRefreshQr, onDisconnect, onReconnect, onRemove } = props;
  const connected = accounts.some((a) => a.status === 'CONNECTED');

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-500">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Conexão do WhatsApp</CardTitle>
              <CardDescription>Conecte seu número para disparar campanhas e atender conversas</CardDescription>
            </div>
          </div>
          {!connected && (
            <Button variant="gradient" size="sm" onClick={onConnect} className="gap-2">
              <QrCode className="h-4 w-4" /> Conectar WhatsApp
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl bg-secondary/30 p-4 text-sm text-muted-foreground">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p>Nenhuma conexão. Clique em “Conectar WhatsApp” e escaneie o QR Code com o seu celular.</p>
          </div>
        ) : (
          accounts.map((acc) => {
            const meta = ACCOUNT_META[acc.status] || { label: acc.status, variant: 'outline' as const };
            return (
              <div key={acc.id} className="space-y-3 rounded-xl border border-border/80 bg-secondary/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-black text-emerald-500">
                      <Radio className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {acc.phoneNumber ? `+${acc.phoneNumber}` : 'Número ainda não identificado'}
                      </p>
                      <p className="text-xs text-muted-foreground">Conexão criada em {new Date(acc.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </div>

                {(acc.status === 'QR_REQUIRED' || acc.status === 'STARTING' || acc.status === 'CREATED') && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onRefreshQr(acc.id)} className="gap-2">
                      <QrCode className="h-4 w-4" /> Mostrar QR Code
                    </Button>
                  </div>
                )}

                {acc.status === 'CONNECTED' && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onDisconnect(acc.id)} className="gap-2">
                      <Unplug className="h-4 w-4" /> Desconectar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onRemove(acc.id)} className="text-red-500 hover:text-red-600">
                      Remover
                    </Button>
                  </div>
                )}

                {(acc.status === 'DISCONNECTED' || acc.status === 'STOPPED' || acc.status === 'ERROR') && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => onReconnect(acc.id)} className="gap-2">
                      <PlayCircle className="h-4 w-4" /> Reconectar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onRemove(acc.id)} className="text-red-500 hover:text-red-600">
                      Remover
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {qr && qr.qrCode && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
            <p className="text-sm font-bold text-foreground">Escaneie com o WhatsApp do seu celular</p>
            <img src={qr.qrCode} alt="QR Code de conexão" className="h-64 w-64 rounded-xl bg-white p-2" />
            <p className="text-xs text-muted-foreground">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho</p>
            {qrAccountId && (
              <Button variant="outline" size="sm" onClick={() => onRefreshQr(qrAccountId)} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Atualizar QR Code
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Campanhas ───────────────────────────────────────────────────────────────

function CampaignsTab(props: {
  loading: boolean;
  campaigns: WhatsAppCampaign[];
  accounts: WhatsAppAccount[];
  prospects: Prospect[];
  onReload: () => void;
  setError: (e: string | null) => void;
  setNotice: (e: string | null) => void;
}) {
  const { loading, campaigns, accounts, prospects, onReload, setError, setNotice } = props;
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [steps, setSteps] = useState<Array<{ messageTemplate: string; delayDays: number }>>([
    { messageTemplate: 'Olá {{firstName}}, tudo bem? Vi que a {{companyName}} atua em {{industry}}.', delayDays: 0 },
  ]);
  const [creating, setCreating] = useState(false);
  const [startId, setStartId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const connectedAccounts = accounts.filter((a) => a.status === 'CONNECTED');

  const addStep = () => setSteps((s) => [...s, { messageTemplate: '', delayDays: 2 }]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    const validSteps = steps.filter((s) => s.messageTemplate.trim());
    if (validSteps.length === 0) {
      setError('Adicione ao menos uma mensagem à sequência.');
      return;
    }
    setCreating(true);
    try {
      await createWhatsAppCampaign({
        name: name.trim(),
        whatsappAccountId: accountId || null,
        steps: validSteps.map((s, i) => ({
          orderIndex: i,
          messageTemplate: s.messageTemplate,
          delayMinutes: Math.round(s.delayDays * 1440),
          conditions: [],
        })),
      });
      setName('');
      setSteps([{ messageTemplate: '', delayDays: 0 }]);
      setNotice('Campanha criada. Selecione os leads e inicie.');
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar campanha');
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (campaignId: string) => {
    setError(null);
    if (selected.size === 0) {
      setError('Selecione ao menos um lead.');
      return;
    }
    try {
      const r = await startWhatsAppCampaign(campaignId, Array.from(selected));
      setNotice(`Campanha iniciada: ${r.jobsQueued} lead(s) na fila.`);
      setSelected(new Set());
      setStartId(null);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar campanha');
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="glass-card lg:col-span-1">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-500">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Nova campanha</CardTitle>
              <CardDescription>Defina a sequência de mensagens</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Nome</label>
              <Input placeholder="Ex: Prospecção Q4" value={name} onChange={(e) => setName(e.target.value)} className="bg-secondary/40 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Conexão</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border/80 bg-background/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
              >
                <option value="">Selecionar conexão…</option>
                {connectedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.phoneNumber ? `+${a.phoneNumber}` : 'WhatsApp'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Sequência ({steps.length})</label>
              {steps.map((s, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border border-border/80 bg-secondary/30 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Mensagem {i + 1}</span>
                    {steps.length > 1 && (
                      <button type="button" onClick={() => removeStep(i)} className="text-xs text-red-500 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Olá {{firstName}}… (use {{companyName}}, {{city}}, {{industry}})"
                    value={s.messageTemplate}
                    onChange={(e) => setSteps((prev) => prev.map((x, idx) => (idx === i ? { ...x, messageTemplate: e.target.value } : x)))}
                    className="w-full rounded-lg border border-border/80 bg-background/50 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
                  />
                  {i > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-muted-foreground">Aguardar (dias):</label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={s.delayDays}
                        onChange={(e) => setSteps((prev) => prev.map((x, idx) => (idx === i ? { ...x, delayDays: Number(e.target.value) || 0 } : x)))}
                        className="w-20 rounded-lg border border-border/80 bg-background/50 px-2 py-1 text-xs focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addStep} className="w-full gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Adicionar etapa
              </Button>
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
          <CardDescription>Suas campanhas de prospecção via WhatsApp</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma campanha ainda. Crie a primeira ao lado.</p>
          ) : (
            campaigns.map((c) => {
              const meta = CAMPAIGN_META[c.status] || { label: c.status, variant: 'outline' as const };
              return (
                <div key={c.id} className="space-y-2 rounded-xl border border-border/80 bg-secondary/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Send className="h-4 w-4 text-indigo-400" />
                      <h4 className="text-sm font-bold text-foreground">{c.name}</h4>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{c._count?.contacts ?? 0} lead(s)</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.steps?.length ?? 0} etapa(s) · Criada em {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status === 'DRAFT' || c.status === 'SCHEDULED' ? (
                      <Button variant="outline" size="sm" onClick={() => setStartId(c.id)} className="gap-2">
                        <PlayCircle className="h-4 w-4" /> Iniciar
                      </Button>
                    ) : null}
                    {c.status === 'RUNNING' && (
                      <Button variant="outline" size="sm" onClick={async () => { await pauseWhatsAppCampaign(c.id); await onReload(); }} className="gap-2">
                        <PauseCircle className="h-4 w-4" /> Pausar
                      </Button>
                    )}
                    {c.status === 'PAUSED' && (
                      <Button variant="outline" size="sm" onClick={async () => { await resumeWhatsAppCampaign(c.id); await onReload(); }} className="gap-2">
                        <PlayCircle className="h-4 w-4" /> Retomar
                      </Button>
                    )}
                    {c.status === 'RUNNING' || c.status === 'PAUSED' ? (
                      <Button variant="ghost" size="sm" onClick={async () => { if (confirm('Cancelar esta campanha?')) { await cancelWhatsAppCampaign(c.id); await onReload(); } }} className="gap-2 text-red-500 hover:text-red-600">
                        <XCircle className="h-4 w-4" /> Cancelar
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {startId && (
        <Card className="lg:col-span-3 border-indigo-200 bg-indigo-50/40 dark:border-indigo-500/20 dark:bg-indigo-500/5">
          <CardHeader>
            <CardTitle className="text-base font-bold">Iniciar campanha em leads</CardTitle>
            <CardDescription>Selecione os leads que receberão a sequência.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
              {prospects.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition ${
                      checked ? 'border-indigo-400 bg-indigo-500/10 text-indigo-100' : 'border-border/80 bg-secondary/30 text-muted-foreground hover:border-indigo-300'
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-muted-foreground'}`}>
                      {checked ? '✓' : ''}
                    </span>
                    <span className="truncate font-semibold">{p.companyName}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStartId(null)}>Cancelar</Button>
              <Button variant="gradient" size="sm" onClick={() => handleStart(startId)} disabled={selected.size === 0} className="gap-2">
                <Send className="h-4 w-4" /> Iniciar ({selected.size})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Conversas (inbox) ───────────────────────────────────────────────────────

function InboxTab(props: {
  loading: boolean;
  conversations: WhatsAppConversation[];
  onReload: () => void;
  setError: (e: string | null) => void;
}) {
  const { loading, conversations, onReload, setError } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    if (selectedId) {
      fetchWhatsAppMessages(selectedId).then(setMessages);
    }
  }, [selectedId]);

  const handleSend = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    try {
      await sendWhatsAppMessage(selected.id, reply.trim());
      setReply('');
      setMessages(await fetchWhatsAppMessages(selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar');
    } finally {
      setSending(false);
    }
  };

  const handleAssign = async () => {
    if (!selected) return;
    await assignWhatsAppConversation(selected.id);
    await onReload();
  };

  const handleBlock = async () => {
    if (!selected?.prospectId) return;
    if (!confirm('Bloquear este lead de receber mensagens de WhatsApp? Essa ação prevalece sobre qualquer campanha.')) return;
    await markDoNotContact(selected.prospectId);
    await onReload();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas…
      </div>
    );
  }

  if (selected) {
    const meta = CONVERSATION_META[selected.status] || { label: selected.status, variant: 'outline' as const };
    return (
      <Card className="glass-card">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <CardTitle className="text-base font-bold">
                  {selected.prospect?.companyName || `+${selected.phoneNumber}`}
                </CardTitle>
                <CardDescription>+{selected.phoneNumber}</CardDescription>
              </div>
              <Badge variant={meta.variant}>{meta.label}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleAssign} className="gap-2">
                <UserCheck className="h-4 w-4" /> Assumir
              </Button>
              {selected.prospectId && (
                <Button variant="ghost" size="sm" onClick={handleBlock} className="gap-2 text-red-500 hover:text-red-600">
                  <ShieldBan className="h-4 w-4" /> Bloquear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-xl border border-border/80 bg-secondary/20 p-3" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                      m.direction === 'OUTBOUND'
                        ? 'bg-indigo-500 text-white'
                        : 'bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p className={`mt-1 text-[10px] ${m.direction === 'OUTBOUND' ? 'text-indigo-100' : 'text-slate-400'}`}>
                      {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Responder manualmente…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              className="bg-secondary/40 text-sm"
            />
            <Button variant="gradient" size="sm" onClick={handleSend} disabled={sending || !reply.trim()} className="shrink-0 gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-base font-bold">Conversas ({conversations.length})</CardTitle>
        <CardDescription>Leads que iniciaram conversa ou responderam campanhas</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {conversations.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl bg-secondary/30 p-4 text-sm text-muted-foreground">
            <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p>Nenhuma conversa ainda. Quando um lead responder, ela aparecerá aqui para atendimento.</p>
          </div>
        ) : (
          conversations.map((c) => {
            const meta = CONVERSATION_META[c.status] || { label: c.status, variant: 'outline' as const };
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-secondary/30 p-3 text-left transition hover:border-indigo-300"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-black text-indigo-500">
                    {(c.prospect?.companyName || '+').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{c.prospect?.companyName || `+${c.phoneNumber}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {c._count?.messages ?? 0} mensagem(ns) · {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString('pt-BR') : '—'}
                    </p>
                  </div>
                </div>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
