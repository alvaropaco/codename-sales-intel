// =============================================================================
// geocoding.js
// Geocodificação de endereços de leads (feature 002 — Perfil Completo do Lead
// Enriquecido). Fontes, em ordem: BrasilAPI /cep/v2 (já usada pela plataforma,
// coordenadas sem chave de API) e Nominatim/OSM (fallback por texto, máx.
// 1 req/s — protegido pelo limite por request e pelo cache persistente).
//
// O resultado é cacheado em `GeocodeCache` (TTL 90 dias) chaveado pelo
// endereço normalizado: endereço não é dado de tenant, o masking por plano
// acontece na leitura (collectLeadAddresses — trial recebe só o resumo
// cidade/UF, coerente com cnpjRawData → null do plan-masking).
// =============================================================================

const crypto = require('crypto');

const GEOCODE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias (data-model.md)
const MAX_NEW_GEOCODES_PER_REQUEST = 1; // respeita a política do Nominatim

const BRASILAPI_CEP_URL = 'https://brasilapi.com.br/api/cep/v2';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// ── Normalização ────────────────────────────────────────────────────────────

function stripAccents(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Chave de dedup/cache: minúsculas, sem acento, sem pontuação, espaços colapsados. */
function normalizeKey(text) {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Id curto e determinístico do endereço (contrato: sha1-8 do normalizedKey). */
function hashKey(normalizedKey) {
  return crypto.createHash('sha1').update(normalizedKey).digest('hex').slice(0, 8);
}

// ── Extração dos endereços do lead ──────────────────────────────────────────

/**
 * Extrai os endereços do prospect. Premium: sede (cnpjRawData da RFB) + fatos
 * capturados do grafo (graphAddressLabels). Ambos os planos: resumo comercial
 * (city/state). O plano é verificado AQUI de novo — defesa em profundidade:
 * mesmo que cnpjRawData vaze no objeto do trial, endereço de rua não sai.
 */
function extractLeadAddresses(prospect, graphAddressLabels = []) {
  const rows = [];
  const raw = prospect.cnpjRawData;
  if (raw && typeof raw === 'object') {
    const street = [raw.logradouro, raw.numero].filter(Boolean).join(', ');
    const cep = raw.cep ? String(raw.cep).replace(/\D/g, '') : null;
    if (street) {
      // formato do contrato: "Rua X, 123 — Bairro, Município/UF — 00000-000"
      const cityUf = [raw.municipio || prospect.city, raw.uf || prospect.state]
        .filter(Boolean)
        .join('/');
      const tail = [
        raw.bairro ? `${raw.bairro}${cityUf ? `, ${cityUf}` : ''}` : cityUf,
        cep ? cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : null,
      ].filter(Boolean);
      const fullText = [street, ...tail].filter(Boolean).join(' — ');
      rows.push({
        kind: 'headquarters',
        source: 'cnpj_raw',
        confidence: null,
        fullText,
        normalizedKey: normalizeKey(fullText),
        cep,
        city: raw.municipio || prospect.city || null,
        state: raw.uf || prospect.state || null,
      });
    }
  }
  for (const label of graphAddressLabels) {
    const text = String(label || '').trim();
    if (!text) continue;
    const normalizedKey = normalizeKey(text);
    if (rows.some((r) => r.normalizedKey === normalizedKey)) continue;
    rows.push({
      kind: 'captured',
      source: 'graph_fact',
      confidence: null,
      fullText: text,
      normalizedKey,
      cep: null,
      city: prospect.city || null,
      state: prospect.state || null,
    });
  }
  if (prospect.city || prospect.state) {
    const fullText = [prospect.city, prospect.state].filter(Boolean).join(', ');
    rows.push({
      kind: 'city',
      source: 'prospect_summary',
      confidence: null,
      fullText,
      normalizedKey: normalizeKey(fullText),
      cep: null,
      city: prospect.city || null,
      state: prospect.state || null,
    });
  }
  return rows;
}

// ── Fontes externas ─────────────────────────────────────────────────────────

async function geocodeByCep(cep, fetchImpl) {
  if (!cep) return null;
  try {
    const res = await fetchImpl(`${BRASILAPI_CEP_URL}/${cep}`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return null;
    const coords = json.location?.coordinates;
    if (coords?.latitude && coords?.longitude) {
      return {
        lat: parseFloat(coords.latitude),
        lng: parseFloat(coords.longitude),
        // centroide do CEP (nível de rua não garantido pela fonte)
        precision: 'zip',
        source: 'brasilapi',
      };
    }
    const cityCoords = json.location?.city?.coordinates;
    if (cityCoords?.latitude && cityCoords?.longitude) {
      return {
        lat: parseFloat(cityCoords.latitude),
        lng: parseFloat(cityCoords.longitude),
        precision: 'city',
        source: 'brasilapi',
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function geocodeByText({ fullText, kind }, fetchImpl) {
  if (!fullText) return null;
  try {
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      countrycodes: 'br',
      q: `${fullText}, Brasil`,
    });
    const res = await fetchImpl(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'b2base-platform/1.0 (lead detail geocoding)' },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(json) || json.length === 0) return null;
    const hit = json[0];
    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      precision: kind === 'city' ? 'city' : 'street',
      source: 'nominatim',
    };
  } catch {
    return null;
  }
}

async function geocode(input, { fetchImpl }) {
  const byCep = await geocodeByCep(input.cep, fetchImpl);
  if (byCep) return byCep;
  return geocodeByText(input, fetchImpl);
}

// ── Composição da resposta ──────────────────────────────────────────────────

function isFresh(row) {
  return row && Date.now() - new Date(row.fetchedAt).getTime() < GEOCODE_TTL_MS;
}

/**
 * Monta o corpo de GET /api/prospects/:id/addresses (contracts/api.md).
 * Dedup por normalizedKey mantendo o endereço de maior prioridade
 * (headquarters → captured → city); cache-first com limite de geocodes novos
 * por request; falha externa degrada com `location: null` (nunca 500).
 */
async function collectLeadAddresses({
  prospect,
  plan,
  prisma,
  fetchImpl,
  graphAddressLabels = [],
}) {
  const premium = plan === 'premium';
  const all = extractLeadAddresses(premium ? prospect : { ...prospect, cnpjRawData: null }, premium ? graphAddressLabels : []);

  // dedup preservando a primeira ocorrência (ordem de prioridade do extract)
  const seen = new Set();
  const candidates = all.filter((row) => {
    if (seen.has(row.normalizedKey)) return false;
    seen.add(row.normalizedKey);
    return true;
  });

  let newGeocodes = 0;
  const addresses = [];
  for (const row of candidates) {
    let location = null;
    try {
      const cached = await prisma.geocodeCache.findUnique({
        where: { normalizedKey: row.normalizedKey },
      });
      if (isFresh(cached)) {
        location = { lat: cached.lat, lng: cached.lng, precision: cached.precision };
      } else if (newGeocodes < MAX_NEW_GEOCODES_PER_REQUEST) {
        const result = await geocode(row, { fetchImpl });
        newGeocodes += 1;
        if (result) {
          location = { lat: result.lat, lng: result.lng, precision: result.precision };
          await prisma.geocodeCache.upsert({
            where: { normalizedKey: row.normalizedKey },
            create: {
              normalizedKey: row.normalizedKey,
              lat: result.lat,
              lng: result.lng,
              precision: result.precision,
              source: result.source,
              fetchedAt: new Date(),
            },
            update: {
              lat: result.lat,
              lng: result.lng,
              precision: result.precision,
              source: result.source,
              fetchedAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      // cache/PG indisponível não pode derrubar a tela do lead
      console.error('[geocoding] erro de cache ao processar endereço:', err.message);
      location = null;
    }
    addresses.push({
      id: hashKey(row.normalizedKey),
      fullText: row.fullText,
      kind: row.kind,
      source: row.source,
      confidence: row.confidence,
      location: location
        ? { lat: location.lat, lng: location.lng, precision: location.precision }
        : null,
    });
  }

  return {
    prospectId: prospect.id,
    dataRestricted: !premium,
    addresses,
  };
}

module.exports = {
  normalizeKey,
  hashKey,
  extractLeadAddresses,
  geocode,
  geocodeByCep,
  geocodeByText,
  collectLeadAddresses,
  GEOCODE_TTL_MS,
  MAX_NEW_GEOCODES_PER_REQUEST,
};
