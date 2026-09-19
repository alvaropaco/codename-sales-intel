'use strict';

/**
 * Testes do backfill de migração do estágio removido (feature 005, FR-003):
 * `backfillLeadStatus` (scripts/backfill-lead-status.js) move leads do
 * estágio removido 'lead' para 'prospect' de forma idempotente — rodar de
 * novo não reescreve nada e leads em outros estágios não são tocados.
 * Padrão: fake-prisma, sem banco real.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { backfillLeadStatus } = require('../scripts/backfill-lead-status');

function prospectFixture(overrides = {}) {
  return {
    id: 'p-1',
    status: 'lead',
    orgId: 'org-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

test('backfill move leads do estágio removido "lead" para "prospect"', async () => {
  const prisma = createFakePrisma();
  await prisma.prospect.create({ data: prospectFixture({ id: 'p-1' }) });
  await prisma.prospect.create({ data: prospectFixture({ id: 'p-2', status: 'prospect' }) });
  await prisma.prospect.create({ data: prospectFixture({ id: 'p-3', status: 'qualified' }) });

  const summary = await backfillLeadStatus(prisma, {});

  assert.strictEqual(summary.scanned, 1);
  assert.strictEqual(summary.migrated, 1);
  const moved = await prisma.prospect.findUnique({ where: { id: 'p-1' } });
  assert.strictEqual(moved.status, 'prospect');
  // Outros estágios intocados (FR-003: sem perda de dados).
  assert.strictEqual((await prisma.prospect.findUnique({ where: { id: 'p-2' } })).status, 'prospect');
  assert.strictEqual((await prisma.prospect.findUnique({ where: { id: 'p-3' } })).status, 'qualified');
});

test('backfill é idempotente: segunda execução não altera nada', async () => {
  const prisma = createFakePrisma();
  await prisma.prospect.create({ data: prospectFixture({ id: 'p-1' }) });

  const first = await backfillLeadStatus(prisma, {});
  assert.strictEqual(first.migrated, 1);

  const second = await backfillLeadStatus(prisma, {});
  assert.strictEqual(second.scanned, 0);
  assert.strictEqual(second.migrated, 0);
  assert.strictEqual((await prisma.prospect.findUnique({ where: { id: 'p-1' } })).status, 'prospect');
});

test('backfill migra todos os leads legados de uma vez', async () => {
  const prisma = createFakePrisma();
  for (let i = 0; i < 5; i += 1) {
    await prisma.prospect.create({ data: prospectFixture({ id: `p-${i}` }) });
  }

  const summary = await backfillLeadStatus(prisma, {});
  assert.strictEqual(summary.scanned, 5);
  assert.strictEqual(summary.migrated, 5);
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual((await prisma.prospect.findUnique({ where: { id: `p-${i}` } })).status, 'prospect');
  }
});
