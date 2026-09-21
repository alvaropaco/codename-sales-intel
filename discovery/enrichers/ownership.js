// =============================================================================
// discovery/enrichers/ownership.js — OwnershipProfile (T026/T036, US4).
//
// Sócios, diretores e representantes como entidades person com relações
// TEMPORAIS quando a fonte traz datas (plan.md, Data Integrity Rules).
// Pessoa com múltiplos vínculos vira UMA entidade com N relações (edge case).
// =============================================================================

const normalizer = require('../normalizer');
const { relationshipConfidence } = require('../confidence');

const RELATION_BY_ROLE = {
  sócio: 'HAS_PARTNER',
  socio: 'HAS_PARTNER',
  partner: 'HAS_PARTNER',
  administrador: 'HAS_DIRECTOR',
  diretor: 'HAS_DIRECTOR',
  director: 'HAS_DIRECTOR',
  representante: 'HAS_REPRESENTATIVE',
  representative: 'HAS_REPRESENTATIVE',
};

function relationTypeForRole(role) {
  return RELATION_BY_ROLE[String(role || '').toLowerCase()] || 'RELATED_TO';
}

/**
 * Normaliza a lista de vínculos do provider em observações person + relação.
 * persons: [{ name, role, cnpj?, ownershipPct?, effectiveDate? }]
 */
function ownershipObservations(persons = [], { confidence = 0.55, sourceProvider = 'cnpj-mcp' } = {}) {
  const seen = new Map(); // personKey → observação (pessoa única, vínculos múltiplos)
  const out = [];
  for (const person of persons) {
    const name = String(person.name || '').trim();
    if (!name) continue;
    const personKey = normalizer.canonicalKey(person.cnpj ? 'company' : 'person', person.cnpj || name);
    if (!personKey) continue;
    const rel = {
      entityType: person.cnpj ? 'company' : 'person',
      value: person.cnpj || name,
      displayName: name,
      type: relationTypeForRole(person.role),
      rel: {
        role: person.role || null,
        ownershipPct: person.ownershipPct != null ? Number(person.ownershipPct) : null,
        effectiveDate: person.effectiveDate || null,
      },
    };
    if (seen.has(personKey)) {
      seen.get(personKey).related.push(rel);
      continue;
    }
    const obs = {
      entityType: person.cnpj ? 'company' : 'person',
      value: person.cnpj || name,
      displayName: name,
      attributes: { roles: [person.role || null].filter(Boolean) },
      evidenceType: 'official_registry',
      confidence,
      sourceProvider,
      sourceUrl: null,
      sourceRef: personKey,
      observedAt: person.effectiveDate ? new Date(person.effectiveDate) : null,
      related: [rel],
    };
    seen.set(personKey, obs);
    out.push(obs);
  }
  return out;
}

/**
 * OwnershipProfile para a API: person entities ligadas à company + evidências.
 */
function buildOwnershipProfile(companyEntityId, relationships = [], entityById = new Map()) {
  const relations = relationships.filter((rel) =>
    ['HAS_PARTNER', 'HAS_DIRECTOR', 'HAS_REPRESENTATIVE', 'OWNS', 'RELATED_TO'].includes(rel.type)
  );
  const people = relations.map((rel) => {
    const entity = entityById.get(rel.toEntityId);
    return {
      entityId: rel.toEntityId,
      name: entity ? entity.displayName : null,
      type: rel.type,
      role: (rel.metadata && rel.metadata.role) || null,
      ownershipPct: (rel.metadata && rel.metadata.ownershipPct) != null ? rel.metadata.ownershipPct : null,
      effectiveDate: (rel.metadata && rel.metadata.effectiveDate) || null,
      confidence: rel.confidence,
    };
  });
  return {
    companyEntityId,
    partners: people.filter((p) => p.type === 'HAS_PARTNER'),
    directors: people.filter((p) => p.type === 'HAS_DIRECTOR'),
    representatives: people.filter((p) => p.type === 'HAS_REPRESENTATIVE'),
    others: people.filter((p) => p.type === 'RELATED_TO'),
    confidence: relationshipConfidence(relations.map((r) => r.confidence)),
  };
}

module.exports = { ownershipObservations, buildOwnershipProfile, relationTypeForRole };
