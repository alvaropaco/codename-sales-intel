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
 *   situação cadastral ativa    10
 *   capital social              15  (>= R$ 50 mil já pontua; abaixo disso pouco)
 *   idade do CNPJ               10
 *   porte (MEI/ME/EPP/outros)    5
 *   canais de contato           15  (email 8 + telefone 7 — sem telefone, perde)
 *   presença na internet        15  (site 6 · domínio do e-mail 5 · social/tech 4;
 *                                    domínio de contabilidade (@contabilizei.com.br
 *                                    e afins) pontua 0; provedor grátis 1; próprio 5)
 *   estrutura societária        15  (>1 sócio 5 · nome do sócio na empresa 5 ·
 *                                    nome fantasia distinto dos sócios 5)
 *   aderência ao perfil         15  (CNAE 6 · segmento 5 · localização 3 · porte alvo 1)
 *
 * Sinais desconhecidos (ex.: site/social só existem no summary do pipeline
 * NATS) recebem valor neutro (metade do bloco), em vez de zerar leads que
 * apenas não passaram pela esteira. Sem perfil comercial configurado, o bloco
 * de aderência recebe 8 (neutro).
 */

const WEIGHTS = {
  active: 10,
  capital: 15,
  age: 10,
  size: 5,
  contacts: 15,
  presence: 15,
  structure: 15,
  fit: 15,
};

const NEUTRAL_FIT = 8; // sem perfil configurado

// Provedores gratuitos: e-mail existe, mas não indica marca digital própria.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com',
  'outlook.com.br', 'live.com', 'live.com.br', 'msn.com', 'yahoo.com',
  'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com', 'bol.com.br',
  'uol.com.br', 'terra.com.br', 'ig.com.br', 'r7.com',
]);

// Contabilidade online que registra CNPJ em massa: o e-mail do lead fica no
// domínio da contadora (ex.: @contabilizei.com.br), não da empresa.
const ACCOUNTING_EMAIL_DOMAINS = new Set([
  'contabilizei.com.br',
  'contabilix.com.br',
  'agilizacontabilidade.com',
  'supercontabilidade.com',
]);

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

/**
 * Classifica o domínio do e-mail do lead:
 *   'own'        domínio próprio (não é provedor grátis nem contabilidade)
 *   'free'       provedor gratuito (gmail, hotmail, uol…)
 *   'accounting' domínio de contabilidade online (contabilizei etc.)
 *   null         sem e-mail utilizável
 * Regex pega variações ("contabilidadeemfoco.com", "@meucontador.com.br").
 */
function classifyEmailDomain(email) {
  const raw = String(email || '').trim().toLowerCase();
  const domain = raw.includes('@') ? raw.split('@').pop() : raw;
  if (!domain || !domain.includes('.') || /\s/.test(domain)) return null;
  const bare = domain.replace(/^www\./, '');
  if (ACCOUNTING_EMAIL_DOMAINS.has(bare)) return 'accounting';
  if (/contab|contador/.test(bare)) return 'accounting';
  if (FREE_EMAIL_DOMAINS.has(bare)) return 'free';
  return 'own';
}

const PERSON_NAME_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const COMPANY_SUFFIX_TOKENS = new Set(['ltda', 'ltd', 'me', 'mei', 'epp', 'eireli', 'sa', 's', 'a', 'slu']);

/** Tokens comparáveis de um nome (pessoa ou empresa), sem conectores/sufixos. */
function nameTokens(value) {
  return normalizeText(value)
    .split(/\W+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !PERSON_NAME_STOPWORDS.has(t) && !COMPANY_SUFFIX_TOKENS.has(t));
}

/** Nomes dos sócios: prefere cnpjPartners persistido, cai para o qsa cru. */
function partnerNames(cnpjData, prospect) {
  const stored = Array.isArray(prospect?.cnpjPartners) ? prospect.cnpjPartners : [];
  const fromStored = stored.map((p) => p?.name || p?.nome).filter(Boolean);
  if (fromStored.length > 0) return fromStored;
  const qsa = Array.isArray(cnpjData?.qsa) ? cnpjData.qsa : [];
  return qsa.map((p) => p?.nome_socio || p?.nome).filter(Boolean);
}

/** Algum sócio tem o nome citado no texto (razão social ou nome fantasia)?
 *  Casa por token: 2+ tokens do sócio presentes bastam; sócio com nome de
 *  um token só casa se ele aparecer inteiro. */
