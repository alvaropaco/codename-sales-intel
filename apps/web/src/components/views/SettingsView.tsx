import React from 'react';
import { CheckCircle2, Clock3, Compass, Settings, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CommercialProfile } from '@/types';
import { CommercialProfileForm } from '@/components/settings/CommercialProfileForm';

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
              Essas preferências orientam a descoberta de empresas, os filtros principais e a priorização comercial. Você pode alterar tudo quando o perfil de cliente ideal mudar.
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

      <div className="rounded-[1.5rem] border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-100">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Quanto mais específico for o perfil, melhores serão as recomendações de empresas. Priorize nichos, regiões e características que realmente indicam chance de compra.
          </p>
        </div>
      </div>

      <CommercialProfileForm profile={profile} onSave={onSave} isSaving={isSaving} />
    </div>
  );
}
