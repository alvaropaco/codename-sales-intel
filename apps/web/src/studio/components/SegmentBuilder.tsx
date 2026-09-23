/**
 * SegmentBuilder — criação e preview de segmentos salvos (US2, T029).
 * v1: grupos de condições (AND/OR) sobre o catálogo fechado do backend;
 * preview com contagem e delta desde o último uso (FR-009).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createSegment,
  fetchSegments,
  previewSegment,
  previewNlSegment,
  StudioRequestError,
} from '../api';
import type { SegmentCriteria, SegmentPreview, StudioSegment } from '../api';

// Catálogo espelhado do backend (segment-service FIELD_CATALOG).
const FIELDS: Record<string, { label: string; ops: string[]; type: 'text' | 'number' }> = {
  industry: { label: 'Setor', ops: ['contains', 'equals'], type: 'text' },
  city: { label: 'Cidade', ops: ['contains', 'equals'], type: 'text' },
  state: { label: 'Estado (UF)', ops: ['equals', 'in'], type: 'text' },
  region: { label: 'Região', ops: ['equals', 'in'], type: 'text' },
  revenueEstimate: { label: 'Faturamento estimado', ops: ['gte', 'lte'], type: 'number' },
  employees: { label: 'Funcionários', ops: ['gte', 'lte'], type: 'number' },
  opportunityScore: { label: 'Score de oportunidade', ops: ['gte', 'lte'], type: 'number' },
  verdict: { label: 'Veredito da análise', ops: ['equals', 'in'], type: 'text' },
  status: { label: 'Status do lead', ops: ['equals', 'in'], type: 'text' },
  creditRiskScore: { label: 'Score de crédito', ops: ['gte', 'lte'], type: 'number' },
};

const OP_LABEL: Record<string, string> = {
  contains: 'contém',
  equals: 'é igual a',
  in: 'está em (separe por vírgula)',
  gte: 'maior ou igual a',
  lte: 'menor ou igual a',
};

interface DraftCondition {
  field: string;
  op: string;
  value: string;
}

function parseValue(draft: DraftCondition): unknown {
  const field = FIELDS[draft.field];
  if (draft.op === 'in') {
    return draft.value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (field?.type === 'number') return Number(draft.value);
  return draft.value;
}

export interface SegmentBuilderProps {
  onUseInCampaign?: (segment: StudioSegment, preview: SegmentPreview | null) => void;
}

export function SegmentBuilder({ onUseInCampaign }: SegmentBuilderProps) {
  const [segments, setSegments] = useState<StudioSegment[]>([]);
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<DraftCondition[]>([
    { field: 'opportunityScore', op: 'gte', value: '70' },
  ]);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void fetchSegments().then(setSegments).catch(() => setSegments([]));
  }, []);
  useEffect(load, [load]);

  const buildCriteria = (): SegmentCriteria => ({
    version: 1,
    groups: [
      {
        op: 'AND',
        conditions: drafts
          .filter((d) => d.field && d.op && d.value !== '')
          .map((d) => ({ field: d.field, op: d.op, value: parseValue(d) })),
      },
    ],
  });

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const segment = await createSegment({
        name: name.trim() || `Segmento ${new Date().toLocaleDateString('pt-BR')}`,
        criteria: buildCriteria(),
      });
      setName('');
      load();
      const pv = await previewSegment(segment.id).catch(() => null);
      setPreview(pv);
      onUseInCampaign?.(segment, pv);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao salvar segmento');
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async (segmentId: string) => {
    setError(null);
    try {
      const pv = await previewSegment(segmentId);
      setPreview(pv);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha no preview');
    }
  };

  const handleNl = async () => {
    setNlBusy(true);
    setError(null);
    try {
      const result = await previewNlSegment(nlPrompt);
      // Converte critérios NL em rascunhos editáveis dos filtros.
      const conds = (result.criteria.groups || []).flatMap((g) => g.conditions);
      setDrafts(
        conds.map((c) => ({
          field: String(c.field),
          op: String(c.op),
          value: Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? ''),
        }))
      );
      setNotice(result.rationale);
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao interpretar o pedido');
    } finally {
      setNlBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Descreva o público em linguagem natural (IA traduz para filtros)
        </label>
        <div className="flex gap-2">
          <input
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder="Ex.: indústrias de SP com score alto"
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <button
            type="button"
            onClick={handleNl}
            disabled={nlBusy || !nlPrompt.trim()}
            className="h-9 rounded-md border border-border px-3 text-xs disabled:opacity-40"
          >
            {nlBusy ? 'Interpretando…' : 'Interpretar com IA'}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do segmento (ex.: Indústria SP score alto)"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        {drafts.map((d, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select
              value={d.field}
              onChange={(e) => {
                const next = [...drafts];
                next[i] = { field: e.target.value, op: FIELDS[e.target.value].ops[0], value: '' };
                setDrafts(next);
              }}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              aria-label={`Campo da condição ${i + 1}`}
            >
              {Object.entries(FIELDS).map(([f, meta]) => (
                <option key={f} value={f}>{meta.label}</option>
              ))}
            </select>
            <select
              value={d.op}
              onChange={(e) => {
                const next = [...drafts];
                next[i] = { ...d, op: e.target.value };
                setDrafts(next);
              }}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              aria-label={`Operador da condição ${i + 1}`}
            >
              {FIELDS[d.field]?.ops.map((op) => (
                <option key={op} value={op}>{OP_LABEL[op] || op}</option>
              ))}
            </select>
            <input
              value={d.value}
              onChange={(e) => {
                const next = [...drafts];
                next[i] = { ...d, value: e.target.value };
                setDrafts(next);
              }}
              placeholder="valor"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
              aria-label={`Valor da condição ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
              disabled={drafts.length === 1}
              className="h-9 rounded-md border border-border px-3 text-sm disabled:opacity-40"
              aria-label={`Remover condição ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDrafts([...drafts, { field: 'industry', op: 'contains', value: '' }])}
            className="h-8 rounded-md border border-border px-3 text-xs"
          >
            + condição (E)
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="h-8 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Salvando…' : 'Salvar segmento e contar'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {preview && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p>
            <strong>{preview.count}</strong> leads correspondem
            {preview.delta !== null && (
              <span className={preview.delta >= 0 ? ' text-emerald-300' : ' text-amber-300'}>
                {' '}({preview.delta >= 0 ? '+' : ''}{preview.delta} desde a última contagem)
              </span>
            )}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {preview.sample.slice(0, 10).map((s) => (
              <li key={s.id}>
                {s.companyName} · {s.state || '—'} · score {s.opportunityScore ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}

      {segments.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">Segmentos salvos</h4>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-3 py-2">
                <span>
                  {s.name}
                  {s.lastCount != null && (
                    <span className="text-muted-foreground"> · {s.lastCount} leads</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void handlePreview(s.id)}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                >
                  Contar agora
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