function partnerNameInText(text, names) {
  const textTokens = new Set(nameTokens(text));
  if (textTokens.size === 0) return false;
  return names.some((name) => {
    const tokens = nameTokens(name);
    if (tokens.length === 0) return false;
    const matched = tokens.filter((t) => textTokens.has(t)).length;
    return matched >= Math.min(2, tokens.length);
  });
}

/** Bloco presença na internet (0–15). Sinais do pipeline NATS desconhecidos
 *  recebem valor neutro; website_active=false e domínio de contabilidade
 *  pontuam zero de fato. */
function presenceBreakdown({ email, summary }) {
  // site ativo: 6 · desconhecido: 3 · sem site (pipeline detectou): 0
  const websiteActive = summary?.website_active;
  const website = websiteActive === true ? 6 : websiteActive === false ? 0 : 3;

  // domínio: próprio 5 · grátis 1 · contabilidade 0 · desconhecido 2
  let domainClass = classifyEmailDomain(email);
  if (domainClass == null && summary?.corporate_email === true) domainClass = 'own';
  const domain = domainClass === 'own' ? 5
    : domainClass === 'accounting' ? 0
    : domainClass === 'free' ? 1
    : 2;

  // redes sociais/tecnologias/pessoas detectadas: quanto mais, mais pontos
  let social = 2;
  if (summary) {
    const detected = [summary.social_platforms, summary.tech_count, summary.people]
      .map(toNumberOrNull)
      .filter((n) => n != null);
    if (detected.length > 0) {
      const positives = detected.filter((n) => n > 0).length;
      social = positives === detected.length ? 4 : positives > 0 ? 2 : 0;
    }
  }

  return { website, domain, social, total: website + domain + social };
}

/** Bloco estrutura societária (0–15). */
function structureBreakdown({ names, companyName, tradeName }) {
  const known = names.length > 0;

  // >1 sócio: 5 · sócio único ou QSA desconhecido: 2
  const multiPartner = !known ? 2 : names.length > 1 ? 5 : 2;

  // razão social/nome fantasia citam o sócio: 5 · desconhecido: 2 · não: 0
  const named = !known ? 2
    : partnerNameInText(`${companyName || ''} ${tradeName || ''}`, names) ? 5 : 0;

  // nome fantasia próprio, distinto do nome dos sócios: 5 · senão: 0
  const distinctBrand = tradeName && !(known && partnerNameInText(tradeName, names)) ? 5 : 0;

  return { multiPartner, named, distinctBrand, total: multiPartner + named + distinctBrand };
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
 * @param {object} input.prospect   linha do Prospect (city/state/industry/cnpjOpenedAt/
 *                                  cnpjEmail/cnpjPhones/cnpjPartners/tradeName/companyName/
 *                                  enrichmentSummary)
 * @param {object|null} input.profile  CommercialSettings da org (ou null)
 * @returns {{ score: number, breakdown: Record<string, number> }}
 */
function computeOpportunityScore({ cnpjData, prospect, profile }) {
  const breakdown = {};

  breakdown.active = isActive(cnpjData) ? WEIGHTS.active : 0;

  const capital = toNumberOrNull(cnpjData?.capital_social) ?? 0;
  breakdown.capital =
    capital >= 1_000_000 ? 15 :
    capital >= 300_000 ? 13 :
    capital >= 100_000 ? 10 :
    capital >= 50_000 ? 7 :
    capital >= 10_000 ? 4 : 0;

  const years = ageYears(prospect?.cnpjOpenedAt, cnpjData);
  breakdown.age =
    years == null ? 0 :
    years >= 10 ? 10 :
    years >= 5 ? 8 :
    years >= 2 ? 5 :
    years >= 1 ? 3 : 1;

  // EPP (03) = 5 · não informado/demais (00) = 3 · ME (01)/MEI (05) = 2
  const porte = porteInfo(cnpjData);
  breakdown.size = porte.id === '03' ? 5 : porte.id === '00' ? 3 : 2;

  const hasEmail = Boolean(cnpjData?.email || prospect?.cnpjEmail);
  const phones = (Array.isArray(prospect?.cnpjPhones) ? prospect.cnpjPhones : []).length ||
    [cnpjData?.ddd_telefone_1, cnpjData?.ddd_telefone_2, cnpjData?.telefone].filter(Boolean).length;
  breakdown.contacts = (hasEmail ? 8 : 0) + (phones > 0 ? 7 : 0);

  const summary = prospect?.enrichmentSummary && typeof prospect.enrichmentSummary === 'object'
    ? prospect.enrichmentSummary
    : null;
  breakdown.presence = presenceBreakdown({
    email: cnpjData?.email || prospect?.cnpjEmail,
    summary,
  }).total;

  breakdown.structure = structureBreakdown({
    names: partnerNames(cnpjData, prospect),
    companyName: cnpjData?.razao_social || prospect?.companyName,
    tradeName: cnpjData?.nome_fantasia || prospect?.tradeName,
  }).total;

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
      (cnaeMatches(targetCnaes, cnpjData) ? 6 : 0) +
      (segmentMatches(targetSegments, industry) ? 5 : 0) +
      (locationMatches(targetLocations, prospect) ? 3 : 0) +
      (targetSizes.includes(porte.size) ? 1 : 0)
    );
  }

  const score = Math.max(0, Math.min(100, Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0))));
  return { score, breakdown };
}


