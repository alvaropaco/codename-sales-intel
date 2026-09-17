import React from 'react';
import { MapPin, Copy, Check } from 'lucide-react';
import { LeadAddress } from '@/types';
import { ConfidenceBadge, LeadSection, SectionNote } from './shared';

/**
 * LeadAddresses — lista de endereços do lead (FR-012): endereços que não
 * puderam ser geocodificados permanecem listados com a sinalização
 * "sem localização no mapa"; premium pode copiar o endereço completo.
 */

const KIND_LABEL: Record<LeadAddress['kind'], string> = {
  headquarters: 'Sede',
  captured: 'Capturado no enriquecimento',
  city: 'Resumo comercial',
};

const PRECISION_LABEL: Record<string, string> = {
  street: 'precisão de rua',
  zip: 'precisão de CEP',
  city: 'precisão de cidade',
};

function AddressRow({ address, restricted }: { address: LeadAddress; restricted: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{address.fullText}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {KIND_LABEL[address.kind]}
            {address.location ? ` · ${PRECISION_LABEL[address.location.precision] || address.location.precision}` : ' · sem localização no mapa'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ConfidenceBadge confidence={address.confidence} />
        {!restricted && (
          <button
            title="Copiar endereço"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address.fullText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                // clipboard indisponível
              }
            }}
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function LeadAddresses({
  addresses,
  restricted,
}: {
  addresses: LeadAddress[];
  restricted: boolean;
}) {
  return (
    <LeadSection
      icon={<MapPin className="h-4 w-4" />}
      title="Endereços"
      headerExtra={addresses.length > 0 ? `${addresses.length} endereço(s)` : undefined}
      state={addresses.length > 0 ? 'ready' : 'empty'}
    >
      <div className="space-y-2">
        {addresses.map((address) => (
          <AddressRow key={address.id} address={address} restricted={restricted} />
        ))}
      </div>
      {restricted && (
        <div className="mt-3">
          <SectionNote>Endereços completos exigem plano Premium — no trial mostramos apenas o resumo comercial (cidade/UF).</SectionNote>
        </div>
      )}
    </LeadSection>
  );
}
