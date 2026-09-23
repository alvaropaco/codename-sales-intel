'use strict';

/**
 * test/studio-api.test.js — smoke test do esqueleto do Campaign Studio
 * (specs/010, T007): auth obrigatória, 404 JSON e escopo por organização.
 *
 * Padrão do repo (test/discovery-api.test.js): Express real em porta efêmera,
 * fake-prisma em memória, sem rede externa.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createFakePrisma } = require('./helpers/fake-prisma');
const { createStudioRouter } = require('../studio/router');

async function startServer({ user } = {}) {
  const app = express();
  app.use(express.json());
  const prisma = createFakePrisma();

  // Simula o requireAuth global: popula req.user quando a sessão é válida.
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/studio', createStudioRouter(prisma));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, prisma };
}

test('GET /api/studio/health sem sessão → 401 UNAUTHENTICATED (constituição IV)', async () => {
  const { server, base } = await startServer({ user: null });
  try {
    const res = await fetch(`${base}/api/studio/health`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'UNAUTHENTICATED');
  } finally {
    server.close();
  }
});

test('GET /api/studio/health autenticado → 200 com payload do módulo', async () => {
  const { server, base } = await startServer({
    user: { id: 'user-1', orgId: 'org-1' },
  });
  try {
    const res = await fetch(`${base}/api/studio/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.module, 'studio');
  } finally {
    server.close();
  }
});

test('Rota inexistente do studio → 404 JSON com formato do contrato', async () => {
  const { server, base } = await startServer({
    user: { id: 'user-1', orgId: 'org-1' },
  });
  try {
    const res = await fetch(`${base}/api/studio/definitivamente-nao-existe`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'NOT_FOUND');
    assert.ok(body.message.includes('definitivamente-nao-existe'));
  } finally {
    server.close();
  }
});

test('Resolução de org: fallback no banco quando o token não carrega orgId', async () => {
  const { server, base, prisma } = await startServer({
    // Token só com id — o router deve resolver o orgId pelo banco.
    user: { id: 'user-2' },
  });
  try {
    prisma.user.rows.push({ id: 'user-2', orgId: 'org-2' });
    const res = await fetch(`${base}/api/studio/health`);
    assert.equal(res.status, 200);
    // Sem o usuário no banco → 401 (requireOrg não resolve org).
    const anon = await startServer({ user: { id: 'ghost' } });
    try {
      const resGhost = await fetch(`${anon.base}/api/studio/health`);
      assert.equal(resGhost.status, 401);
    } finally {
      anon.server.close();
    }
  } finally {
    server.close();
  }
});
