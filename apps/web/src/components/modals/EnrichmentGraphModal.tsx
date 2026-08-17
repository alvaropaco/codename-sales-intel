import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Building2,
  Globe,
  Mail,
  Phone,
  Cpu,
  Users,
  Wallet,
  Target,
  ShieldCheck,
  Link2,
  Search,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CompanyGraph, GraphNode } from '@/types';
import { fetchCompanyGraph } from '@/services/api';
import { formatCNPJ } from '@/lib/utils';

interface EnrichmentGraphModalProps {
  cnpj: string;
  companyName: string;
  onClose: () => void;
}

const ENTITY_COLORS: Record<string, string> = {
  COMPANY: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  DOMAIN: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  EMAIL: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PHONE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PERSON: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  SOCIAL_PROFILE: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  TECHNOLOGY: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  URL: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  ADDRESS: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};

function extractValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('value' in obj && obj.value != null) return String(obj.value);
    if ('url' in obj && obj.url != null) return String(obj.url);
    return JSON.stringify(obj);
  }
  return String(value);
}

function confidencePct(confidence: number | null | undefined): number | null {
  if (confidence == null) return null;
  return Math.round(confidence * 100);
}

function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  const pct = confidencePct(confidence);
  if (pct == null) return null;
  const tone =
    pct >= 85
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : pct >= 65
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone}`}>
      {pct}%
    </span>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card/60 p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground mb-4">
        <span className="text-indigo-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</span>
      <span className={`block text-sm font-medium text-foreground ${mono ? 'font-mono text-[13px]' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

function RelationshipGraph({ nodes, edges, companyLabel }: {
  nodes: GraphNode[];
  edges: CompanyGraph['edges'];
  companyLabel: string;
}) {
  const visibleNodes = useMemo(() => {
    const company = nodes.find((n) => n.type === 'COMPANY');
    if (company) return nodes.filter((n) => n.id !== company.id);
    return nodes.slice(0, 8);
  }, [nodes]);

  if (edges.length === 0 && visibleNodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Link2 className="h-4 w-4" /> Nenhuma relação externa identificada ainda.
      </p>
    );
  }

  const cx = 200;
  const cy = 130;
  const radius = 92;

  const positions = new Map<string, { x: number; y: number }>();
  positions.set('__company__', { x: cx, y: cy });
  visibleNodes.forEach((node, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(visibleNodes.length, 1) - Math.PI / 2;
    positions.set(node.id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  const companyId = nodes.find((n) => n.type === 'COMPANY')?.id;
  const drawnEdges = edges.slice(0, 16).map((edge, i) => {
    const sourceId = edge.source === companyId || edge.source === 'source' ? '__company__' : edge.source;
    const targetId = edge.target === companyId ? '__company__' : edge.target;
    const from = positions.get(sourceId) ?? positions.get(edge.source);
    const to = positions.get(targetId) ?? positions.get(edge.target);
    return { ...edge, from, to, key: i };
  }).filter((e) => e.from && e.to);

  return (
    <div>
      <svg viewBox="0 0 400 260" className="w-full h-auto">
        <defs>
          <radialGradient id="eg-radial" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(129,140,248,0.12)" />
            <stop offset="100%" stopColor="rgba(129,140,248,0)" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="400" height="260" rx="16" fill="url(#eg-radial)" />
        {drawnEdges.map((e) => (
          <line
            key={e.key}
            x1={e.from!.x}
            y1={e.from!.y}
            x2={e.to!.x}
            y2={e.to!.y}
            stroke="rgba(129,140,248,0.35)"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
        ))}
        <circle cx={cx} cy={cy} r="26" fill="rgba(99,102,241,0.2)" stroke="rgba(129,140,248,0.7)" strokeWidth="1.5" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-foreground" fontSize="9" fontWeight="700">
          {companyLabel.length > 16 ? `${companyLabel.slice(0, 16)}…` : companyLabel}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fill="rgba(148,163,184,0.9)" fontSize="7">
          Empresa
        </text>
        {visibleNodes.map((node) => {
          const p = positions.get(node.id)!;
          return (
            <g key={node.id}>
              <circle cx={p.x} cy={p.y} r="13" fill="rgba(15,23,42,0.9)" stroke="rgba(129,140,248,0.5)" strokeWidth="1.2" />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fill="rgba(226,232,240,0.95)" fontSize="7" fontWeight="700">
                {node.type.slice(0, 1)}
              </text>
              <text x={p.x} y={p.y + 22} textAnchor="middle" fill="rgba(148,163,184,0.9)" fontSize="7">
                {node.label.length > 14 ? `${node.label.slice(0, 14)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {edges.length} vínculo(s) identificado(s) · {visibleNodes.length} entidade(s) relacionada(s)
      </p>
    </div>
  );
}

export const EnrichmentGraphModal: React.FC<EnrichmentGraphModalProps> = ({
  cnpj,
  companyName,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<CompanyGraph | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const res = await fetchCompanyGraph(cnpj);
      if (!mounted) return;
      setAvailable(res.available);
      setError(res.error);
      setGraph(res.data);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [cnpj]);

  const profile = graph?.profile;
  const fg = profile?.firmographics || {};
  const socialEntries = Object.entries(profile?.social || {});
  const people = profile?.people || [];
  const technologies = profile?.technologies || [];
  const contacts = profile?.contact_points || [];
  const indicators = Object.entries(profile?.financial_indicators || {});
  const facts = graph?.facts || [];
  const status = graph?.status;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">
        <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          {/* Header */}
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <Building2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-foreground leading-tight">{companyName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-xs text-muted-foreground">{formatCNPJ(cnpj)}</span>
                  {status && (
                    <Badge variant={status === 'COMPLETED' ? 'qualified' : 'prospect'} className="text-[10px]">
                      {status}
                    </Badge>
                  )}
                  {graph && <span className="text-[10px] text-muted-foreground">v{graph.enrichmentVersion}</span>}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {loading ? (
              <div className="flex h-full items-center justify-center flex-col gap-3 text-muted-foreground">
                <Sparkles className="h-8 w-8 animate-pulse text-indigo-400" />
                <p className="text-sm">Carregando grafo de enriquecimento…</p>
              </div>
            ) : !available ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title="Grafo de enriquecimento indisponível"
                description={
                  error
                    ? `Não foi possível carregar o grafo. ${error}`
                    : 'Configure a variável ENRICHMENT_DATABASE_URL no backend para ativar a leitura do grafo completo.'
                }
              />
            ) : error ? (
              <EmptyState
                icon={<ShieldCheck className="h-8 w-8" />}
                title="Erro ao carregar o grafo"
                description={error}
              />
            ) : !graph || !profile ? (
              <EmptyState
                icon={<ShieldCheck className="h-8 w-8" />}
                title="Nenhum enriquecimento concluído"
                description="Os dados aparecem aqui assim que o pipeline concluir o enriquecimento desta empresa."
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* Firmographics */}
                <Section icon={<Building2 className="h-4 w-4" />} title="Firmografia">
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Field label="Razão social" value={extractValue(fg.legal_name)} />
                    <Field label="Nome fantasia" value={extractValue(fg.trade_name)} />
                    <Field label="CNAE principal" value={extractValue(fg.main_cnae)} />
                    <Field label="Porte" value={extractValue(fg.porte)} />
                    <Field label="Capital social" value={extractValue(fg.capital_social)} />
                    <Field label="Abertura" value={extractValue(fg.opening_date)} />
                    <Field label="Natureza jurídica" value={extractValue(fg.legal_nature)} />
                    <Field label="CNPJ" value={extractValue(fg.cnpj)} mono />
                  </div>
                </Section>

                {/* Digital presence */}
                <Section icon={<Globe className="h-4 w-4" />} title="Presença digital">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-3">
                      <span className="text-xs font-semibold text-muted-foreground">Domínio</span>
                      <span className="font-mono text-sm text-foreground">
                        {profile.domain ? extractValue(profile.domain) : '—'}
                      </span>
                    </div>
                    {socialEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {socialEntries.map(([platform, info]) => (
                          <span key={platform} className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs">
                            <span className="font-semibold capitalize text-foreground">{platform}</span>
                            {info?.url && (
                              <a href={info.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                                {info.url.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                            <ConfidenceBadge confidence={info?.confidence} />
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Nenhum perfil social identificado.</p>
                    )}
                  </div>
                </Section>

                {/* Contacts */}
                <Section icon={<Mail className="h-4 w-4" />} title="Contatos">
                  {contacts.length > 0 ? (
                    <div className="space-y-2">
                      {contacts.map((c, i) => (
                        <div key={i} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
                          <span className="flex items-center gap-2 text-sm text-foreground">
                            {c.type === 'phone' ? <Phone className="h-4 w-4 text-muted-foreground" /> : <Mail className="h-4 w-4 text-muted-foreground" />}
                            {c.value}
                          </span>
                          <ConfidenceBadge confidence={c.confidence} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum contato identificado.</p>
                  )}
                </Section>

                {/* Technologies */}
                <Section icon={<Cpu className="h-4 w-4" />} title="Tecnologias">
                  {technologies.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {technologies.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs">
                          <span className="font-semibold text-foreground">{t.name || '—'}</span>
                          {t.category && <span className="text-muted-foreground">· {t.category}</span>}
                          <ConfidenceBadge confidence={t.confidence} />
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma tecnologia detectada.</p>
                  )}
                </Section>

                {/* People */}
                <Section icon={<Users className="h-4 w-4" />} title="Quadro societário">
                  {people.length > 0 ? (
                    <div className="space-y-2">
                      {people.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-8 w-8 shrink-0 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 flex items-center justify-center text-xs font-bold">
                              {p.label?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{p.label}</p>
                              <p className="text-[11px] text-muted-foreground capitalize">{p.role}</p>
                            </div>
                          </div>
                          <ConfidenceBadge confidence={p.confidence} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum sócio ou diretor identificado.</p>
                  )}
                </Section>

                {/* Financial indicators */}
                <Section icon={<Wallet className="h-4 w-4" />} title="Indicadores">
                  {indicators.length > 0 ? (
                    <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                      {indicators.map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
                          <span className="text-xs font-semibold text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                          <span className="text-sm font-bold text-foreground">{extractValue(value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum indicador financeiro.</p>
                  )}
                </Section>

                {/* Relationships graph */}
                <Section icon={<Link2 className="h-4 w-4" />} title="Rede de relacionamentos">
                  <RelationshipGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    companyLabel={graph.companyLabel || companyName}
                  />
                </Section>

                {/* Evidence */}
                <Section icon={<ShieldCheck className="h-4 w-4" />} title="Evidências e proveniência">
                  {facts.length > 0 ? (
                    <div className="space-y-2">
                      {facts.slice(0, 24).map((fact, i) => (
                        <div key={i} className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-foreground">{fact.fact_key}</span>
                            <ConfidenceBadge confidence={fact.confidence} />
                          </div>
                          <p className="mt-0.5 text-xs text-foreground/80 break-words">{extractValue(fact.value)}</p>
                          {fact.source && (
                            <p className="mt-1 text-[10px] text-muted-foreground truncate">
                              Fonte: {extractValue(fact.source)} · {fact.entity_type}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma evidência registrada.</p>
                  )}
                </Section>
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between border-t border-border px-6 py-4">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Target className="h-3.5 w-3.5 text-indigo-400" />
              {graph?.enrichedAt
                ? `Atualizado em ${new Date(graph.enrichedAt).toLocaleString('pt-BR')}`
                : 'Dados do pipeline de enriquecimento'}
            </div>
            <Button onClick={onClose} variant="outline" size="sm">
              Fechar
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
};

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <div className="text-indigo-400">{icon}</div>
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      <p className="max-w-md text-sm">{description}</p>
    </div>
  );
}
