import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MapPin,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const segmentSuggestions = [
  'Agro e agronegócio',
  'Comércio e varejo',
  'Construção e reformas',
  'Educação e escolas',
  'Escritórios e advocacia',
  'Logística e transportes',
  'Saúde e clínicas',
  'Serviços automotivos',
  'Software e tecnologia',
  'Turismo e hospitalidade',
  'Alimentação e padarias',
  'Indústria e fábricas',
];

const locationSuggestions = [
  { city: 'São Paulo', state: 'SP' },
  { city: 'Rio de Janeiro', state: 'RJ' },
  { city: 'Belo Horizonte', state: 'MG' },
  { city: 'Curitiba', state: 'PR' },
  { city: 'Porto Alegre', state: 'RS' },
  { city: 'Fortaleza', state: 'CE' },
  { city: 'Recife', state: 'PE' },
  { city: 'Salvador', state: 'BA' },
  { city: 'Brasília', state: 'DF' },
  { city: 'Campinas', state: 'SP' },
];

const cnaeSuggestions = [
  'Comércio varejista de mercadorias em geral',
  'Transporte rodoviário de carga',
  'Serviços médicos e odontológicos',
  'Administração de imóveis',
  'Restaurantes e serviços de alimentação',
  'Construção de edifícios',
  'Atividades de consultoria',
  'Ensino e educação',
];

const statusOptions = [
  { value: 'active', label: 'Ativas', icon: TrendingUp, helper: 'Empresas em pleno funcionamento' },
  { value: 'new', label: 'Abertas recentemente', icon: Sparkles, helper: 'Novas oportunidades de mercado' },
  { value: 'inactive', label: 'Baixadas ou inativas', icon: CalendarClock, helper: 'Eventual retomada ou recuperação' },
];

const sizeOptions = [
  { value: 'small', label: 'Pequenas', icon: Building2, helper: 'Até 49 funcionários' },
  { value: 'medium', label: 'Médias', icon: Building2, helper: 'Entre 50 e 249 funcionários' },
  { value: 'large', label: 'Grandes', icon: Building2, helper: '250 ou mais funcionários' },
];

const ageOptions = [
  { value: 'new', label: 'Até 2 anos', icon: Clock3, helper: 'Engrenagens em formação' },
  { value: 'growing', label: '2 a 10 anos', icon: TrendingUp, helper: 'Crescimento acelerado' },
  { value: 'established', label: 'Mais de 10 anos', icon: CheckCircle2, helper: 'Empresas consolidadas' },
];

const salesCycleOptions = ['Até 30 dias', '30 a 90 dias', '90 a 180 dias', 'Mais de 180 dias'];

const stepTitles = ['Sua empresa', 'Mercado-alvo', 'Regiões', 'Perfil de empresa', 'Decisão comercial'];

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

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.06]'
      )}
    >
      {children}
    </button>
  );
}

function ToggleCard({
  active,
  onClick,
  label,
  helper,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  helper: string;
  Icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition',
        active
          ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-600/20 dark:bg-indigo-500/10'
          : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]'
      )}
    >
      <div
        className={cn(
          'rounded-xl p-2 transition',
          active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-black', active ? 'text-indigo-700 dark:text-indigo-200' : 'text-slate-900 dark:text-white')}>
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{helper}</p>
      </div>
      <div
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
          active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-transparent dark:border-white/20'
        )}
      >
        <Check className="h-3 w-3" />
      </div>
    </button>
  );
}

function TagEditor({
  placeholder,
  values,
  onChange,
}: {
  placeholder: string;
  values: string[];
  onChange: (items: string[]) => void;
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
    <div className="space-y-3">
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
          className="h-11 text-xs"
        />
        <Button type="button" variant="outline" onClick={addValues} className="h-11 gap-2 rounded-xl text-xs font-bold">
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
          <p className="text-xs text-slate-400">Nenhum item adicionado ainda.</p>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-left transition',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.06]'
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-black">{label}</p>
        {hint && <p className={cn('text-[11px]', active ? 'text-indigo-100' : 'text-slate-400')}>{hint}</p>}
      </div>
      {active ? <Check className="h-4 w-4 shrink-0 text-white" /> : <Plus className="h-4 w-4 shrink-0 text-slate-400" />}
    </button>
  );
}

