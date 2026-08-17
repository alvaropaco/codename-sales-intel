import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Compass, Settings, Sparkles, Mail, ExternalLink, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CommercialProfile, EmailAccount } from '@/types';
import { CommercialProfileForm } from '@/components/settings/CommercialProfileForm';
import { fetchGmailAuthUrl, fetchGmailAccounts, disconnectGmailAccount } from '@/services/api';

export function SettingsView({
  profile,
  onSave,
  isSaving,
}: {
  profile: CommercialProfile | null;
  onSave: (profile: CommercialProfile) => Promise<void> | void;
  isSaving: boolean;
}) {
  const completed = Boolean(profile?.onboardingCompleted);
  const segmentCount = (profile?.targetSegments?.length || 0) + (profile?.targetCnaes?.length || 0);
  const locationCount = profile?.targetLocations?.length || 0;

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const loadAccounts = async () => {
    setAccounts(await fetchGmailAccounts());
  };

  useEffect(() => {
    loadAccounts();
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_connected')) {
      setGmailNotice(`Gmail conectado: ${params.get('gmail_connected')}`);
    } else if (params.get('gmail_error')) {
      setGmailNotice('Não foi possível conectar a conta do Gmail.');
    }
  }, []);

  const connectedAccounts = accounts.filter((a) => a.status === 'connected');

  const handleConnectGmail = async () => {
    setConnecting(true);
    setGmailNotice(null);
    try {
      const url = await fetchGmailAuthUrl();
      window.location.href = url;
    } catch (err) {
      setGmailNotice(err instanceof Error ? err.message : 'Erro ao conectar o Gmail');
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Desconectar esta conta do Gmail?')) return;
    await disconnectGmailAccount(id);
    await loadAccounts();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Settings className="mr-1.5 h-3.5 w-3.5" /> Preferências comerciais
            </Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white md:text-4xl">
              Ajuste como a SalesIntel encontra oportunidades para o seu time.
            </h1>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Essas preferências orientam a descoberta de leads, os filtros principais e a priorização comercial. Você pode alterar tudo quando o perfil de cliente ideal mudar.
            </p>
          </div>
          <Badge variant={completed ? 'qualified' : 'outline'} className="w-fit rounded-full px-4 py-2 text-xs font-black">
            {completed ? 'Configuração concluída' : 'Configuração pendente'}
          </Badge>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Foco de mercado</p>
              <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{segmentCount}</p>
              <p className="mt-1 text-xs text-slate-500">segmentos ou CNAEs</p>
            </div>
            <Compass className="h-8 w-8 text-indigo-500" />
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Regiões</p>
              <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{locationCount}</p>
              <p className="mt-1 text-xs text-slate-500">prioridades comerciais</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Ciclo de venda</p>
              <p className="mt-2 text-lg font-black text-slate-950 dark:text-white">{profile?.salesCycle || 'A definir'}</p>
              <p className="mt-1 text-xs text-slate-500">usado para priorização</p>
            </div>
            <Clock3 className="h-8 w-8 text-amber-500" />
          </CardContent>
        </Card>
      </section>

      {/* Gmail connection */}
      <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-red-500/10 p-2 text-red-500">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Envio de outreach (Gmail)</CardTitle>
                <CardDescription>Conecte a conta que enviará as campanhas de e-mail</CardDescription>
              </div>
            </div>
            <Button variant="gradient" size="sm" onClick={handleConnectGmail} disabled={connecting} className="gap-2">
              <ExternalLink className="h-4 w-4" /> {connectedAccounts.length > 0 ? 'Conectar outra conta' : 'Conectar Gmail'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {gmailNotice && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              {gmailNotice}
            </div>
          )}
          {connectedAccounts.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
              <Inbox className="mt-0.5 h-5 w-5 shrink-0" />
              <p>Nenhuma conta conectada. Conecte o Gmail para habilitar as campanhas de outreach em "Outreach".</p>
            </div>
          ) : (
            connectedAccounts.map((acct) => (
              <div key={acct.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-sm font-black text-red-500">
                    {acct.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-950 dark:text-white">{acct.email}</p>
                    <p className="text-xs text-slate-500">Status: {acct.status}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDisconnect(acct.id)} className="text-red-500">
                  Desconectar
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="rounded-[1.5rem] border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-100">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Quanto mais específico for o perfil, melhores serão as recomendações de leads. Priorize nichos, regiões e características que realmente indicam chance de compra.
          </p>
        </div>
      </div>

      <CommercialProfileForm profile={profile} onSave={onSave} isSaving={isSaving} />
    </div>
  );
}
