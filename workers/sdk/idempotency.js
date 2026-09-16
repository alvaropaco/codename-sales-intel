// =============================================================================
// workers/sdk/idempotency.js — chave determinística de task (research R4).
//
// taskKey = uuidv5(namespace, orgId|jobId|entityKey|capability|provider|hash(input))
// Mesma task lógica (mesmo job, entidade, capability, provider e entrada) →
// mesma chave: replanejamento e redelivery são absorvidos pelo @@unique no
// Prisma (espelho do padrão CnpjEnrichment @@unique([companyId, version])).
// uuidv5 implementado localmente (SHA-1, RFC 4122) para não adicionar dependência.
// =============================================================================

const { createHash } = require('crypto');

// Namespace do motor (uuid v4 fixo, gerado uma única vez para esta feature).
const ENRICHMENT_NAMESPACE = '3f2a1c8e-5d47-4b6a-9e21-8c4d5e6f7a8b';

/** RFC 4122 §4.3 — uuid v5 (SHA-1) a partir de um namespace UUID. */
function uuidv5(name, namespace = ENRICHMENT_NAMESPACE) {
  const ns = Buffer.from(String(namespace).replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(String(name), 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Stringify estável: chaves ordenadas recursivamente (ordem de inserção não importa). */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashInput(input) {
  return createHash('sha1').update(stableStringify(input ?? {})).digest('hex');
}

/** Chave determinística da task (research R4 / FR-008). */
function computeTaskKey({ orgId, jobId, entityKey, capability, provider, input }) {
  const name = [orgId, jobId, entityKey, capability, provider || '', hashInput(input)].join('|');
  return uuidv5(name);
}

module.exports = { ENRICHMENT_NAMESPACE, uuidv5, stableStringify, hashInput, computeTaskKey };
