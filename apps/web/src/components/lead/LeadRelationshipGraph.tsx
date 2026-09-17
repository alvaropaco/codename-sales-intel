import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link2, Network, RefreshCw } from 'lucide-react';
import { CompanyGraph, GraphNode } from '@/types';
import { LeadSection, SectionNote, entityTone } from './shared';

/**
 * LeadRelationshipGraph — rede de relacionamentos INTERATIVA (FR-008), que
 * substitui o SVG estático do antigo modal: pan, zoom, seleção de nó com
 * destaque da vizinhança e painel de detalhe. Layout radial calculado em
 * código (empresa no centro — pesquisa D2: sem dependência extra de layout).
 */

const MAX_NODES = 24;
const RING_1 = 210;
const RING_2 = 400;

interface NodeDetail {
  id: string;
  type: string;
  label: string;
  key: string;
  connections: number;
  edgeTypes: string[];
}

function buildLayout(nodes: GraphNode[]) {
  const company = nodes.find((n) => n.type === 'COMPANY');
  const others = nodes.filter((n) => n.id !== company?.id).slice(0, MAX_NODES - 1);
  const visible = company ? [company, ...others] : nodes.slice(0, MAX_NODES);

  const positions = new Map<string, { x: number; y: number }>();
  visible.forEach((node) => {
    if (node.id === company?.id) {
      positions.set(node.id, { x: 0, y: 0 });
    }
  });
  const satellites = visible.filter((n) => n.id !== company?.id);
  satellites.forEach((node, i) => {
    const angle = (Math.PI * 2 * i) / satellites.length - Math.PI / 2;
    const ring = i < 8 ? RING_1 : RING_2;
    positions.set(node.id, {
      x: ring * Math.cos(angle),
      y: ring * Math.sin(angle),
    });
  });
  return { visible, positions, hidden: nodes.length - visible.length };
}

export function LeadRelationshipGraph({
  graph,
  graphAvailable,
  state,
  error,
  hasCnpj,
  onRetry,
  onEnrich,
}: {
  graph: CompanyGraph | null;
  graphAvailable: boolean;
  state: 'loading' | 'ready' | 'error' | 'empty' | 'idle';
  error?: string;
  hasCnpj: boolean;
  onRetry: () => void;
  onEnrich: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { flowNodes, flowEdges, detail, hiddenCount } = useMemo(() => {
    if (!graph) {
      return { flowNodes: [] as Node[], flowEdges: [] as Edge[], detail: null as NodeDetail | null, hiddenCount: 0 };
    }
    const { visible, positions, hidden } = buildLayout(graph.nodes || []);
    const ids = new Set(visible.map((n) => n.id));

    const flowNodes: Node[] = visible.map((node) => {
      const isCompany = node.type === 'COMPANY';
      const pos = positions.get(node.id)!;
      return {
        id: node.id,
        position: pos,
        data: { label: node.label.length > 22 ? `${node.label.slice(0, 22)}…` : node.label },
        style: {
          width: isCompany ? 190 : 150,
          padding: '6px 10px',
          borderRadius: 14,
          borderWidth: 1.5,
          fontSize: 11,
          fontWeight: 700,
          textAlign: 'center',
          boxShadow: isCompany ? '0 0 0 4px rgba(99,102,241,0.15)' : undefined,
        },
        className: `${entityTone(node.type)} leading-tight`,
      };
    });

    const flowEdges: Edge[] = (graph.edges || [])
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e, i) => ({
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: false,
        style: { stroke: 'rgba(129,140,248,0.35)', strokeWidth: 1.2, strokeDasharray: '4 3' },
        label: e.type,
      }));

    const selected = visible.find((n) => n.id === selectedId);
    let detail: NodeDetail | null = null;
    if (selected) {
      const connected = flowEdges.filter((e) => e.source === selected.id || e.target === selected.id);
      detail = {
        id: selected.id,
        type: selected.type,
        label: selected.label,
        key: selected.key,
        connections: connected.length,
        edgeTypes: [...new Set(connected.map((e) => String(e.label)))].slice(0, 6),
      };
    }

    return { flowNodes, flowEdges, detail, hiddenCount: hidden };
  }, [graph, selectedId]);

  // destaque de vizinhança: arestas do nó selecionado acesas, demais apagadas
  const styledEdges = useMemo(
    () =>
      flowEdges.map((e) => {
        if (!selectedId || (e.source !== selectedId && e.target !== selectedId)) {
          return selectedId
            ? { ...e, style: { ...e.style, opacity: 0.12 } }
            : e;
        }
        return {
          ...e,
          animated: true,
          style: { stroke: '#818cf8', strokeWidth: 2.2 },
        };
      }),
    [flowEdges, selectedId]
  );

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    setSelectedId((current) => (current === node.id ? null : node.id));
  }, []);

  const emptyCopy = !hasCnpj
    ? 'Este lead não tem CNPJ — o grafo de relacionamentos é construído a partir do enriquecimento profundo da empresa.'
    : !graphAvailable
      ? 'A fonte do grafo de enriquecimento está indisponível agora. As demais seções seguem funcionais.'
      : 'Nenhuma relação externa identificada ainda para esta empresa.';

  return (
    <LeadSection
      icon={<Network className="h-4 w-4" />}
      title="Rede de relacionamentos"
      state={state}
      error={error}
      onRetry={onRetry}
      headerExtra={
        flowNodes.length > 0
          ? `${flowNodes.length} nó(s) · ${flowEdges.length} vínculo(s)` +
            (hiddenCount > 0 ? ` · +${hiddenCount} entidade(s) oculta(s)` : '')
          : undefined
      }
      className="xl:col-span-2"
    >
      {flowNodes.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <SectionNote>{emptyCopy}</SectionNote>
          {hasCnpj && !graphAvailable && (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary">
              <RefreshCw className="h-3 w-3" /> Tentar novamente
            </button>
          )}
          {hasCnpj && graphAvailable && (
            <button onClick={onEnrich} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-2.5 py-1 text-[11px] font-semibold text-indigo-400 transition hover:bg-indigo-500/25">
              <RefreshCw className="h-3 w-3" /> Disparar enriquecimento
            </button>
          )}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-background/40">
          <div className="h-[420px]">
            <ReactFlow
              nodes={flowNodes}
              edges={styledEdges}
              onNodeClick={onNodeClick}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.15}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              nodesDraggable
              panOnScroll
              selectionOnDrag={false}
            >
              <Background gap={24} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable className="!bg-secondary/30" />
            </ReactFlow>
          </div>

          {detail && (
            <div className="absolute right-3 top-3 w-64 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${entityTone(detail.type)}`}>
                  {detail.type}
                </span>
                <button onClick={() => setSelectedId(null)} className="text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                  fechar ✕
                </button>
              </div>
              <p className="mt-2 break-words text-sm font-bold text-foreground">{detail.label}</p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{detail.key}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Link2 className="h-3 w-3" /> {detail.connections} conexão(ões)
                {detail.edgeTypes.length > 0 && ` · ${detail.edgeTypes.join(', ')}`}
              </p>
            </div>
          )}
        </div>
      )}
    </LeadSection>
  );
}
