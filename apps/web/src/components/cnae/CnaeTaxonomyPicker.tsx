import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CnaeAtividade, CnaeCategoria, CnaeRamo } from '@/types';
import { cnaeLabel, searchCnaeTaxonomy } from '@/data/cnaeTaxonomy';
import { cn } from '@/lib/utils';

interface CnaeTaxonomyPickerProps {
  segments: string[];
  cnaes: string[];
  onSegmentsChange: (items: string[]) => void;
  onCnaesChange: (items: string[]) => void;
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
        checked
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-slate-300 bg-white hover:border-indigo-400 dark:border-white/25 dark:bg-white/5',
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
}

export function CnaeTaxonomyPicker({
  segments,
  cnaes,
  onSegmentsChange,
  onCnaesChange,
}: CnaeTaxonomyPickerProps) {
  const [query, setQuery] = useState('');
  const [expandedRamos, setExpandedRamos] = useState<Set<string>>(new Set());
  const [expandedCategorias, setExpandedCategorias] = useState<Set<string>>(new Set());

  const results = useMemo(() => searchCnaeTaxonomy(query), [query]);

  const toggleIn = (list: string[], item: string, onChange: (items: string[]) => void) => {
    if (list.includes(item)) {
      onChange(list.filter((current) => current !== item));
    } else {
      onChange([...list, item]);
    }
  };

  const toggleRamo = (ramo: CnaeRamo) => {
    toggleIn(segments, ramo.nome, onSegmentsChange);
  };

  const toggleCategoria = (categoria: CnaeCategoria) => {
    toggleIn(segments, categoria.nome, onSegmentsChange);
  };

  const toggleAtividade = (atividade: CnaeAtividade) => {
    toggleIn(cnaes, atividade.codigo, onCnaesChange);
  };

  const toggleRamoExpanded = (secao: string) => {
    setExpandedRamos((current) => {
      const next = new Set(current);
      if (next.has(secao)) next.delete(secao);
      else next.add(secao);
      return next;
    });
  };

  const toggleCategoriaExpanded = (key: string) => {
    setExpandedCategorias((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Busque por ramo, categoria, atividade ou código CNAE"
          className="h-10 pl-9 pr-8 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="rounded-full text-[11px]">
          {segments.length} {segments.length === 1 ? 'mercado' : 'mercados'}
        </Badge>
        <Badge variant="outline" className="rounded-full text-[11px]">
          {cnaes.length} {cnaes.length === 1 ? 'CNAE' : 'CNAEs'}
        </Badge>
      </div>

      <div className="max-h-[26rem] space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/[0.03]">
        {results.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-400">Nenhum resultado para “{query}”.</p>
        ) : (
          results.map(({ ramo, categorias }) => {
            const ramoExpanded = isSearching || expandedRamos.has(ramo.secao);
            const ramoSelected = segments.includes(ramo.nome);
            const ramoCnaeCount = categorias.reduce((s, c) => s + c.atividades.length, 0);

            return (
              <div key={ramo.secao} className="rounded-xl">
                <div className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.04]">
                  <Checkbox
                    checked={ramoSelected}
                    onChange={() => toggleRamo(ramo)}
                    label={`Selecionar ramo ${ramo.nome}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleRamoExpanded(ramo.secao)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {ramoExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                    <span className="truncate text-xs font-black text-slate-800 dark:text-slate-100">{ramo.nome}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                      {ramoCnaeCount} CNAEs
                    </span>
                  </button>
                </div>

                {ramoExpanded && (
                  <div className="ml-4 space-y-0.5 border-l border-slate-100 pl-2 dark:border-white/10">
                    {categorias.map((categoria) => {
                      const categoriaKey = `${ramo.secao}:${categoria.divisao}`;
                      const categoriaExpanded = isSearching || expandedCategorias.has(categoriaKey);
                      const categoriaSelected = segments.includes(categoria.nome);

                      return (
                        <div key={categoriaKey} className="rounded-lg">
                          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/[0.04]">
                            <Checkbox
                              checked={categoriaSelected}
                              onChange={() => toggleCategoria(categoria)}
                              label={`Selecionar categoria ${categoria.nome}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleCategoriaExpanded(categoriaKey)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            >
                              {categoriaExpanded ? (
                                <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                              )}
                              <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {categoria.nome}
                              </span>
                              <span className="shrink-0 text-[10px] text-slate-400">{categoria.atividades.length}</span>
                            </button>
                          </div>

                          {categoriaExpanded && (
                            <div className="ml-4 space-y-0.5 border-l border-slate-100 pl-2 dark:border-white/10">
                              {categoria.atividades.map((atividade) => {
                                const selected = cnaes.includes(atividade.codigo);
                                return (
                                  <button
                                    key={atividade.codigo}
                                    type="button"
                                    onClick={() => toggleAtividade(atividade)}
                                    className={cn(
                                      'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                                      selected
                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200'
                                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                                        selected
                                          ? 'border-indigo-600 bg-indigo-600 text-white'
                                          : 'border-slate-300 dark:border-white/25',
                                      )}
                                    >
                                      {selected && <Check className="h-2.5 w-2.5" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-medium">{atividade.atividade}</span>
                                      <span className="block font-mono text-[10px] text-slate-400">{atividade.cnae}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Selected summary */}
      {(segments.length > 0 || cnaes.length > 0) && (
        <div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-500/20 dark:bg-indigo-500/5">
          <p className="text-[11px] font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Selecionados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {segments.map((item) => (
              <Badge key={item} variant="outline" className="gap-1 rounded-full bg-white text-xs dark:bg-white/10">
                {item}
                <button type="button" aria-label={`Remover ${item}`} onClick={() => onSegmentsChange(segments.filter((s) => s !== item))}>
                  <X className="h-3 w-3 text-slate-400 hover:text-rose-500" />
                </button>
              </Badge>
            ))}
            {cnaes.map((codigo) => (
              <Badge key={codigo} variant="outline" className="gap-1 rounded-full bg-white text-xs dark:bg-white/10">
                {cnaeLabel(codigo)}
                <button type="button" aria-label={`Remover ${codigo}`} onClick={() => onCnaesChange(cnaes.filter((c) => c !== codigo))}>
                  <X className="h-3 w-3 text-slate-400 hover:text-rose-500" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
