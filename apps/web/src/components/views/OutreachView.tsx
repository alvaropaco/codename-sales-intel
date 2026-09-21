import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Plus,
  Mail,
  MessageCircle,
  ShieldBan,
  RefreshCw,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Inbox,
  Loader2,
  Zap,
  Eye,
  Sparkles,
  Lock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Prospect, EmailAccount, WhatsAppAccount, OutreachCampaign, SuppressionEntry, AiCampaignResult, AiCampaignApproval } from '@/types';
import { usePlan } from '@/hooks/usePlan';
import {
  fetchGmailAuthUrl,
  fetchGmailAccounts,
  disconnectGmailAccount,
  fetchWhatsAppAccounts,
  fetchOutreachCampaigns,
  createOutreachCampaign,
  updateOutreachCampaign,
  sendCampaignTest,
  startOutreachCampaign,
  fetchSuppressionList,
  addToSuppressionList,
  removeFromSuppressionList,
  createAiCampaign,
  approveAiCampaign,
  rederiveOutreachCampaign,
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
  const [waAccounts, setWaAccounts] = useState<WhatsAppAccount[]>([]);
  const [suppression, setSuppression] = useState<SuppressionEntry[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [suiteObjective, setSuiteObjective] = useState('');
  const [suiteOffer, setSuiteOffer] = useState('');
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  // Suíte multicanal
  const [suiteChannels, setSuiteChannels] = useState<Set<string>>(new Set(['email']));
  const [suiteAuto, setSuiteAuto] = useState(true);
  const [suiteEmailAccount, setSuiteEmailAccount] = useState('');
  const [suiteSubject, setSuiteSubject] = useState('');
  const [suiteBody, setSuiteBody] = useState('');
  const [suiteWaAccount, setSuiteWaAccount] = useState('');
  const [suiteWaMessage, setSuiteWaMessage] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startCampaignId, setStartCampaignId] = useState<string>('');
  const [startAccountId, setStartAccountId] = useState<string>('');

  const [suppressEmail, setSuppressEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Campanha com IA (feature Premium)
  const { plan } = usePlan();
  const isPremium = plan?.plan === 'premium';
  const [aiCreating, setAiCreating] = useState(false);
  const [aiResult, setAiResult] = useState<AiCampaignResult | null>(null);
  // 007 (FR-009): edições opcionais da mensagem base antes de aprovar o disparo.
  const [aiEdits, setAiEdits] = useState({ whatsappMessageTemplate: '', emailTemplateSubject: '', emailTemplateBody: '' });
  const [aiApproving, setAiApproving] = useState(false);

  // O alerta renderiza no topo da página; sem este scroll o usuário que
  // acabou de clicar num botão do fim do formulário não vê o feedback.
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || notice) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error, notice]);

  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [c, a, w, s] = await Promise.all([
      fetchOutreachCampaigns(),
      fetchGmailAccounts(),
      fetchWhatsAppAccounts(),
      fetchSuppressionList(),
    ]);
    setCampaigns(c);
    setAccounts(a);
    setWaAccounts(w);
    setSuppression(s);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedAccounts = accounts.filter((a) => a.status === 'connected');
  const connectedWaAccounts = waAccounts.filter((a) => a.status === 'CONNECTED');

  const toggleChannel = (channel: string) => {
    setSuiteChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  const renderPreview = (template: string) =>
    template
      .replace(/{{firstName}}/g, 'Mariana')
      .replace(/{{companyName}}/g, 'Transportes Alfa Ltda')
      .replace(/{{jobTitle}}/g, 'Sócia-Administradora')
      .replace(/{{city}}/g, 'Curitiba')
      .replace(/{{industry}}/g, 'Transporte rodoviário de carga')
      .replace(/{{[a-zA-Z]+}}/g, '');

  const handleCreateSuite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Dê um nome para a suíte antes de criar (campo "Nome da suíte", no topo do formulário).');
      return;
    }
    const channels = Array.from(suiteChannels);
    if (channels.length === 0) {
      setError('Selecione ao menos um canal (email ou WhatsApp).');
      return;
    }
    if (channels.includes('email') && (suiteAuto || !suiteEmailAccount || !suiteSubject.trim() || !suiteBody.trim())) {
      if (!suiteEmailAccount || !suiteSubject.trim() || !suiteBody.trim()) {
        setError('Canal email: selecione a conta de envio e preencha assunto e mensagem.');
        return;
      }
    }
    if (channels.includes('whatsapp') && (!suiteWaAccount || !suiteWaMessage.trim())) {
      setError('Canal WhatsApp: selecione a conta conectada e escreva a mensagem.');
      return;
    }
    setCreating(true);
    try {
      const created = await createOutreachCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        objective: suiteObjective.trim() || undefined,
        offer: suiteOffer.trim() || undefined,
        trigger: suiteAuto ? 'on_enrichment' : 'manual',
        channels,
        autoActive: suiteAuto,
        emailAccountId: channels.includes('email') ? suiteEmailAccount : null,
        emailTemplateSubject: channels.includes('email') ? suiteSubject.trim() : undefined,
        emailTemplateBody: channels.includes('email') ? suiteBody.trim() : undefined,
        whatsappAccountId: channels.includes('whatsapp') ? suiteWaAccount : null,
        whatsappTemplate: channels.includes('whatsapp') ? suiteWaMessage.trim() : undefined,
      });
      setCampaigns([created, ...campaigns]);
      setName('');
      setDescription('');
      setSuiteObjective('');
      setSuiteOffer('');
      setSuiteSubject('');
      setSuiteBody('');
      setSuiteWaMessage('');
      setNotice(
        suiteAuto
          ? `Suíte "${created.name}" criada e ATIVA: leads enriquecidos disparam ${channels.join(' + ')} automaticamente.`
          : `Campanha "${created.name}" criada. Use "Iniciar em leads" para lançar manualmente.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar campanha');
    } finally {
      setCreating(false);
    }
  };

  const handleSendTest = async (channel: 'email' | 'whatsapp') => {
    setTesting(channel);
    setError(null);
    setNotice(null);
    try {
      const message = await sendCampaignTest(
        channel === 'email'
          ? {
              channel,
              emailAccountId: suiteEmailAccount,
              subject: suiteSubject.trim(),
              body: suiteBody.trim(),
            }
          : {
              channel,
              whatsappAccountId: suiteWaAccount,
              message: suiteWaMessage.trim(),
              toPhone: testPhone.trim(),
            }
      );
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar teste');
    } finally {
      setTesting(null);
    }
  };

  const handleToggleAuto = async (campaign: OutreachCampaign) => {
    setToggling(campaign.id);
    setError(null);
    try {
      const updated = await updateOutreachCampaign(campaign.id, { autoActive: !campaign.autoActive });
      setCampaigns(campaigns.map((c) => (c.id === updated.id ? updated : c)));
      setNotice(`Automação de "${updated.name}" ${updated.autoActive ? 'ATIVADA' : 'desativada'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar campanha');
    } finally {
      setToggling(null);
    }
  };

  const handleConnectGmail = async () => {
    setError(null);
    try {
      const url = await fetchGmailAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar o Gmail');
    }
  };

  /**
   * Campanha com IA (Premium): gera estratégia, salva campanhas e inicia os
   * disparos para todos os leads "Prontos para contato". Trial → upgrade.
   */
  const handleGenerateAiCampaign = async () => {
    setError(null);
    setNotice(null);
    if (!isPremium) {
      window.location.href = '/settings?plan=upgrade';
      return;
    }
    setAiCreating(true);
    try {
      const result = await createAiCampaign();
      setAiResult(result);
      setAiEdits({
        whatsappMessageTemplate: result.preview.whatsapp?.message ?? '',
        emailTemplateSubject: result.preview.email?.subject ?? '',
        emailTemplateBody: result.preview.email?.body ?? '',
      });
      setNotice(
        `Campanha "${result.strategy.name}" criada — revise a mensagem base abaixo ` +
          `e aprove para disparar (${result.channels.join(' + ')}, ${result.leadCount} lead(s) pronto(s)).`
      );
      await loadAll();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'PREMIUM_REQUIRED') {
        window.location.href = '/settings?plan=upgrade';
        return;
      }
      setError(err instanceof Error ? err.message : 'Erro ao gerar campanha com IA');
    } finally {
      setAiCreating(false);
    }
  };

  // 007 (FR-009): aprovação obrigatória da mensagem base antes de qualquer disparo.
  const handleApproveAiCampaign = async () => {
    if (!aiResult) return;
    setAiApproving(true);
    setError(null);
    try {
      const edits: { whatsappMessageTemplate?: string; emailTemplateSubject?: string; emailTemplateBody?: string } = {};
      if (aiEdits.whatsappMessageTemplate.trim()) edits.whatsappMessageTemplate = aiEdits.whatsappMessageTemplate;
      if (aiEdits.emailTemplateSubject.trim()) edits.emailTemplateSubject = aiEdits.emailTemplateSubject;
      if (aiEdits.emailTemplateBody.trim()) edits.emailTemplateBody = aiEdits.emailTemplateBody;
      const approval: AiCampaignApproval = await approveAiCampaign({
        outreachCampaignId: aiResult.emailCampaignId,
        whatsappCampaignId: aiResult.whatsappCampaignId,
        edits,
      });
      const total = approval.enrolled.email + approval.enrolled.whatsapp;
      setNotice(
        `Campanha aprovada e lançada: ${total} envio(s) na fila.` +
          (approval.launchErrors.length ? ` Falhas: ${approval.launchErrors.join(' · ')}` : '')
      );
      setAiResult(null);
      setAiEdits({ whatsappMessageTemplate: '', emailTemplateSubject: '', emailTemplateBody: '' });
      await loadAll();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'PREMIUM_REQUIRED') {
        window.location.href = '/settings?plan=upgrade';
        return;
      }
      setError(err instanceof Error ? err.message : 'Erro ao aprovar campanha');
    } finally {
      setAiApproving(false);
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
      const skipped = result.skippedAlreadyEnrolled
        ? ` ${result.skippedAlreadyEnrolled} já contatado(s) nesta campanha ficou(aram) de fora.`
        : '';
      setNotice(`Campanha iniciada: ${result.jobsQueued} lead(s) na fila.${skipped}`);
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

  // Leads já inscritos na campanha selecionada para lançamento — ficam FORA
  // da lista: o primeiro toque de uma campanha nunca se repete pro mesmo
  // lead (o backend também barra — isto aqui é UX, não segurança).
  const enrolledInStartCampaign = useMemo(() => {
    if (!startCampaignId) return new Set<string>();
    return new Set(campaigns.find((c) => c.id === startCampaignId)?.contactedProspectIds || []);
  }, [campaigns, startCampaignId]);

  const launchableProspects = useMemo(
    () => prospects.filter((p) => !enrolledInStartCampaign.has(p.id)),
    [prospects, enrolledInStartCampaign],
  );

  // Trocou de campanha (ou a lista de inscritos mudou) → seleção antiga não
  // pode conter leads que saíram da lista.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => launchableProspects.some((p) => p.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [launchableProspects]);

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
          ref={alertRef}
          className={
            error
              ? 'rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300'
              : 'rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
          }
        >
          {error || notice}
        </div>
      )}

      {/* Campanha com IA (feature Premium) */}
      <Card className="glass-card border-violet-500/20">
        <CardHeader>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-violet-500/10 p-2 text-violet-500">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  Campanha com IA
                  {!isPremium && (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="h-3 w-3" /> Premium
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {isPremium
                    ? 'A IA cria a campanha com base no seu perfil comercial, escreve uma mensagem única para cada lead e inicia os disparos para todos os leads "Prontos para contato".'
                    : 'Recurso do plano Premium: a IA cria a campanha e dispara mensagens personalizadas para todos os seus leads prontos, automaticamente.'}
                </CardDescription>
              </div>
            </div>
            <Button
              variant="gradient"
              size="sm"
              onClick={handleGenerateAiCampaign}
              disabled={aiCreating || loading}
              className="gap-2 shrink-0"
            >
              {aiCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {aiCreating ? 'IA criando campanha…' : 'Gerar campanha com IA'}
            </Button>
          </div>
        </CardHeader>
        {(aiCreating || aiResult) && (
          <CardContent className="space-y-3">
            {aiCreating && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo seu perfil comercial e compondo a mensagem base para sua revisão…
              </div>
            )}
            {aiResult && (
              <div className="space-y-3">
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-500/20 dark:bg-violet-500/10">
                  <p className="font-bold text-violet-700 dark:text-violet-300">
                    ✨ {aiResult.strategy.name}
                  </p>
                  {aiResult.strategy.objective && (
                    <p className="mt-1 text-foreground/80">Objetivo: {aiResult.strategy.objective}</p>
                  )}
                  {aiResult.strategy.offer && (
                    <p className="text-foreground/80">Oferta: {aiResult.strategy.offer}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Mensagem base — revise antes de disparar (para {aiResult.preview.sampleProspect.companyName})
                  </p>
                  {aiResult.preview.whatsapp && (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">WhatsApp</label>
                      <textarea
                        value={aiEdits.whatsappMessageTemplate}
                        onChange={(e) => setAiEdits((prev) => ({ ...prev, whatsappMessageTemplate: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg border border-border/80 bg-background/50 p-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
                      />
                    </div>
                  )}
                  {aiResult.preview.email && (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Email — assunto</label>
                      <input
                        value={aiEdits.emailTemplateSubject}
                        onChange={(e) => setAiEdits((prev) => ({ ...prev, emailTemplateSubject: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-border/80 bg-background/50 px-3 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
                      />
                      <label className="text-xs text-muted-foreground">Email — corpo</label>
                      <textarea
                        value={aiEdits.emailTemplateBody}
                        onChange={(e) => setAiEdits((prev) => ({ ...prev, emailTemplateBody: e.target.value }))}
                        rows={4}
                        className="w-full rounded-lg border border-border/80 bg-background/50 p-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Personalização por lead é feita pela IA a partir desta base. Os envios respeitam os
                      limites diários por conta.
                    </span>
                    <Button variant="gradient" size="sm" onClick={handleApproveAiCampaign} disabled={aiApproving} className="gap-2">
                      {aiApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Aprovar e disparar
                    </Button>
                  </div>
                </div>
                {!aiResult.contextConfigured && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                    Seu Perfil Comercial está incompleto: a IA foi genérica para não inventar dados.
                    Preencha em <a className="font-bold underline" href="/settings">Configurações → Perfil Comercial</a> para
                    campanhas muito mais assertivas.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

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

      {/* Suíte de campanha (formulário guiado) */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-500">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Nova suíte de campanha</CardTitle>
              <CardDescription>
                Escolha os canais, personalize a mensagem de cada um e dispare automaticamente quando o enriquecimento do lead terminar
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateSuite} className="space-y-5">
            {/* Gatilho */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Nome da suíte</label>
                <Input
                  placeholder="Ex: Prospecção automática Q4"
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
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Objetivo da campanha (usado pela IA)</label>
                <Input
                  placeholder="Ex.: agendar uma demo de 15 min"
                  value={suiteObjective}
                  onChange={(e) => setSuiteObjective(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Proposta/oferta da campanha (usado pela IA)</label>
                <Input
                  placeholder="Ex.: diagnóstico gratuito do funil"
                  value={suiteOffer}
                  onChange={(e) => setSuiteOffer(e.target.value)}
                  className="bg-secondary/40 text-xs"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSuiteAuto((v) => !v)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                suiteAuto
                  ? 'border-emerald-400/60 bg-emerald-500/10'
                  : 'border-border/80 bg-secondary/30'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${suiteAuto ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-bold text-foreground">Disparo automático pós-enriquecimento</p>
                  <p className="text-xs text-muted-foreground">
                    Assim que o enriquecimento de um lead termina, a suíte envia as mensagens nos canais selecionados.
                    Leads já contatados e com opt-out são pulados automaticamente.
                  </p>
                </div>
              </div>
              <span
                className={`flex h-6 w-11 shrink-0 items-center rounded-full px-1 transition ${
                  suiteAuto ? 'justify-end bg-emerald-500' : 'justify-start bg-muted-foreground/30'
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-white shadow" />
              </span>
            </button>

            {/* Canais */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Email */}
              <div
                className={`space-y-3 rounded-xl border p-4 transition ${
                  suiteChannels.has('email') ? 'border-indigo-400/60 bg-indigo-500/5' : 'border-border/80 bg-secondary/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleChannel('email')}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      suiteChannels.has('email') ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-muted-foreground'
                    }`}
                  >
                    {suiteChannels.has('email') && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                  <Mail className="h-4 w-4 text-indigo-400" />
                  <span className="text-sm font-bold text-foreground">Email</span>
                </button>
                {suiteChannels.has('email') && (
                  <div className="space-y-2.5">
                    <select
                      value={suiteEmailAccount}
                      onChange={(e) => setSuiteEmailAccount(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/80 bg-background/50 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
                    >
                      <option value="">Conta de envio…</option>
                      {connectedAccounts.map((acct) => (
                        <option key={acct.id} value={acct.id}>
                          {acct.email}
                        </option>
                      ))}
                    </select>
                    <Input
                      placeholder="Assunto — ex: Uma oportunidade para {{companyName}}"
                      value={suiteSubject}
                      onChange={(e) => setSuiteSubject(e.target.value)}
                      className="bg-secondary/40 text-xs"
                    />
                    <textarea
                      placeholder={'Mensagem…\n\nOlá {{firstName}}, vi que a {{companyName}}…'}
                      value={suiteBody}
                      onChange={(e) => setSuiteBody(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-border/80 bg-secondary/40 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs"
                      onClick={() => handleSendTest('email')}
                      disabled={
                        testing === 'email' ||
                        !suiteEmailAccount ||
                        !suiteSubject.trim() ||
                        !suiteBody.trim()
                      }
                    >
                      {testing === 'email' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Enviar teste para a minha caixa de entrada
                    </Button>
                  </div>
                )}
              </div>

              {/* WhatsApp */}
              <div
                className={`space-y-3 rounded-xl border p-4 transition ${
                  suiteChannels.has('whatsapp') ? 'border-emerald-400/60 bg-emerald-500/5' : 'border-border/80 bg-secondary/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleChannel('whatsapp')}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      suiteChannels.has('whatsapp') ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-muted-foreground'
                    }`}
                  >
                    {suiteChannels.has('whatsapp') && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                  <MessageCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-bold text-foreground">WhatsApp</span>
                </button>
                {suiteChannels.has('whatsapp') && (
                  <div className="space-y-2.5">
                    <select
                      value={suiteWaAccount}
                      onChange={(e) => setSuiteWaAccount(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/80 bg-background/50 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
                    >
                      <option value="">Conta conectada…</option>
                      {connectedWaAccounts.length === 0 && <option value="" disabled>— conecte um número em WhatsApp —</option>}
                      {connectedWaAccounts.map((acct) => (
                        <option key={acct.id} value={acct.id}>
                          {acct.phoneNumber || acct.sessionName}
                        </option>
                      ))}
                    </select>
                    <textarea
                      placeholder={'Mensagem…\n\nOlá {{firstName}}, tudo bem? Sou da…'}
                      value={suiteWaMessage}
                      onChange={(e) => setSuiteWaMessage(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-border/80 bg-secondary/40 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        placeholder="Nº p/ teste — 11 99999-8888"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="bg-secondary/40 text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-2 text-xs"
                        onClick={() => handleSendTest('whatsapp')}
                        disabled={testing === 'whatsapp' || !suiteWaAccount || !suiteWaMessage.trim() || !testPhone.trim()}
                      >
                        {testing === 'whatsapp' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Testar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Preview + placeholders */}
            {(suiteBody.trim() || suiteWaMessage.trim()) && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {suiteChannels.has('email') && suiteBody.trim() && (
                  <div className="rounded-xl border border-border/80 bg-background/40 p-3 text-xs">
                    <p className="mb-1 flex items-center gap-1 font-bold text-muted-foreground">
                      <Eye className="h-3 w-3" /> Preview email
                    </p>
                    <p className="font-bold text-foreground">{renderPreview(suiteSubject) || '(sem assunto)'}</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{renderPreview(suiteBody)}</p>
                  </div>
                )}
                {suiteChannels.has('whatsapp') && suiteWaMessage.trim() && (
                  <div className="rounded-xl border border-border/80 bg-background/40 p-3 text-xs">
                    <p className="mb-1 flex items-center gap-1 font-bold text-muted-foreground">
                      <Eye className="h-3 w-3" /> Preview WhatsApp
                    </p>
                    <p className="whitespace-pre-wrap text-foreground">{renderPreview(suiteWaMessage)}</p>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Variáveis disponíveis: <span className="font-mono">{'{{firstName}}'}</span>{' '}
              <span className="font-mono">{'{{companyName}}'}</span> <span className="font-mono">{'{{jobTitle}}'}</span>{' '}
              <span className="font-mono">{'{{city}}'}</span> <span className="font-mono">{'{{industry}}'}</span> — preenchidas com os dados do enriquecimento.
            </p>

            <Button type="submit" variant="gradient" className="w-full gap-2 text-xs" disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar suíte {suiteAuto ? 'com disparo automático' : '(manual)'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Campaigns list */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base font-bold">Campanhas ({campaigns.length})</CardTitle>
          <CardDescription>Suítes configuradas na sua organização</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando campanhas…
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma campanha ainda. Crie a primeira acima.</p>
          ) : (
            campaigns.map((campaign) => {
              const meta = STATUS_META[campaign.status] || { label: campaign.status, variant: 'outline' as const };
              const channels = Array.isArray(campaign.channels) ? campaign.channels : [];
              const isAuto = campaign.trigger === 'on_enrichment';
              return (
                <div
                  key={campaign.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-secondary/30 p-4 md:flex-row md:items-center"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Send className="h-4 w-4 text-indigo-400" />
                      <h4 className="text-sm font-bold text-foreground">{campaign.name}</h4>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {campaign.needsReview && (
                        <Badge variant="destructive" title={campaign.reviewReason || undefined}>
                          Revisão necessária
                        </Badge>
                      )}
                      {channels.includes('email') && (
                        <Badge variant="outline" className="gap-1">
                          <Mail className="h-3 w-3" /> Email
                        </Badge>
                      )}
                      {channels.includes('whatsapp') && (
                        <Badge variant="outline" className="gap-1">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </Badge>
                      )}
                      {isAuto && (
                        <button
                          type="button"
                          onClick={() => handleToggleAuto(campaign)}
                          disabled={toggling === campaign.id}
                          title={campaign.autoActive ? 'Desativar disparo automático' : 'Ativar disparo automático'}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black transition ${
                            campaign.autoActive
                              ? 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25'
                              : 'bg-muted-foreground/15 text-muted-foreground hover:bg-muted-foreground/25'
                          }`}
                        >
                          {toggling === campaign.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Zap className={`h-3 w-3 ${campaign.autoActive ? 'fill-emerald-400' : ''}`} />
                          )}
                          {campaign.autoActive ? 'AUTO ATIVA' : 'auto off'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {campaign.description || 'Sem descrição'} · Criada em {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}
                      {isAuto && ' · Dispara quando o enriquecimento do lead termina'}
                    </p>
                  </div>
                  {campaign.needsReview ? (
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <p className="max-w-xs rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                        Retida: o template continha texto interno da plataforma.
                        Regerar usa o perfil comercial da sua organização.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await rederiveOutreachCampaign(campaign.id);
                            await loadAll();
                          } catch (err) {
                            console.error('Falha ao regerar template:', err);
                          }
                        }}
                        className="gap-2 self-start md:self-auto"
                      >
                        <RefreshCw className="h-4 w-4" /> Regerar template
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStartCampaignId(campaign.id);
                        setStartAccountId(campaign.emailAccountId || (connectedAccounts.length === 1 ? connectedAccounts[0].id : ''));
                      }}
                      className="gap-2 self-start md:self-auto"
                    >
                      <PlayCircleIcon /> Iniciar em leads
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

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
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-foreground">
                  Leads selecionados para esta campanha
                </span>
                <div className="flex items-center gap-2">
                  {enrolledInStartCampaign.size > 0 && (
                    <span
                      title="Leads que já receberam esta campanha ficam de fora — nunca reenviar o primeiro toque na mesma campanha."
                      className="text-[10px] font-semibold text-muted-foreground"
                    >
                      {enrolledInStartCampaign.size} já contatado(s) oculto(s)
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setSelectedIds(new Set(launchableProspects.map((p) => p.id)))}
                    disabled={launchableProspects.length > 0 && selectedIds.size === launchableProspects.length}
                  >
                    Selecionar todos
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-xs">
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
                {launchableProspects.map((prospect) => {
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
                        {prospect.cnpj || 'sem CNPJ'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {launchableProspects.length === 0 && prospects.length > 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Todos os leads já foram contatados nesta campanha — o primeiro toque não se repete.
                  Use outra campanha ou adicione leads novos em "Descobrir leads".
                </p>
              )}
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
