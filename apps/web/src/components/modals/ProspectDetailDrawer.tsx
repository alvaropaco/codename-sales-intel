import React, { useState, useEffect } from 'react';
import {
  X,
  Building2,
  ShieldCheck,
  Users,
  DollarSign,
  Calendar,
  Trash2,
  Mail,
  Phone,
  Globe,
  Target,
  Cpu,
  Landmark,
  MapPin,
  Network,
  Send,
  ExternalLink,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Prospect, OutreachContactSummary } from '@/types';
import { formatCNPJ, formatCurrency, whatsappLink } from '@/lib/utils';
import { EnrichmentGraphModal } from './EnrichmentGraphModal';
import { fetchProspectOutreachStatus, fetchProspectOutreachTimeline } from '@/services/api';

interface ProspectDetailDrawerProps {
  prospect: Prospect | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function scoreLabel(value: number | null | undefined): string {
  return value != null ? `${Math.round(value)}/100` : '—';
}

function boolLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  return '—';
}

export const ProspectDetailDrawer: React.FC<ProspectDetailDrawerProps> = ({
  prospect,
  onClose,
  onDelete,
}) => {
  const [showGraph, setShowGraph] = useState(false);

  const [outreachContacts, setOutreachContacts] = useState<OutreachContactSummary[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachEventCount, setOutreachEventCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (prospect) {
      setOutreachLoading(true);
      setOutreachContacts([]);
      (async () => {
        const [contacts, timeline] = [
          await fetchProspectOutreachStatus(prospect.id),
          await fetchProspectOutreachTimeline(prospect.id),
        ];
        if (!cancelled) {
          setOutreachContacts(contacts);
          setOutreachEventCount(timeline.length);
          setOutreachLoading(false);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [prospect]);

  if (!prospect) return null;

  const summary = prospect.enrichmentSummary;
  const hasSummary =
    summary && Object.values(summary).some((v) => v !== null && v !== undefined);
  const phones = prospect.cnpjPhones || [];
  const partners = prospect.cnpjPartners || [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-card border-l border-border shadow-2xl p-6 flex flex-col justify-between overflow-y-auto">
          {/* Top Bar */}
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground leading-tight">
                    {prospect.companyName}
                  </h3>
                  <p className="text-xs font-mono text-muted-foreground">
                    {formatCNPJ(prospect.cnpj)}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Status Bar */}
            <div className="my-5 p-4 rounded-xl bg-secondary/40 border border-border/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Potencial comercial</span>
                <p className="text-2xl font-black text-indigo-400">{prospect.opportunityScore}/100</p>
              </div>
              <Badge variant={prospect.status === 'qualified' ? 'qualified' : 'prospect'}>
                {prospect.status.toUpperCase()}
              </Badge>
            </div>

            {/* Firmographics */}
            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground font-semibold">Segmento de atuação</span>
                <p className="font-medium text-foreground">{prospect.industry || 'Segmento a confirmar'}</p>
              </div>

              {(prospect.city || prospect.state) && (
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Localização</span>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {[prospect.city, prospect.state].filter(Boolean).join(' — ')}
                  </p>
                </div>
              )}

              {prospect.tradeName && (
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Nome fantasia</span>
                  <p className="font-medium text-foreground">{prospect.tradeName}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Funcionários</span>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    {prospect.employees != null ? `${prospect.employees} colaboradores` : 'A confirmar'}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground font-semibold">Faturamento Est.</span>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    {prospect.revenueEstimate ? formatCurrency(prospect.revenueEstimate) : 'A confirmar'}
                  </p>
                </div>
              </div>

              {(prospect.cnpjLegalNature || prospect.cnpjOpenedAt) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-muted-foreground font-semibold flex items-center gap-1">
                      <Landmark className="h-3.5 w-3.5 text-muted-foreground" /> Natureza jurídica
                    </span>
                    <p className="font-medium text-foreground">{prospect.cnpjLegalNature || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground font-semibold flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Abertura
                    </span>
                    <p className="font-medium text-foreground">
                      {prospect.cnpjOpenedAt ? new Date(prospect.cnpjOpenedAt).toLocaleDateString('pt-BR') : '—'}
                    </p>
                  </div>
                </div>
              )}

              {(prospect.cnpjEmail || phones.length > 0) && (
                <div className="space-y-2">
                  {prospect.cnpjEmail && (
                    <p className="font-medium text-foreground flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {prospect.cnpjEmail}
                    </p>
                  )}
                  {phones.length > 0 && (
                    <div className="space-y-1.5">
                      {phones.map((phone) => {
                        const wa = whatsappLink(phone);
                        return wa ? (
                          <a
                            key={phone}
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Conversar no WhatsApp: ${phone}`}
                            className="font-medium text-foreground flex items-center gap-1.5 text-indigo-500 hover:text-emerald-600 dark:text-indigo-300 dark:hover:text-emerald-300 transition"
                          >
                            <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {phone}
                          </a>
                        ) : (
                          <p key={phone} className="font-medium text-foreground flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {phone}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {partners.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-muted-foreground font-semibold">Sócios / representantes</span>
                  {partners.map((partner, i) => (
                    <p key={i} className="font-medium text-foreground">
                      {partner.name || 'Sócio'}
                      {partner.qualification ? ` · ${partner.qualification}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Enrichment intelligence */}
            {hasSummary && summary ? (
              <div className="mt-5 pt-4 border-t border-border space-y-3">
                <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-indigo-400" />
                  Inteligência de enriquecimento
                </h4>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Potencial</span>
                    <p className="text-lg font-black text-indigo-400">{scoreLabel(summary.commercial_potential)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Prontidão</span>
                    <p className="text-lg font-black text-emerald-400">{scoreLabel(summary.operational_readiness)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Lançamento</span>
                    <p className="text-lg font-black text-amber-400">{scoreLabel(summary.launch_velocity)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Domínio
                    </span>
                    <span className="font-medium text-foreground">{summary.domain || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-semibold">Site ativo</span>
                    <span className="font-medium text-foreground">{boolLabel(summary.website_active)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-semibold">E-mail corporativo</span>
                    <span className="font-medium text-foreground">{boolLabel(summary.corporate_email)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-muted-foreground" /> Tecnologias detectadas
                    </span>
                    <span className="font-medium text-foreground">
                      {summary.tech_count != null ? summary.tech_count : '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Fonte: {prospect.enrichmentSource || '—'}</span>
                  <span>v{prospect.enrichmentVersion ?? 1}</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {prospect.enrichmentStatus === 'pending'
                    ? 'Enriquecimento em andamento...'
                    : 'Dados de enriquecimento ainda não disponíveis.'}
                </p>
              </div>
            )}

            {/* Full enrichment graph */}
            <Button
              onClick={() => setShowGraph(true)}
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-2 text-xs"
            >
              <Network className="h-3.5 w-3.5 text-indigo-400" />
              Ver grafo de enriquecimento completo
            </Button>

            {/* Outreach status */}
            <div className="pt-4 border-t border-border space-y-3 mt-5">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-indigo-400" />
                Outreach (e-mail automático)
              </h4>
              {outreachLoading ? (
                <p className="text-xs text-muted-foreground">Carregando status de outreach…</p>
              ) : outreachContacts.length === 0 ? (
                <p className="rounded-lg bg-secondary/30 border border-border/40 p-2.5 text-xs text-muted-foreground">
                  Nenhum contato de outreach para este lead ainda.
                </p>
              ) : (
                <div className="space-y-2.5 text-[11px]">
                  {outreachContacts.map((contact) => (
                    <div key={contact.id} className="rounded-lg bg-secondary/30 border border-border/40 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">
                          {contact.campaign?.name || 'Campanha'}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {contact.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      {contact.messages && contact.messages.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {contact.messages.map((msg) => (
                            <div key={msg.id} className="flex items-start gap-1.5">
                              {msg.sentAt ? (
                                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                              ) : (
                                <Clock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                              )}
                              <div>
                                <p className="font-medium text-foreground">{msg.subject}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {msg.status?.replace(/_/g, ' ')}
                                  {msg.sentAt
                                    ? ` · ${new Date(msg.sentAt).toLocaleString('pt-BR')}`
                                    : msg.scheduledFor
                                      ? ` · agendado ${new Date(msg.scheduledFor).toLocaleString('pt-BR')}`
                                      : ''}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {contact.lastReplyAt && (
                        <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                          <ExternalLink className="h-3 w-3" /> Respondido em {new Date(contact.lastReplyAt).toLocaleString('pt-BR')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!outreachLoading && outreachEventCount > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {outreachEventCount} evento(s) registrado(s) no funil de outreach.
                </p>
              )}
            </div>

            {/* Activity Timeline (real status) */}
            <div className="pt-4 border-t border-border space-y-3 mt-5">
              <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">Linha do tempo</h4>
              <div className="space-y-2.5 text-[11px]">
                <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                  <p className="font-semibold text-foreground">
                    {prospect.enrichmentStatus === 'enriched' ? 'Enriquecimento concluído' : 'Enriquecimento pendente'}
                  </p>
                  <p className="text-muted-foreground text-[10px]">
                    {prospect.enrichedAt
                      ? new Date(prospect.enrichedAt).toLocaleString('pt-BR')
                      : 'Aguardando pipeline'}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                  <p className="font-semibold text-foreground">Lead salvo na sua lista</p>
                  <p className="text-muted-foreground text-[10px]">
                    {new Date(prospect.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
            <Button
              onClick={() => {
                onDelete(prospect.id);
                onClose();
              }}
              variant="destructive"
              size="sm"
              className="text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>

            <Button onClick={onClose} variant="outline" size="sm" className="text-xs">
              Fechar
            </Button>
          </div>
        </div>
      </div>

      {showGraph && (
        <EnrichmentGraphModal
          cnpj={prospect.cnpj}
          companyName={prospect.companyName}
          onClose={() => setShowGraph(false)}
        />
      )}
    </div>
  );
};
