import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchLocations, Municipio } from '@/data/locationAutocomplete';
import { cn } from '@/lib/utils';

/**
 * Editor de "Regiões prioritárias" com autocomplete de municípios (IBGE).
 *
 * O valor armazenado continua sendo uma string legível no formato
 * "Cidade, UF" (ex.: "São Paulo, SP"), que o servidor já sabe interpretar.
 * O autocomplete apenas guia o usuário para o nome canônico do município,
 * garantindo acentuação e UF consistentes sem quebrar os filtros existentes.
 */
export function LocationTagEditor({
  label,
  helper,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  helper: string;
  placeholder: string;
  values: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo<Municipio[]>(() => {
    const q = draft.trim();
    if (!q) return [];
    return searchLocations(q, 8);
  }, [draft]);

  useEffect(() => {
    setHighlighted(0);
  }, [matches]);

  // Close on outside click.
  useEffect(() => {
    if (!focused) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [focused]);

  const addValue = (raw: string) => {
    const item = raw.trim();
    if (!item) return;
    if (values.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
      setDraft('');
      setFocused(false);
      return;
    }
    onChange([...values, item]);
    setDraft('');
    setFocused(false);
  };

  const addDraftAsValues = () => {
    const nextValues = draft
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !values.some((existing) => existing.toLowerCase() === item.toLowerCase()));

    if (nextValues.length) {
      onChange([...values, ...nextValues]);
    }
    setDraft('');
    setFocused(false);
  };

  const selectMatch = (m: Municipio) => {
    addValue(m.label);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (focused && matches.length && highlighted >= 0 && highlighted < matches.length) {
        selectMatch(matches[highlighted]);
      } else {
        addDraftAsValues();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocused(true);
      setHighlighted((current) => (matches.length ? (current + 1) % matches.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => (matches.length ? (current - 1 + matches.length) % matches.length : 0));
      return;
    }
    if (event.key === 'Escape') {
      setFocused(false);
    }
  };

  const showDropdown = focused && draft.trim().length > 0 && matches.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <MapPin className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-white">{label}</p>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{helper}</p>
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="h-10 text-xs"
          />
          <Button type="button" variant="outline" onClick={addDraftAsValues} className="h-10 gap-2 rounded-xl text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900">
            {matches.map((m, index) => (
              <button
                key={m.code}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => selectMatch(m)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition dark:text-slate-200',
                  index === highlighted ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                )}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>{m.label}</span>
                <span className="ml-auto text-[10px] font-medium text-slate-400">{m.code}</span>
              </button>
            ))}
            <p className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 dark:border-white/10">
              Municípios do IBGE · pressione Enter para usar o que está digitado
            </p>
          </div>
        )}
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
