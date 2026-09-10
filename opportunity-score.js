/**
 * Score de oportunidade comercial (0–100), determinístico.
 *
 * Fallback de scoring quando a esteira NATS não roda: calcula a partir dos
 * dados oficiais já obtidos no enriquecimento BrasilAPI + aderência ao perfil
 * comercial da org (CommercialSettings). O valor persistido pela esteira NATS
 * (`commercial_potential` externo) continua tendo precedência — o chamador
 * aplica o guard `enrichmentSource !== 'nats.enrichment'`.
 *
 * Composição (pesos somam 100):
 *   situação cadastral ativa    15
 *   capital social              20
 *   idade do CNPJ               15
 *   porte (MEI/ME/EPP/outros)   10
 *   canais de contato           20  (email 10 + telefone 10)
 *   aderência ao perfil         20  (CNAE 8 · segmento 6 · localização 4 · porte alvo 2)
 * Sem perfil comercial configurado, o bloco de aderência recebe 10 (neutro),
 * em vez de zerar todos os leads de orgs sem onboarding.
 */

const WEIGHTS = {
  active: 15,
  capital: 20,
  age: 15,
  size: 10,
  contacts: 20,
  fit: 20,
};

const NEUTRAL_FIT = 10; // sem perfil configurado

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

/** Situação cadastral ativa: id 2 ("ATIVA") na Receita. */
function isActive(data) {
  if (data == null) return false;
  if (data.situacao_cadastral != null) return Number(data.situacao_cadastral) === 2;
  return /(^|\s)ativa(\s|$)/i.test(String(data.descricao_situacao_cadastral || ''));
}

/** Porte Receita mapeado para o vocabulário do perfil (small|medium|large).
 *  O payload da BrasilAPI varia entre versões: id numérico ("01"=ME, "03"=EPP,
 *  "05"=MEI, "00"=não informado), texto ("MICRO EMPRESA", "EMPRESA DE PEQUENO
 *  PORTE", "DEMAIS") ou objeto { id, descricao }. Normaliza tudo para o id. */
function porteInfo(data) {
  const raw = data?.porte;
  let id = '';
  let desc = '';
  if (typeof raw === 'object' && raw !== null) {
    id = /^\d+$/.test(String(raw.id || '')) ? String(raw.id) : '';
    desc = String(raw.descricao || '');
  } else if (/^\d+$/.test(String(raw || ''))) {
    id = String(raw);
  } else {
    desc = String(raw || '');
  }

  const text = normalizeText(`${id} ${desc}`);
  if (/\b05\b|mei|microempreendedor/.test(text)) id = '05';
  else if (/\b03\b|pequeno porte|epp/.test(text)) id = '03';
  else if (/\b01\b|micro empresa/.test(text)) id = '01';
  else if (!id) id = '00';

  return {
    id: id.padStart(2, '0'),
    size: id === '05' || id === '01' ? 'small' : id === '03' ? 'medium' : 'large',
  };
}