// ---------------------------------------------------------------------------
// SCORE DE SINAIS — pontua o lead com QUALQUER sinal disponível, mesmo sem
// CNPJ (leads importados). É recalculado no fim de cada esteira de
// enriquecimento: sobe com identificador, contatos, presença digital e
// momentum; desce com indícios jurídicos. O commercial_potential do worker
// NATS (quando existe) tem precedência sobre este score.
// ---------------------------------------------------------------------------

const SIGNAL_WEIGHTS = {
  identificador: 22,  // CNPJ resolvido e validado
  localizacao: 10,    // cidade (5) + UF (5)
  setor: 8,           // segmento/atividade conhecido
  contatos: 26,       // e-mail (12) + telefone (8) + pessoa de contato (6)
  digital: 22,        // domínio (10) + LinkedIn (8) + Facebook (2) + Twitter (2)
  porte: 8,           // funcionários (4) + faturamento estimado (4)
  momentum: 4,        // notícias/recentes (+4); indícios jurídicos (−5)
};

function computeSignalScore(prospect) {
  const s = prospect.enrichmentSummary || {};
  const le = s.lead_enrichment || {};
  const company = le.company || {};

  const hasPhones = Array.isArray(prospect.cnpjPhones) && prospect.cnpjPhones.length > 0;
  const breakdown = {
    identificador: prospect.cnpj ? SIGNAL_WEIGHTS.identificador : 0,
    localizacao: (prospect.city ? 5 : 0) + (prospect.state ? 5 : 0),
    setor: prospect.industry ? SIGNAL_WEIGHTS.setor : 0,
    contatos:
      (prospect.cnpjEmail ? 12 : 0) +
      (hasPhones ? 8 : 0) +
      (prospect.contactName ? 6 : 0),
    digital:
      (prospect.domain ? 10 : 0) +
      ((le.linkedin || company.linkedin_url) ? 8 : 0) +
      (company.facebook_url ? 2 : 0) +
      (company.twitter_url ? 2 : 0),
    porte: (prospect.employees ? 4 : 0) + (prospect.revenueEstimate ? 4 : 0),
    momentum:
      (Array.isArray(le.news) && le.news.length ? SIGNAL_WEIGHTS.momentum : 0) -
      (Array.isArray(le.legal) && le.legal.length ? 5 : 0),
  };

  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)));
  return { score, breakdown };
}

/**
 * Recalcula e grava o score de um prospect com base nos sinais atuais
 * (chamar no FIM de cada esteira de enriquecimento). O breakdown vai para
 * enrichmentSummary.score_breakdown para a UI explicar a nota.
 */
async function recalcLeadScore(prisma, prospectOrId) {
  const p = typeof prospectOrId === 'string'
    ? await prisma.prospect.findUnique({ where: { id: prospectOrId } })
    : prospectOrId;
  if (!p) return null;

  const { score, breakdown } = computeSignalScore(p);
  // Feature 005 (FR-008): com análise profunda vigente (verdict preenchido),
  // o score oficial é o da IA — o determinístico NÃO pode sobrescrevê-lo.
  // O breakdown continua sendo gravado como evidência de referência.
  const data = {
    enrichmentSummary: { ...(p.enrichmentSummary || {}), score_breakdown: breakdown },
  };
  if (!p.verdict) {
    data.opportunityScore = score;
  }
  await prisma.prospect.update({
    where: { id: p.id },
    data,
  });
  return { score, breakdown };
}

module.exports = {
  WEIGHTS,
  NEUTRAL_FIT,
  FREE_EMAIL_DOMAINS,
  ACCOUNTING_EMAIL_DOMAINS,
  computeOpportunityScore,
  isActive,
  porteInfo,
  cnaeMatches,
  segmentMatches,
  locationMatches,
  classifyEmailDomain,
  nameTokens,
  partnerNames,
  partnerNameInText,
  presenceBreakdown,
  structureBreakdown,
  computeSignalScore,
  recalcLeadScore,
  SIGNAL_WEIGHTS,
};
