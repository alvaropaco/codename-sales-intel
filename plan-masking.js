/**
 * plan-masking — ofuscação parcial de dados sensíveis para o plano trial.
 *
 * Estratégia: o dado real NUNCA sai do servidor para contas trial. No lugar,
 * a API devolve uma versão mascarada que preserva o começo e o final do valor
 * (teaser suficiente para o usuário entender o que existe ali) e marca o
 * objeto com `dataRestricted: true` — o frontend renderiza esse valor com
 * blur + cadeado e CTA de upgrade.
 *
 * Isso substitui a redação antiga (campos nulos): o usuário trial passa a ver
 * QUE existe um email/telefone/sócio, sem receber o valor. O blur é apenas
 * apresentação — a garantia continua sendo server-side (o dado mascarado que
 * chega ao browser já não permite reconstruir o original).
 *
 * Máscaras:
 *   nome/texto   "Marcos da Silva"  → "M••••• da S••a"
 *   email        "joao@empresa.com.br" → "j••••@e••••••.com.br"
 *   telefone     "(11) 99999-8888"  → "(11) •••••-••88"  (DDD + final visíveis)
 *   data         "2010-05-12..."    → "••/••/2010"       (ano visível)
 */

const BULLET = '•';

/**
 * Máscara genérica para nomes/textos: mantém a inicial de cada palavra e a
 * última letra da última palavra. Conectivos curtos (da, de, e...) ficam.
 */
function maskText(value) {
  const str = String(value ?? '').trim();
  if (!str) return str;
  const words = str.split(/\s+/);
  return words
    .map((word, idx) => {
      if (word.length <= 2) return word;
      const isLast = idx === words.length - 1;
      const visible = isLast ? 2 : 1;
      const bullets = Math.min(Math.max(word.length - visible, 2), 6);
      return word[0] + BULLET.repeat(bullets) + (isLast ? word[word.length - 1] : '');
    })
    .join(' ');
}

/**
 * Máscara de email: primeira letra do local, primeira letra do domínio,
 * TLD preservado. "joao.silva@empresa.com.br" → "j•••••••@e••••••.com.br"
 */
function maskEmail(value) {
  const str = String(value ?? '').trim();
  const at = str.indexOf('@');
  if (at < 1) return maskText(str);

  const local = str.slice(0, at);
  const domain = str.slice(at + 1);
  const dot = domain.indexOf('.');
  if (dot < 1) return `${maskText(local)}@${maskText(domain)}`;

  const label = domain.slice(0, dot);
  const tld = domain.slice(dot);
  return (
    local[0] + BULLET.repeat(Math.min(Math.max(local.length - 1, 3), 8)) +
    '@' +
    label[0] + BULLET.repeat(Math.min(Math.max(label.length - 1, 3), 8)) +
    tld
  );
}

/**
 * Máscara de telefone preservando a formatação original: mantém DDD (2
 * primeiros dígitos) e os 2 últimos, mascara o meio.
 * "(11) 99999-8888" → "(11) •••••-••88"
 */
function maskPhone(value) {
  const str = String(value ?? '');
  const digits = str.replace(/\D/g, '');
  if (digits.length < 8) return maskText(str);

  let seen = 0;
  const total = digits.length;
  return str.replace(/\d/g, (digit) => {
    const keep = seen < 2 || seen >= total - 2;
    seen += 1;
    return keep ? digit : BULLET;
  });
}

/**
 * Máscara de data: "••/••/2010" (dia/mês ocultos, ano visível).
 * Retorna string — a UI deve exibir o valor como veio quando restrito,
 * sem re-formatar com new Date().
 */
function maskDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = Number.isFinite(date.getTime()) ? date.getFullYear() : null;
  return year ? `${BULLET}${BULLET}/${BULLET}${BULLET}/${year}` : `${BULLET}${BULLET}/${BULLET}${BULLET}/${BULLET}${BULLET}${BULLET}${BULLET}`;
}

