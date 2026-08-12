import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MapPin, Plus, Sparkles, Target, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CommercialProfile } from '@/types';
import { cn, formatCurrency } from '@/lib/utils';

const EMPTY_PROFILE: CommercialProfile = {
  onboardingCompleted: false,
  companyName: '',
  salesTeamSize: '',
  targetSegments: [],
  targetCnaes: [],
  targetLocations: [],
  companyStatuses: ['active'],
  targetSizes: [],
  ageRanges: [],
  averageTicket: null,
  salesCycle: '',
  valueProposition: '',
};

const statusOptions = [
  { value: 'active', label: 'Ativas' },
  { value: 'inactive', label: 'Baixadas ou inativas' },
  { value: 'new', label: 'Abertas recentemente' },
];

const sizeOptions = [
  { value: 'small', label: 'Pequenas' },
  { value: 'medium', label: 'Médias' },
  { value: 'large', label: 'Grandes' },
];

const ageOptions = [
  { value: 'new', label: 'Até 2 anos' },
  { value: 'growing', label: '2 a 10 anos' },
  { value: 'established', label: 'Mais de 10 anos' },
];

const salesCycleOptions = ['Até 30 dias', '30 a 90 dias', '90 a 180 dias', 'Mais de 180 dias'];

function normalizeProfile(profile?: CommercialProfile | null): CommercialProfile {
  return {
    ...EMPTY_PROFILE,
    ...(profile || {}),
    targetSegments: profile?.targetSegments || [],
    targetCnaes: profile?.targetCnaes || [],
    targetLocations: profile?.targetLocations || [],
    companyStatuses: profile?.companyStatuses?.length ? profile.companyStatuses : ['active'],
    targetSizes: profile?.targetSizes || [],
    ageRanges: profile?.ageRanges || [],
  };
}

function ToggleGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (items: string[]) => void;
}) {
  const toggle = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((current) => current !== item));
    } else {
      onChange([...value, item]);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-bold transition',
                active
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagEditor({
  label,
  helper,
  placeholder,
  values,
  onChange,
  icon: Icon,
}: {
  label: string;
  helper: string;
  placeholder: string;
  values: string[];
  onChange: (items: string[]) => void;
  icon: React.ElementType;
}) {
  const [draft, setDraft] = useState('');

  const addValues = () => {
    const nextValues = draft
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !values.some((existing) => existing.toLowerCase() === item.toLowerCase()));

    if (nextValues.length) {
      onChange([...values, ...nextValues]);
      setDraft('');
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-white">{label}</p>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{helper}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValues();
            }
          }}
          placeholder={placeholder}
          className="h-10 text-xs"
        />
        <Button type="button" variant="outline" onClick={addValues} className="h-10 gap-2 rounded-xl text-xs font-bold">
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>

      <div className="flex min-h-9 flex-wrap gap-2">
        {values.length ? values.map((item) => (
          <Badge key={item} variant="outline" className="gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs dark:bg-white/[0.05]">
            {item}
            <button type="button" aria-label={`Remover ${item}`} onClick={() => onChange(values.filter((value) => value !== item))}>
              <Trash2 className="h-3 w-3 text-slate-400 hover:text-rose-500" />
            </button>
          </Badge>
        )) : (
          <p className="text-xs text-slate-400">Nenhum item definido ainda.</p>
        )}
      </div>
    </div>
  );
}

