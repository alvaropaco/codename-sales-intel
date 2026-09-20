'use strict';

/**
 * Testes do backfill de resolução de CNPJ (feature 005): para leads de orgs
 * premium sem CNPJ, roda o resolveCnpj (com estágio IA) e, quando resolve,
 * grava o CNPJ e dispara o re-enriquecimento completo. Leads que não
 * resolvem permanecem intocados. Padrão: fake-prisma, sem rede.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { backfillResolveCnpj } = require('../scripts/backfill-resolve-cnpj');

async function setup() {
  const prisma = createFakePrisma();
  await prisma.organization.create({ data: { id: 'org-prem', name: 'Premium', plan: 'premium' } });
  await prisma.organization.create({ data: { id: 'org-trial', name: 'Trial', plan: 'trial' } });
  const planFor = async (orgId) => (orgId === 'org-prem' ? 'premium' : 'trial');
  return { prisma, planFor };
}

test('resolve CNPJ de lead sem identificador, grava e dispara re-enriquecimento', async () => {
  const { prisma, planFor } = await setup();
  await prisma.prospect.create({
    data: { id: 'p-1', orgId: 'org-prem', companyName: 'STAMPCOM METALÚRGICA LTDA', status: 'qualified', enrichmentStatus: 'partial' },
  });
  const dispatched = [];
  const resolve = async () => ({ cnpj: '45723174000110', source: 'ia', confidence: 0.85, matchedName: 'STAMPCOM LTDA' });
  const dispatch = async (prospect) => {
    dispatched.push(prospect.id);
    return prospect;
  };

  const summary = await backfillResolveCnpj(prisma, { planFor, resolve, dispatch, limit: 10 });

  assert.strictEqual(summary.scanned, 1);
  assert.strictEqual(summary.resolved, 1);
  assert.deepStrictEqual(dispatched, ['p-1']);
  const row = await prisma.prospect.findUnique({ where: { id: 'p-1' } });
  assert.strictEqual(row.cnpj, '45723174000110');
});

test('lead que não resolve fica intocado; trial não entra na fila', async () => {
  const { prisma, planFor } = await setup();
  await prisma.prospect.create({
    data: { id: 'p-prem', orgId: 'org-prem', companyName: 'SEM SORTE LTDA', status: 'qualified', enrichmentStatus: 'unavailable' },
  });
  await prisma.prospect.create({
    data: { id: 'p-trial', orgId: 'org-trial', companyName: 'TRIAL LTDA', status: 'qualified', enrichmentStatus: 'unavailable' },
  });
  let resolveCalls = 0;
  let dispatchCalls = 0;
  const resolve = async () => { resolveCalls += 1; return null; };
  const dispatch = async () => { dispatchCalls += 1; };

  const summary = await backfillResolveCnpj(prisma, { planFor, resolve, dispatch, limit: 10 });

  assert.strictEqual(summary.scanned, 1); // trial nem entra no scan
  assert.strictEqual(resolveCalls, 1);
  assert.strictEqual(dispatchCalls, 0);
  assert.strictEqual(summary.resolved, 0);
  const row = await prisma.prospect.findUnique({ where: { id: 'p-prem' } });
  assert.ok(!row.cnpj); // intocado (nunca setado)
});

test('é idempotente: lead com CNPJ não é revisitado', async () => {
  const { prisma, planFor } = await setup();
  await prisma.prospect.create({
    data: { id: 'p-ok', orgId: 'org-prem', companyName: 'COM CNPJ LTDA', cnpj: '45723174000110', status: 'qualified' },
  });
  const summary = await backfillResolveCnpj(prisma, {
    planFor,
    resolve: async () => { throw new Error('não deveria resolver'); },
    dispatch: async () => {},
    limit: 10,
  });
  assert.strictEqual(summary.scanned, 0);
});