function ageYears(openedAt, data) {
  const raw = openedAt || data?.data_inicio_atividade;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

/** CNAE do lead ∈ CNAEs alvo, tolerante a formatação (compara só dígitos e
 *  aceita prefixo — perfis podem guardar código fiscal de 7 ou 6 dígitos). */
function cnaeMatches(targetCnaes, cnpjData) {
  const leadCnae = digitsOnly(cnpjData?.cnae_fiscal);
  if (!leadCnae) return false;
  return (targetCnaes || []).some((target) => {
    const t = digitsOnly(target);
    if (!t) return false;
    const shorter = Math.min(t.length, leadCnae.length);
    return t.slice(0, shorter) === leadCnae.slice(0, shorter);
  });
}

/** Segmento alvo citado na descrição do CNAE do lead (tokens de ≥5 letras). */
function segmentMatches(targetSegments, industry) {
  const industryText = normalizeText(industry);
  if (!industryText) return false;
  const industryTokens = industryText.split(/\W+/).filter((t) => t.length >= 5);
  return (targetSegments || []).some((segment) => {
    const segText = normalizeText(segment);
    if (!segText) return false;
    return segText.split(/\W+/).some((token) =>
      token.length >= 5 && industryTokens.some((t) => t.startsWith(token) || token.startsWith(t))
    );
  });
}

/** Localização: targetLocations guarda "Cidade - UF"; casa cidade ou UF. */
function locationMatches(targetLocations, prospect) {
  const city = normalizeText(prospect?.city);
  const state = normalizeText(prospect?.state);
  if (!city && !state) return false;
  return (targetLocations || []).some((entry) => {
    const [locCity = '', locState = ''] = normalizeText(entry).split(/\s*[-–]\s*/);
    const cityMatch = city && locCity && (city === locCity || city.includes(locCity) || locCity.includes(city));
    const stateMatch = state && locState && state === locState.slice(0, 2);
    return cityMatch || stateMatch;
  });
}

/**
 * @param {object} input
 * @param {object} input.cnpjData   payload cru da BrasilAPI (ou cnpjRawData)
 * @param {object} input.prospect   linha do Prospect (city/state/industry/cnpjOpenedAt)
 * @param {object|null} input.profile  CommercialSettings da org (ou null)
 * @returns {{ score: number, breakdown: Record<string, number> }}
 */
function computeOpportunityScore({ cnpjData, prospect, profile }) {
  const breakdown = {};

  breakdown.active = isActive(cnpjData) ? WEIGHTS.active : 0;

  const capital = toNumberOrNull(cnpjData?.capital_social) ?? 0;
  breakdown.capital =
    capital >= 1_000_000 ? 20 :
    capital >= 300_000 ? 16 :
    capital >= 100_000 ? 12 :
    capital >= 50_000 ? 8 :
    capital >= 10_000 ? 4 : 0;

  const years = ageYears(prospect?.cnpjOpenedAt, cnpjData);
  breakdown.age =
    years == null ? 0 :
    years >= 10 ? 15 :
    years >= 5 ? 12 :
    years >= 2 ? 8 :
    years >= 1 ? 4 : 2;

  // EPP (03) = 10 · não informado/demais (00) = 7 · ME (01)/MEI (05) = 5
  const porteId = porteInfo(cnpjData).id;
  breakdown.size = porteId === '03' ? 10 : porteId === '00' ? 7 : 5;

  const hasEmail = Boolean(cnpjData?.email || prospect?.cnpjEmail);
  const phones = (Array.isArray(prospect?.cnpjPhones) ? prospect.cnpjPhones : []).length ||
    [cnpjData?.ddd_telefone_1, cnpjData?.ddd_telefone_2, cnpjData?.telefone].filter(Boolean).length;
  breakdown.contacts = (hasEmail ? 10 : 0) + (phones > 0 ? 10 : 0);

  const targetCnaes = profile?.targetCnaes || [];
  const targetSegments = profile?.targetSegments || [];
  const targetLocations = profile?.targetLocations || [];
  const targetSizes = profile?.targetSizes || [];
  const hasProfile = targetCnaes.length > 0 || targetSegments.length > 0 ||
    targetLocations.length > 0 || targetSizes.length > 0;

  if (!hasProfile) {
    breakdown.fit = NEUTRAL_FIT;
  } else {
    const industry = cnpjData?.cnae_fiscal_descricao || prospect?.industry;
    breakdown.fit = Math.min(
      WEIGHTS.fit,
      (cnaeMatches(targetCnaes, cnpjData) ? 8 : 0) +
      (segmentMatches(targetSegments, industry) ? 6 : 0) +
      (locationMatches(targetLocations, prospect) ? 4 : 0) +
      (targetSizes.includes(porteInfo(cnpjData).size) ? 2 : 0)
    );
  }

  const score = Math.max(0, Math.min(100, Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0))));
  return { score, breakdown };
}

module.exports = {
  WEIGHTS,
  NEUTRAL_FIT,
  computeOpportunityScore,
  isActive,
  porteInfo,
  cnaeMatches,
  segmentMatches,
  locationMatches,
};
