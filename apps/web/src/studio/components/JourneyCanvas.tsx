/**
 * JourneyCanvas — construtor visual de journeys (US8, T087) com @xyflow/react.
 * Blocos (envio, espera, condição, fim) dispostos no canvas, ativação/pausa
 * e estatísticas por bloco (FR-056). v1: visualização + ativação + adição
 * simples de blocos; edição fina de arestas fica na onda de polish.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StudioRequestError } from '../api';

function fetchJourney(campaignId: string) {
  return fetch(`/api/studio/campaigns/${campaignId}/journey`).then(async (r) => {
    if (!r.ok) return null;
    const body = await r.json();
    return body.data ?? null;
  });
}

function saveJourney(campaignId: string, payload: unknown) {
  return fetch(`/api/studio/campaigns/${campaignId}/journey`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const BLOCK_COLOR: Record<string, string> = {
  send: '#0ea5e9',
  wait: '#f59e0b',
  condition: '#8b5cf6',
  end: '#64748b',
  update: '#10b981',
};

export interface JourneyCanvasProps {
  campaignId: string;
  campaignStatus: string;
}

export function JourneyCanvas({ campaignId, campaignStatus }: JourneyCanvasProps) {
  const [journey, setJourney] = useState<any>(null);
  const [stats, setStats] = useState<Record<string, { entered: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  const load = useCallback(async () => {
    try {
      const j = await fetchJourney(campaignId);
      setJourney(j);
      if (j?.definition?.blocks) {
        setNodes(
          j.definition.blocks.map((b: any, i: number) => ({
            id: b.id,
            position: { x: 80 + (i % 3) * 190, y: 60 + Math.floor(i / 3) * 100 },
            data: { label: `${b.type}: ${b.id}` },
            style: { borderColor: BLOCK_COLOR[b.type] || '#333', borderWidth: 2 },
          }))
        );
        setEdges(
          (j.definition.edges || []).map((e: any, i: number) => ({
            id: `e-${i}`,
            source: e.from,
            target: e.to,
            label: e.branch,
            animated: true,
          }))
        );
      }
      if (j?.id) {
        const s = await fetch(`/api/studio/journeys/${j.id}/stats`).then((r) => r.json());
        setStats(s.data || {});
      }
    } catch (err) {
      setError(err instanceof StudioRequestError ? err.message : 'Falha ao carregar journey');
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const definition = useMemo(
    () => ({
      blocks: nodes.map((n) => ({
        id: n.id,
        type: String(n.data.label || '').split(':')[0],
        config: {},
      })),
      edges: edges.map((e) => ({ from: e.source, to: e.target })),
    }),
    [nodes, edges]
  );

  const handleSave = async () => {
    setError(null);
    const res = await saveJourney(campaignId, {
      definition,
      triggers: journey?.triggers || [],
      stopConditions: journey?.stopConditions || ['reply', 'opt_out', 'converted'],
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message || 'Falha ao salvar journey');
      return;
    }
    await load();
  };

  const handleControl = async (action: 'activate' | 'pause') => {
    setError(null);
    const res = await fetch(`/api/studio/journeys/${journey.id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message || 'Falha no controle');
      return;
    }
    await load();
  };

  const addBlock = (type: string) => {
    const id = `${type[0]}${Date.now().toString(36).slice(-4)}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        position: { x: 80 + (prev.length % 3) * 190, y: 60 + Math.floor(prev.length / 3) * 100 },
        data: { label: `${type}: ${id}` },
        style: { borderColor: BLOCK_COLOR[type] || '#333', borderWidth: 2 },
      },
    ]);
  };

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {['send', 'wait', 'condition', 'end'].map((type) => (
          <button key={type} type="button" onClick={() => addBlock(type)} className="h-8 rounded-md border border-border px-3 text-xs">
            + {type}
          </button>
        ))}
        <button type="button" onClick={handleSave} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          Salvar journey
        </button>
        {journey?.id && (
          <>
            <button
              type="button"
              onClick={() => handleControl('activate')}
              disabled={journey.status === 'active'}
              className="h-8 rounded-md border border-emerald-500/50 px-3 text-xs text-emerald-300 disabled:opacity-40"
              title="Exige campanha aprovada"
            >
              Ativar
            </button>
            <button
              type="button"
              onClick={() => handleControl('pause')}
              disabled={journey.status !== 'active'}
              className="h-8 rounded-md border border-border px-3 text-xs disabled:opacity-40"
            >
              Pausar
            </button>
          </>
        )}
        <span className="self-center text-xs text-muted-foreground">
          Paradas globais: resposta · conversão · opt-out
        </span>
      </div>

      <div style={{ height: 380 }} className="rounded-lg border border-border">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {Object.keys(stats).length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {Object.entries(stats).map(([blockId, s]) => (
            <li key={blockId} className="rounded-full border border-border px-3 py-1">
              {blockId}: {s.entered} lead(s)
            </li>
          ))}
        </ul>
      )}
      {campaignStatus !== 'approved' && campaignStatus !== 'scheduled' && campaignStatus !== 'running' && (
        <p className="text-xs text-muted-foreground">
          Ative a campanha (aprovação) para poder ativar o journey.
        </p>
      )}
    </div>
  );
}