// ─── Aplicação por campo (shapes Prospect e EnrichedCnpjContact) ─────

function _maskPhonesArray(value) {
  if (!Array.isArray(value)) return value;
  return value.map((phone) => (phone != null ? maskPhone(phone) : phone));
}

function _maskPartnersArray(value) {
  if (!Array.isArray(value)) return value;
  // Mantém qualificação (cargo genérico, não é PII); mascara o nome.
  return value.map((partner) =>
    partner && typeof partner === 'object'
      ? { ...partner, name: partner.name ? maskText(partner.name) : partner.name }
      : partner
  );
}

// Campos sensíveis → masker. Aplica-se tanto ao shape do model Prospect
// (cnpj*) quanto ao shape de formatEnrichedProspect (email/phones/partners).
const SENSITIVE_FIELD_MASKERS = {
  cnpjEmail: maskEmail,
  email: maskEmail,
  cnpjPhones: _maskPhonesArray,
  phones: _maskPhonesArray,
  cnpjPartners: _maskPartnersArray,
  partners: _maskPartnersArray,
  cnpjOpenedAt: maskDate,
  openedAt: maskDate,
  cnpjLegalNature: maskText,
  legalNature: maskText,
  // Payload bruto (contém logradouro/endereço completo): não há como
  // mascarar um blob — continua não sendo entregue ao trial.
  cnpjRawData: () => null,
};

/**
 * Mascara os campos sensíveis de um prospect/contato (trial).
 * Retorna objeto novo; premium devolve intacto. Marca `dataRestricted`.
 */
function maskProspectForTrial(item) {
  if (item === null || typeof item !== 'object') return item;
  const out = { ...item };
  for (const [field, masker] of Object.entries(SENSITIVE_FIELD_MASKERS)) {
    if (field in out && out[field] != null) {
      out[field] = masker(out[field]);
    }
  }
  out.dataRestricted = true;
  return out;
}

/**
 * Mascara o grafo de enriquecimento (view v_company_graph) para trial:
 * - profile.contact_points[].value → máscara por tipo (phone/email/outros)
 * - profile.people[].label → maskText (nomes do quadro societário)
 * - profile.raw_facts → removido (payload bruto com endereço/contatos)
 */
function maskCompanyGraphForTrial(graphData) {
  if (graphData === null || typeof graphData !== 'object') return graphData;
  const out = { ...graphData };
  const profile = out.profile ? { ...out.profile } : {};

  if (Array.isArray(profile.contact_points)) {
    profile.contact_points = profile.contact_points.map((cp) => {
      if (!cp || typeof cp !== 'object') return cp;
      const masker = cp.type === 'phone' ? maskPhone : cp.type === 'email' ? maskEmail : maskText;
      return { ...cp, value: cp.value != null ? masker(cp.value) : cp.value };
    });
  }

  if (Array.isArray(profile.people)) {
    profile.people = profile.people.map((person) =>
      person && typeof person === 'object'
        ? { ...person, label: person.label ? maskText(person.label) : person.label }
        : person
    );
  }

  if ('raw_facts' in profile) {
    profile.raw_facts = null;
  }

  out.profile = profile;
  out.dataRestricted = true;
  return out;
}

/**
 * Sanitiza payloads VINDOS do client para persistência quando o plano é
 * trial: a UI só conhece valores mascarados, então o import não deve
 * gravá-los como se fossem reais (senão o banco acumula "j••••@e•••.com").
 */
function stripMaskedIncomingFields(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  for (const field of ['email', 'openingDate', 'legalNature']) {
    if (out[field] != null) out[field] = null;
  }
  return out;
}

module.exports = {
  maskText,
  maskEmail,
  maskPhone,
  maskDate,
  maskProspectForTrial,
  maskCompanyGraphForTrial,
  stripMaskedIncomingFields,
};
