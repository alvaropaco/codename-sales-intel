import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, MapPin } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LeadAddress } from '@/types';
import { LeadSection } from './shared';

/**
 * LeadLocationMap — mapa 3D (MapLibre GL, pesquisa D1) com um marcador por
 * endereço geocodificado: cena com pitch/rotação (controles de navegação),
 * cartão de detalhes ao clicar no marcador. A biblioteca entra via import
 * dinâmico para não pesar o bundle principal (SC-001/SC-003).
 */

function pinElement(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 18px; height: 18px; border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg); border: 2px solid rgba(255,255,255,0.9);
    box-shadow: 0 2px 8px rgba(0,0,0,0.45); cursor: pointer;
    background: ${color};
  `;
  return el;
}

const PIN_COLORS: Record<string, string> = {
  headquarters: '#6366f1',
  captured: '#f59e0b',
  city: '#38bdf8',
};

export function LeadLocationMap({ addresses }: { addresses: LeadAddress[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // import dinâmico: mantém maplibre-gl fora do bundle principal
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const markersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const [libReady, setLibReady] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const [selected, setSelected] = useState<LeadAddress | null>(null);

  const geoAddresses = useMemo(() => addresses.filter((a) => a.location), [addresses]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      maplibreRef.current = await import('maplibre-gl');
      if (!cancelled) setLibReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const maplibre = maplibreRef.current;
    if (!libReady || !maplibre || !containerRef.current || mapRef.current) return;

    const first = geoAddresses[0]?.location;
    const map = new maplibre.Map({
      container: containerRef.current,
      // tiles raster públicos do OpenStreetMap — sem chave de API (research D1)
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: first ? [first.lng, first.lat] : [-47.9292, -15.7801],
      zoom: first ? (first.precision === 'city' ? 10 : 15) : 3,
      pitch: 60,
      bearing: -20,
      attributionControl: false,
    });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => setStyleReady(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
    };
  }, [libReady]);

  // marcadores reagem a mudanças da lista de endereços (após o estilo carregar)
  useEffect(() => {
    const maplibre = maplibreRef.current;
    const map = mapRef.current;
    if (!libReady || !styleReady || !maplibre || !map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = geoAddresses
      .map((address) => {
        const marker = new maplibre.Marker({ element: pinElement(PIN_COLORS[address.kind] || '#6366f1') })
          .setLngLat([address.location!.lng, address.location!.lat])
          .addTo(map);
        marker.getElement().addEventListener('click', (e) => {
          e.stopPropagation();
          setSelected(address);
        });
        return marker;
      });
  }, [geoAddresses, libReady, styleReady]);

  // recentra no endereço selecionado
  useEffect(() => {
    const map = mapRef.current;
    if (selected?.location && map) {
      map.easeTo({
        center: [selected.location.lng, selected.location.lat],
        zoom: Math.max(map.getZoom(), 16),
        pitch: 65,
        duration: 800,
      });
    }
  }, [selected]);

  return (
    <LeadSection
      icon={<Globe className="h-4 w-4" />}
      title="Localização"
      headerExtra={geoAddresses.length > 0 ? `${geoAddresses.length} endereço(s) no mapa · arraste para girar a cena` : undefined}
      state={geoAddresses.length > 0 ? 'ready' : 'empty'}
      className="xl:col-span-2"
    >
      <div className="relative overflow-hidden rounded-xl border border-border/70">
        <div ref={containerRef} className="h-[420px] w-full" />
        {!libReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary/30 text-xs text-muted-foreground">
            Carregando mapa 3D…
          </div>
        )}
        {selected?.location && (
          <div className="absolute bottom-3 left-3 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {selected.kind === 'headquarters' ? 'Sede' : selected.kind === 'captured' ? 'Capturado' : 'Resumo'}
              </span>
              <button onClick={() => setSelected(null)} className="text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                fechar ✕
              </button>
            </div>
            <p className="mt-2 break-words text-sm font-semibold text-foreground">{selected.fullText}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {selected.location.lat.toFixed(5)}, {selected.location.lng.toFixed(5)}
            </p>
          </div>
        )}
      </div>
    </LeadSection>
  );
}
