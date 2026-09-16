// =============================================================================
// test/helpers/fake-prisma.js — fake in-memory do Prisma para os testes do
// motor de enriquecimento (estilo DI de test/lead-enrichment.test.js).
// Suporta apenas as operações que o motor usa, com matching por igualdade.
// =============================================================================

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function matches(record, where = {}) {
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      // Operadores do Prisma suportados pelo fake: { lt, gte }
      if ('lt' in expected) return new Date(record[field]) < new Date(expected.lt);
      if ('gte' in expected) return new Date(record[field]) >= new Date(expected.gte);
      return matches(record[field] || {}, expected);
    }
    return record[field] === expected;
  });
}

function applyData(record, data) {
  Object.assign(record, JSON.parse(JSON.stringify(data)));
  record.updatedAt = new Date();
  return record;
}

/** Cria um model fake com as operações usadas pelo motor. */
function makeModel(name) {
  const rows = [];
  const model = {
    rows,
    async create({ data }) {
      const row = { id: data.id || makeId(name.slice(0, 3)) };
      rows.push(row);
      return applyData(row, data);
    },
    async findUnique({ where }) {
      const key = Object.values(where)[0];
      const field = Object.keys(where)[0];
      return rows.find((r) => r[field] === key) || null;
    },
    async findFirst({ where = {}, orderBy } = {}) {
      let found = rows.filter((r) => matches(r, where));
      if (orderBy && orderBy.createdAt === 'desc') {
        found = [...found].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      }
      return found[0] || null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((r) => matches(r, where));
    },
    async update({ where, data }) {
      const key = Object.values(where)[0];
      const field = Object.keys(where)[0];
      const row = rows.find((r) => r[field] === key);
      if (!row) throw new Error(`fake-prisma: ${name} não encontrado para update (${field}=${key})`);
      return applyData(row, data);
    },
    async upsert({ where, create, update }) {
      const key = Object.values(where)[0];
      const field = Object.keys(where)[0];
      const existing = rows.find((r) => r[field] === key);
      if (existing) return model.update({ where, data: update });
      return model.create({ data: { ...create, [field]: key } });
    },
    async createMany({ data }) {
      for (const item of data) await model.create({ data: item });
      return { count: data.length };
    },
    async count({ where = {} } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async deleteMany({ where = {} } = {}) {
      const before = rows.length;
      for (const r of rows.filter((x) => matches(x, where))) {
        rows.splice(rows.indexOf(r), 1);
      }
      return { count: before - rows.length };
    },
  };
  return model;
}

function createFakePrisma() {
  return {
    prospect: makeModel('prospect'),
    enrichmentJob: makeModel('enrichmentJob'),
    enrichmentTask: makeModel('enrichmentTask'),
    enrichmentResult: makeModel('enrichmentResult'),
    enrichmentEvidence: makeModel('enrichmentEvidence'),
    rawRecord: makeModel('rawRecord'),
    // Contratos legados (worker Python / ponte deepgraph)
    enrichmentRequest: makeModel('enrichmentRequest'),
    cnpjEnrichment: makeModel('cnpjEnrichment'),
  };
}

/** Bus fake do JetStream: captura publicações para asserção. */
function createFakeJs() {
  const published = [];
  return {
    published,
    async publish(subject, data, opts) {
      published.push({ subject, data, opts, at: published.length });
      return { seq: published.length };
    },
  };
}

/** Mensagem fake no formato que o runtime consome (interface ack/nak/term). */
function createFakeMessage(payload, { trace = [] } = {}) {
  const contracts = require('../../enrichment-contracts');
  const msg = {
    data: contracts.serializePayload(payload),
    ack: async () => trace.push('ack'),
    nak: async (delay) => trace.push(['nak', delay]),
    term: async () => trace.push('term'),
  };
  msg.trace = trace;
  return msg;
}

module.exports = { createFakePrisma, createFakeJs, createFakeMessage, makeId };
