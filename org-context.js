/**
 * org-context.js — contexto de negócio da ORG cliente para os prompts de IA.
 *
 * Fonte dos pilares 1 (empresa) e 2 (proposta da campanha):
 *   1. Empresa: CommercialSettings da org — o que vende, modelo de negócio,
 *      diferenciais, site/CTA. O que não estiver preenchido a IA NÃO afirma.
 *   2. Campanha: objetivo/oferta/ctaUrl da campanha de origem da conversa.
 *
 * Substitui o uso global de b2base-context.js nos prompts: aquele arquivo
 * descrevia o produto B2Base para TODAS as orgs — para um cliente que não é a
 * B2Base, os agentes vendiam o produto errado e mandavam o lead pro site
 * errado. Aqui cada org fala do SEU negócio; org sem contexto configurado
 * recebe um bloco de degradação honesta (nada de invenção).
 */
const { asStringList } = require('./whatsapp-utils');

function clean(value) {
  const s = String(value || '').trim();
  return s || null;
}

/**
 * Monta o contexto da org a partir de Organization + CommercialSettings.
 * Função pura (fácil de testar); use loadOrgContext para buscar no banco.
 */
function buildOrgContext({ orgName, settings } = {}) {
  const s = settings || {};
  const differentiators = asStringList(s.differentiators);
  const nome = clean(s.companyName) || clean(orgName) || null;
  const site = clean(s.websiteUrl);
  const oQueE = clean(s.productDescription);
  const propostaValor = clean(s.valueProposition);

  const ctx = {
    orgId: s.orgId || null,
    nome,
    site,
    oQueE,
    modeloNegocio: clean(s.businessModel),
    propostaValor,
    diferenciais: differentiators,
    ctaGoal: clean(s.ctaGoal),
    tom: clean(s.toneNotes),
    segmentosAlvo: asStringList(s.targetSegments),
    regioesAlvo: asStringList(s.targetLocations),
    // Configurado = há algo substancial sobre o negócio (produto ou proposta).
    configured: Boolean(oQueE || propostaValor),
  };

  /**
   * Bloco "== CONTEXTO DA NOSSA EMPRESA ==" para os prompts. Sem contexto
   * configurado, devolve instrução de degradação honesta — nunca o contexto
   * de outra empresa (ex.: B2Base).
   */
  ctx.renderForPrompt = function renderForPrompt() {
    if (!ctx.configured) {
      return [
        '(NÃO CONFIGURADO — o cliente não descreveu o próprio negócio na plataforma.)',
        'NÃO invente nome de empresa, produto, serviço, diferenciais, site ou preços.',
        'Seja genérico e honesto: fale de forma simples, entenda a necessidade do lead',
        'e proponha um retorno/conversa. Se o lead perguntar detalhes que você não sabe,',
        'diga que vai confirmar.',
      ].join('\n');
    }
    const lines = [`EMPRESA: ${ctx.nome || '(nome não informado)'}`];
    if (ctx.oQueE) lines.push(`O QUE FAZ/VENDE: ${ctx.oQueE}`);
    if (ctx.modeloNegocio) lines.push(`MODELO DE NEGÓCIO: ${ctx.modeloNegocio}`);
    if (ctx.propostaValor) lines.push(`PROPOSTA DE VALOR: ${ctx.propostaValor}`);
    if (ctx.diferenciais.length) lines.push(`DIFERENCIAIS: ${ctx.diferenciais.join('; ')}`);
    if (ctx.site) lines.push(`SITE: ${ctx.site}`);
    if (ctx.segmentosAlvo.length) lines.push(`SEGMENTOS-ALVO: ${ctx.segmentosAlvo.join('; ')}`);
    if (ctx.regioesAlvo.length) lines.push(`REGIÕES-ALVO: ${ctx.regioesAlvo.join('; ')}`);
    if (ctx.tom) lines.push(`TOM DE VOZ: ${ctx.tom}`);
    return lines.join('\n');
  };

  return ctx;
}

/**
 * CTA efetivo da conversa: campanha (ctaUrl/objective) > org (ctaGoal/site)
 * > genérico honesto. Retorna texto de instrução para o prompt.
 */
function effectiveCtaText(orgCtx, campaign) {
  const parts = [];
  const campaignCta = campaign && clean(campaign.ctaUrl);
  const campaignObjective = campaign && clean(campaign.objective);

  if (campaignObjective) {
    parts.push(`Objetivo desta campanha: ${campaignObjective}. Conduza a conversa para ele.`);
  }
  if (campaignCta) {
    parts.push(`Quando houver abertura, conduza o lead a ${campaignCta}.`);
  } else if (orgCtx && orgCtx.ctaGoal) {
    parts.push(orgCtx.ctaGoal);
  } else if (orgCtx && orgCtx.site) {
    parts.push(
      `Quando houver abertura natural, conduza o lead a acessar ${orgCtx.site}` +
        ' (próximo passo da jornada).'
    );
  }
  if (!parts.length) {
    parts.push(
      'Conduza o lead ao próximo passo natural (agendar uma conversa ou resposta direta);' +
        ' NUNCA invente links.'
    );
  }
  return parts.join(' ');
}

/** Nome público do vendedor (assinatura/identidade nos prompts). */
function sellerIdentity(orgCtx) {
  return (orgCtx && orgCtx.nome) || 'nossa empresa';
}

/**
 * Bloco "== PROPOSTA DA CAMPANHA ==" (pilar 2). Null se não houver campanha.
 */
function renderCampaignBlock(campaign) {
  if (!campaign) return null;
  const lines = ['== PROPOSTA DA CAMPANHA DE ORIGEM =='];
  if (clean(campaign.name)) lines.push(`Campanha: ${clean(campaign.name)}`);
  if (clean(campaign.objective)) lines.push(`Objetivo: ${clean(campaign.objective)}`);
  if (clean(campaign.offer)) lines.push(`Oferta/o que oferecer: ${clean(campaign.offer)}`);
  if (clean(campaign.ctaUrl)) lines.push(`Ação desejada: conduzir a ${clean(campaign.ctaUrl)}`);
  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Busca e monta o contexto da org no banco (1 ida: org + settings).
 */
async function loadOrgContext(prisma, orgId) {
  const [org, settings] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.commercialSettings.findUnique({ where: { orgId } }),
  ]);
  const ctx = buildOrgContext({ orgName: org ? org.name : null, settings: settings || null });
  ctx.rawSettings = settings || null;
  return ctx;
}

module.exports = {
  buildOrgContext,
  loadOrgContext,
  effectiveCtaText,
  sellerIdentity,
  renderCampaignBlock,
};
