import React, { useState } from 'react';
import { Mail, Phone, Share2, Check, Copy } from 'lucide-react';
import { LockedText } from '@/components/ui/locked-text';
import { CompanyGraph, Prospect } from '@/types';
import { whatsappLink } from '@/lib/utils';
import { ConfidenceBadge, LeadSection, SectionNote } from './shared';

/**
 * LeadContacts — redes de contato acionáveis (FR-007): e-mails, telefones com
 * WhatsApp direto, perfis sociais e atalho para os endereços (que vivem na
 * seção de Localização). Trial: valores mascarados e ações desabilitadas
 * (FR-013) — nenhum valor mascarado é revelado.
 */

type Channel = {
  key: string;
  type: 'email' | 'phone' | 'social';
  value: string;
  label?: string;
  confidence?: number | null;
  source: string;
};

function CopyButton({ value, disabled }: { value: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  if (disabled) return null;
  return (
    <button
      title={`Copiar: ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // clipboard indisponível (permissão/http) — ação silenciosa
        }
      }}
      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function LeadContacts({
  prospect,
  graph,
  onEnrich,
}: {
  prospect: Prospect;
  graph: CompanyGraph | null;
  onEnrich: () => void;
}) {
  const restricted = Boolean(prospect.dataRestricted || graph?.dataRestricted);
  const contactPoints = graph?.profile?.contact_points || [];
  const socialEntries = Object.entries(graph?.profile?.social || {});

  const channels: Channel[] = [];
  if (prospect.cnpjEmail) {
    channels.push({ key: 'cnpj-email', type: 'email', value: prospect.cnpjEmail, label: 'Corporativo (cadastro)', source: 'cadastro' });
  }
  for (const [i, cp] of contactPoints.entries()) {
    const type = cp.type === 'phone' ? 'phone' : cp.type === 'email' ? 'email' : 'social';
    channels.push({ key: `cp-${i}`, type, value: cp.value, confidence: cp.confidence, source: 'enriquecimento' });
  }
  for (const [i, phone] of (prospect.cnpjPhones || []).entries()) {
    const dup = channels.some((c) => c.type === 'phone' && c.value.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (!dup) channels.push({ key: `phone-${i}`, type: 'phone', value: phone, label: 'Telefone (cadastro)', source: 'cadastro' });
  }
  for (const [platform, info] of socialEntries) {
    if (info?.url) channels.push({ key: `social-${platform}`, type: 'social', value: info.url, label: platform, confidence: info.confidence, source: 'enriquecimento' });
  }

  return (
    <LeadSection
      icon={<Mail className="h-4 w-4" />}
      title="Redes de contato"
      headerExtra={channels.length > 0 ? `${channels.length} canal(is)` : undefined}
      state={channels.length > 0 ? 'ready' : 'empty'}
      emptyAction={{ label: 'Disparar enriquecimento', onClick: onEnrich }}
    >
      <div className="space-y-2">
        {channels.map((channel) => {
          const wa = !restricted && channel.type === 'phone' ? whatsappLink(channel.value) : null;
          const social = channel.type === 'social';
          return (
            <div key={channel.key} className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                {channel.type === 'phone' ? (
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : social ? (
                  <Share2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Conversar no WhatsApp: ${channel.value}`}
                    className="truncate text-sm font-medium text-indigo-500 transition hover:text-emerald-600 dark:text-indigo-300 dark:hover:text-emerald-300"
                  >
                    {channel.value}
                  </a>
                ) : social ? (
                  <a
                    href={channel.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium text-indigo-400 hover:underline"
                  >
                    <span className="font-semibold capitalize">{channel.label}</span>
                    {' · '}
                    {channel.value.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  <span className="truncate text-sm font-medium text-foreground">
                    {restricted ? <LockedText>{channel.value}</LockedText> : channel.value}
                  </span>
                )}
                {channel.label && !social && (
                  <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">{channel.label}</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <ConfidenceBadge confidence={channel.confidence} />
                {!social && <CopyButton value={channel.value} disabled={restricted} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <SectionNote>
          Endereços do lead estão na seção <span className="font-semibold text-foreground">Localização</span> abaixo.
        </SectionNote>
      </div>
    </LeadSection>
  );
}
