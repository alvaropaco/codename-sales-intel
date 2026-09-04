/**
 * b2base-context.js — conhecimento estruturado da plataforma B2Base para os
 * prompts dos agentes de IA (reengajamento, outreach, etc).
 *
 * É a única fonte de "escopo do produto" que a IA recebe: tudo que não estiver
 * aqui é considerado desconhecido e NÃO pode ser afirmado numa mensagem
 * (preço, prazo, promessa de resultado, integrações, parcerias...).
 *
 * Atualizar este arquivo sempre que o posicionamento/funcionalidades mudarem.
 */

const B2BASE_CONTEXT = {
  nome: 'B2Base',
  site: 'https://b2base.net',
  oQueE:
    'Plataforma B2B de inteligência de dados de empresas brasileiras (base CNPJ da Receita Federal) ' +
    'para prospecção: encontra empresas com o perfil ideal do cliente, enriquece com contatos e ' +
    'dados comerciais e ajuda a transformar isso em oportunidades de venda.',
  publico:
    'Times comerciais, SDRs e empresários que fazem prospecção ativa B2B e perdem tempo ' +
    'procurando empresas e contatos certos em planilhas e sites.',
  comoFunciona: [
    'Descoberta: busca empresas por segmento (CNAE), cidade/estado, porte e situação cadastral.',
    'Enriquecimento: contatos (telefone/e-mail), sócios, dados financeiros estimados e score de oportunidade.',
    'Prospecção: abordagem multicanal (e-mail e WhatsApp) com acompanhamento do funil em um só lugar.',
  ],
  casosDeUso: [
    'Montar listas de empresas com segmento/região específicos para prospecção',
    'Encontrar os responsáveis e canais de contato de cada empresa',
    'Priorizar leads com maior probabilidade de fechar (score de oportunidade)',
  ],
  diferenciais: [
    'Base completa de empresas brasileiras atualizada a partir dos dados abertos da Receita Federal',
    'Filtros que combinam segmento + geografia + porte para achar o "perfil de cliente ideal"',
    'Do dado bruto ao contato: enriquecimento automático, sem trabalho manual de planilha',
  ],
  // Regras negativas — a IA NUNCA pode afirmar isto (não temos o dado aqui).
  naoAFirmar: [
    'preços, planos, condições, descontos ou promoções',
    'prazos, garantias ou promessa de resultado ("você vai vender 3x mais")',
    'integrações, parcerias ou funcionalidades não listadas acima',
    'dados que não estejam no contexto do lead ou da conversa',
  ],
};

/**
 * Renderiza o contexto como texto para embutir no prompt do LLM.
 */
function renderForPrompt() {
  const c = B2BASE_CONTEXT;
  return [
    `PRODUTO: ${c.nome} (${c.site})`,
    `O QUE É: ${c.oQueE}`,
    `PARA QUEM: ${c.publico}`,
    'COMO FUNCIONA:',
    ...c.comoFunciona.map((l) => `- ${l}`),
    'CASOS DE USO:',
    ...c.casosDeUso.map((l) => `- ${l}`),
    'DIFERENCIAIS:',
    ...c.diferenciais.map((l) => `- ${l}`),
    `NUNCA AFIRME: ${c.naoAFirmar.join('; ')}.`,
  ].join('\n');
}

module.exports = {
  B2BASE_CONTEXT,
  renderForPrompt,
};
