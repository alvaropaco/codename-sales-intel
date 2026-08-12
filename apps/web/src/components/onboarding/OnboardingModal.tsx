import React from 'react';
import { ArrowRight, CheckCircle2, Sparkles, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CommercialProfile } from '@/types';
import { CommercialProfileForm } from '@/components/settings/CommercialProfileForm';

export function OnboardingModal({
  profile,
  onSave,
  isSaving,
}: {
  profile: CommercialProfile | null;
  onSave: (profile: CommercialProfile) => Promise<void> | void;
  isSaving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl animate-fadeIn rounded-[2rem] border border-slate-200 bg-slate-50 shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <section className="relative overflow-hidden rounded-t-[2rem] border-b border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-950">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.16),transparent_35%)]" />
          <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div className="space-y-4">
              <Badge variant="outline" className="w-fit border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Boas-vindas à SalesIntel
              </Badge>
              <div>
                <h1 className="max-w-3xl text-3xl font-black tracking-tight text-slate-950 dark:text-white md:text-5xl">
                  Configure seu perfil comercial para descobrir empresas com potencial de compra.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  A plataforma usa estes critérios para orientar a descoberta de oportunidades, priorizar contatos e manter a experiência alinhada ao seu mercado.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">O que será definido</p>
              <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Segmentos, nichos e CNAEs prioritários</div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Regiões onde seu time quer vender</div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Porte, situação e tempo de atividade ideais</div>
                <div className="flex items-center gap-2"><Target className="h-4 w-4 text-indigo-500" /> Critérios comerciais para priorização</div>
              </div>
              <Button type="button" variant="outline" className="mt-5 h-10 w-full gap-2 rounded-xl text-xs font-bold" onClick={() => document.getElementById('commercial-profile-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Começar configuração <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </section>

        <div id="commercial-profile-form" className="p-4 sm:p-6">
          <CommercialProfileForm profile={profile} onSave={onSave} isSaving={isSaving} mode="onboarding" />
        </div>
      </div>
    </div>
  );
}