export function CommercialProfileForm({
  profile,
  onSave,
  isSaving = false,
  mode = 'settings',
}: {
  profile?: CommercialProfile | null;
  onSave: (profile: CommercialProfile) => Promise<void> | void;
  isSaving?: boolean;
  mode?: 'settings' | 'onboarding';
}) {
  const [form, setForm] = useState<CommercialProfile>(() => normalizeProfile(profile));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(normalizeProfile(profile));
  }, [profile]);

  const readiness = useMemo(() => {
    const checks = [
      Boolean(form.companyName.trim()),
      form.targetSegments.length > 0 || form.targetCnaes.length > 0,
      form.targetLocations.length > 0,
      form.companyStatuses.length > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form]);

  const update = <K extends keyof CommercialProfile>(key: K, value: CommercialProfile[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!form.companyName.trim()) {
      setError('Informe o nome da empresa para personalizar as recomendações.');
      return;
    }

    if (!form.targetSegments.length && !form.targetCnaes.length) {
      setError('Adicione ao menos um segmento, nicho ou CNAE de interesse.');
      return;
    }

    await onSave({ ...form, onboardingCompleted: true });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader className="border-b border-slate-100 dark:border-white/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base font-black">Perfil comercial</CardTitle>
              <CardDescription>Defina quem você vende, onde quer vender e quais empresas merecem prioridade.</CardDescription>
            </div>
            <Badge variant={readiness === 100 ? 'qualified' : 'outline'} className="w-fit rounded-full px-3 py-1.5 text-xs">
              {readiness}% preenchido
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Nome da sua empresa</label>
              <Input value={form.companyName} onChange={(event) => update('companyName', event.target.value)} placeholder="Como sua empresa deve aparecer" className="h-11 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Tamanho do time comercial</label>
              <Input value={form.salesTeamSize} onChange={(event) => update('salesTeamSize', event.target.value)} placeholder="Quantidade de vendedores ou faixas" className="h-11 text-xs" />
            </div>
          </div>

          <TagEditor
            label="Segmentos e nichos desejados"
            helper="Use a linguagem do vendedor: padaria, clínica, transportadora, escritório de advocacia, software."
            placeholder="Digite um ou mais segmentos separados por vírgula"
            values={form.targetSegments}
            onChange={(items) => update('targetSegments', items)}
            icon={Target}
          />

          <TagEditor
            label="CNAEs de interesse"
            helper="Informe códigos ou descrições quando já souber quais atividades quer priorizar."
            placeholder="Código ou descrição do CNAE"
            values={form.targetCnaes}
            onChange={(items) => update('targetCnaes', items)}
            icon={CheckCircle2}
          />

          <TagEditor
            label="Regiões prioritárias"
            helper="Inclua estados, cidades, regiões ou bairros onde o time quer prospectar."
            placeholder="Estado, cidade, região ou bairro"
            values={form.targetLocations}
            onChange={(items) => update('targetLocations', items)}
            icon={MapPin}
          />
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/70">
        <CardHeader className="border-b border-slate-100 dark:border-white/10">
          <CardTitle className="text-base font-black">Critérios de oportunidade</CardTitle>
          <CardDescription>Use critérios comerciais para priorizar empresas com maior chance de compra.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <ToggleGroup label="Situação da empresa" options={statusOptions} value={form.companyStatuses} onChange={(items) => update('companyStatuses', items)} />
          <ToggleGroup label="Porte desejado" options={sizeOptions} value={form.targetSizes} onChange={(items) => update('targetSizes', items)} />
          <ToggleGroup label="Tempo de atividade" options={ageOptions} value={form.ageRanges} onChange={(items) => update('ageRanges', items)} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Ticket médio desejado</label>
              <Input type="number" min="0" value={form.averageTicket ?? ''} onChange={(event) => update('averageTicket', event.target.value ? Number(event.target.value) : null)} placeholder="Valor em R$" className="h-11 text-xs" />
              {form.averageTicket ? <p className="text-[11px] text-slate-500">{formatCurrency(form.averageTicket)}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Ciclo de venda</label>
              <select value={form.salesCycle} onChange={(event) => update('salesCycle', event.target.value)} className="h-11 w-full rounded-lg border border-border/80 bg-background/50 px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-100">
                <option value="">Selecionar</option>
                {salesCycleOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-1">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Promessa comercial</label>
              <Input value={form.valueProposition} onChange={(event) => update('valueProposition', event.target.value)} placeholder="Resultado que sua solução entrega" className="h-11 text-xs" />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button type="submit" disabled={isSaving} className="h-11 gap-2 rounded-xl bg-slate-950 px-5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
          <Sparkles className="h-4 w-4" />
          {isSaving ? 'Salvando...' : mode === 'onboarding' ? 'Concluir configuração' : 'Salvar preferências'}
        </Button>
      </div>
    </form>
  );
}

export { EMPTY_PROFILE };