export function OnboardingModal({
  profile,
  onSave,
  isSaving,
}: {
  profile: CommercialProfile | null;
  onSave: (profile: CommercialProfile) => Promise<void> | void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<CommercialProfile>(() => normalizeProfile(profile));
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [savingError, setSavingError] = useState('');

  useEffect(() => {
    setForm(normalizeProfile(profile));
  }, [profile]);

  const update = <K extends keyof CommercialProfile>(key: K, value: CommercialProfile[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const progress = Math.round(((step + 1) / stepTitles.length) * 100);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(form.companyName.trim());
      case 1:
        return form.targetSegments.length > 0 || form.targetCnaes.length > 0;
      case 2:
        return form.targetLocations.length > 0;
      case 3:
        return form.companyStatuses.length > 0;
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, form]);

  const toggleSegment = (segment: string) => {
    const next = form.targetSegments.includes(segment)
      ? form.targetSegments.filter((item) => item !== segment)
      : [...form.targetSegments, segment];
    update('targetSegments', next);
  };

  const toggleLocation = (city: string, state: string) => {
    const key = `${city} (${state})`;
    const next = form.targetLocations.includes(key)
      ? form.targetLocations.filter((item) => item !== key)
      : [...form.targetLocations, key];
    update('targetLocations', next);
  };

  const goNext = () => {
    setError('');
    if (!stepValid) return;
    if (step < stepTitles.length - 1) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const goBack = () => {
    setError('');
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = async () => {
    setSavingError('');
    if (!form.companyName.trim()) {
      setError('Informe o nome da empresa para personalizar as recomendações.');
      setStep(0);
      return;
    }
    if (!form.targetSegments.length && !form.targetCnaes.length) {
      setError('Adicione ao menos um mercado de interesse.');
      setStep(1);
      return;
    }
    if (!form.targetLocations.length) {
      setError('Escolha ao menos uma região para prospectar.');
      setStep(2);
      return;
    }
    try {
      await onSave({ ...form, onboardingCompleted: true });
    } catch {
      setSavingError('Não foi possível concluir a configuração. Tente novamente.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      {/* Brand mark */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_at_top_right,rgba(79,70,229,0.12),transparent_45%),radial-gradient(50rem_at_bottom_left,rgba(16,185,129,0.10),transparent_45%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-black text-white shadow-sm">
              S
            </div>
            <div>
              <p className="text-sm font-black leading-none text-slate-900 dark:text-white">SalesIntel</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">Configuração da sua conta</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Etapa {step + 1} de {stepTitles.length}
            </span>
            <div className="flex w-16 items-center gap-1 sm:w-28">
              {stepTitles.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors duration-300',
                    index <= step ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/10'
                  )}
                />
              ))}
            </div>
          </div>
        </header>

        {/* Step card */}
        <div className="flex-1">
          <div
            key={step}
            className="animate-fadeIn rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/30 sm:p-8"
          >
            {/* Step heading */}
            <div className="mb-6">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
                {step + 1}. {stepTitles[step]}
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {[
                  'Primeiro, conte sobre sua empresa',
                  'Para quem você quer vender?',
                  'Onde seu time vai prospectar?',
                  'Que tipo de empresa merece prioridade?',
                  'Resumo e decisão comercial',
                ][step]}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {[
                  'Comece pelo essencial. Você poderá ajustar tudo depois em Preferências.',
                  'Escolha os mercados que fazem sentido para o seu negócio ou adicione os seus.',
                  'Defina as regiões prioritárias para concentrar a prospecção.',
                  'Selecione os perfis de empresa que melhor se encaixam no seu alvo.',
                  'Ajuste os critérios comerciais e conclua a configuração.',
                ][step]}
              </p>
            </div>

            {/* Step content */}
            {step === 0 && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Nome da sua empresa</label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      autoFocus
                      value={form.companyName}
                      onChange={(event) => update('companyName', event.target.value)}
                      placeholder="Como sua empresa deve aparecer"
                      className="h-12 pl-10 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Tamanho do time comercial</label>
                  <div className="relative">
                    <Users className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={form.salesTeamSize}
                      onChange={(event) => update('salesTeamSize', event.target.value)}
                      placeholder="Quantidade de vendedores (ex.: 5, 10 a 30)"
                      className="h-12 pl-10 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-sm font-black text-slate-900 dark:text-white">Mercados sugeridos</p>
                    <Badge variant="outline" className="rounded-full text-[11px]">
                      {form.targetSegments.length} {form.targetSegments.length === 1 ? 'selecionado' : 'selecionados'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {segmentSuggestions.map((segment) => (
                      <SuggestionCard
                        key={segment}
                        label={segment}
                        active={form.targetSegments.includes(segment)}
                        onClick={() => toggleSegment(segment)}
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-5 dark:border-white/10">
                  <p className="mb-2.5 text-sm font-black text-slate-900 dark:text-white">Adicione outros mercados</p>
                  <TagEditor
                    placeholder="Digite segmentos ou nichos separados por vírgula"
                    values={form.targetSegments}
                    onChange={(items) => update('targetSegments', items)}
                  />
                </div>
                <div className="border-t border-slate-100 pt-5 dark:border-white/10">
                  <p className="mb-2.5 text-sm font-black text-slate-900 dark:text-white">Atividades de interesse (CNAE)</p>
                  <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Informe atividades quando já souber quais deseja priorizar.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {cnaeSuggestions.map((cnae) => (
                      <SuggestionCard
                        key={cnae}
                        label={cnae}
                        active={form.targetCnaes.includes(cnae)}
                        onClick={() => {
                          const next = form.targetCnaes.includes(cnae)
                            ? form.targetCnaes.filter((item) => item !== cnae)
                            : [...form.targetCnaes, cnae];
                          update('targetCnaes', next);
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-3">
                    <TagEditor
                      placeholder="Digite uma atividade ou código"
                      values={form.targetCnaes}
                      onChange={(items) => update('targetCnaes', items)}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-sm font-black text-slate-900 dark:text-white">Regiões sugeridas</p>
                    <Badge variant="outline" className="rounded-full text-[11px]">
                      {form.targetLocations.length} {form.targetLocations.length === 1 ? 'região' : 'regiões'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {locationSuggestions.map((loc) => {
                      const key = `${loc.city} (${loc.state})`;
                      return (
                        <SuggestionCard
                          key={key}
                          label={loc.city}
                          hint={loc.state}
                          active={form.targetLocations.includes(key)}
                          onClick={() => toggleLocation(loc.city, loc.state)}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-5 dark:border-white/10">
                  <p className="mb-2.5 flex items-center gap-1.5 text-sm font-black text-slate-900 dark:text-white">
                    <MapPin className="h-4 w-4 text-indigo-500" /> Adicione outras regiões
                  </p>
                  <TagEditor
                    placeholder="Estado, cidade, região ou bairro"
                    values={form.targetLocations}
                    onChange={(items) => update('targetLocations', items)}
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <p className="mb-2.5 text-sm font-black text-slate-900 dark:text-white">Situação da empresa</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {statusOptions.map((option) => {
                      const active = form.companyStatuses.includes(option.value);
                      return (
                        <ToggleCard
                          key={option.value}
                          active={active}
                          label={option.label}
                          helper={option.helper}
                          Icon={option.icon}
                          onClick={() => {
                            const next = active
                              ? form.companyStatuses.filter((item) => item !== option.value)
                              : [...form.companyStatuses, option.value];
                            update('companyStatuses', next);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2.5 text-sm font-black text-slate-900 dark:text-white">Porte desejado</p>
                  <div className="flex flex-wrap gap-2">
                    {sizeOptions.map((option) => (
                      <ToggleChip
                        key={option.value}
                        active={form.targetSizes.includes(option.value)}
                        onClick={() => {
                          const next = form.targetSizes.includes(option.value)
                            ? form.targetSizes.filter((item) => item !== option.value)
                            : [...form.targetSizes, option.value];
                          update('targetSizes', next);
                        }}
                      >
                        <Building2 className="h-3.5 w-3.5" /> {option.label}
                      </ToggleChip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2.5 text-sm font-black text-slate-900 dark:text-white">Tempo de atividade</p>
                  <div className="flex flex-wrap gap-2">
                    {ageOptions.map((option) => (
                      <ToggleChip
                        key={option.value}
                        active={form.ageRanges.includes(option.value)}
                        onClick={() => {
                          const next = form.ageRanges.includes(option.value)
                            ? form.ageRanges.filter((item) => item !== option.value)
                            : [...form.ageRanges, option.value];
                          update('ageRanges', next);
                        }}
                      >
                        <Clock3 className="h-3.5 w-3.5" /> {option.label}
                      </ToggleChip>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <CircleDollarSign className="h-4 w-4 text-indigo-500" /> Ticket médio desejado
                    </label>
                    <div className="relative">
                      <Input
                        type="number"
                        min="0"
                        value={form.averageTicket ?? ''}
                        onChange={(event) => update('averageTicket', event.target.value ? Number(event.target.value) : null)}
                        placeholder="Valor em R$"
                        className="h-12 pl-4 pr-14 text-sm"
                      />
                      {form.averageTicket ? (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                          {formatCurrency(form.averageTicket)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                      <Clock3 className="h-4 w-4 text-indigo-500" /> Ciclo de venda
                    </label>
                    <select
                      value={form.salesCycle}
                      onChange={(event) => update('salesCycle', event.target.value)}
                      className="h-12 w-full rounded-lg border border-border/80 bg-background/50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-100"
                    >
                      <option value="">Selecionar</option>
                      {salesCycleOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                    <Target className="h-4 w-4 text-indigo-500" /> Promessa comercial
                  </label>
                  <Input
                    value={form.valueProposition}
                    onChange={(event) => update('valueProposition', event.target.value)}
                    placeholder="O resultado que sua solução entrega"
                    className="h-12 text-sm"
                  />
                </div>

                {/* Review */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.03]">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Revisão da configuração
                  </p>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] font-bold text-slate-400">Empresa</dt>
                      <dd className="text-sm font-black text-slate-900 dark:text-white">{form.companyName || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-bold text-slate-400">Mercados</dt>
                      <dd className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {form.targetSegments.length || form.targetCnaes.length ? `${form.targetSegments.length + form.targetCnaes.length} selecionados` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-bold text-slate-400">Regiões</dt>
                      <dd className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {form.targetLocations.length ? `${form.targetLocations.length} definidas` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-bold text-slate-400">Situação / porte</dt>
                      <dd className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {form.companyStatuses.length ? `${form.companyStatuses.length} situação(ões)` : '—'}
                        {form.targetSizes.length ? ` · ${form.targetSizes.length} porte(s)` : ''}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-700">
                {error}
              </p>
            )}
            {savingError && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
                {savingError}
              </p>
            )}
          </div>
        </div>

        {/* Footer navigation */}
        <footer className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={goBack} className="h-11 gap-2 rounded-xl px-4 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <span className={cn('text-xs font-bold', stepValid ? 'text-slate-400' : 'text-amber-500')}>
              {stepValid ? 'Pronto para continuar' : 'Complete os campos acima'}
            </span>
            <Button
              type="button"
              onClick={goNext}
              disabled={isSaving || !stepValid}
              className="h-11 gap-2 rounded-xl bg-slate-950 px-6 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {step < stepTitles.length - 1 ? (
                <>
                  Continuar <ArrowRight className="h-4 w-4" />
                </>
              ) : isSaving ? (
                'Concluindo...'
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Concluir configuração
                </>
              )}
            </Button>
          </div>
        </footer>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500">
          <ChevronRight className="h-3 w-3 rotate-90" />
          Você pode revisar e ajustar tudo depois em <span className="font-bold text-slate-500 dark:text-slate-400">Preferências comerciais</span>.
        </p>
      </div>
    </div>
  );
}

export { EMPTY_PROFILE };
