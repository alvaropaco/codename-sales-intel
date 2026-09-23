'use strict';

/**
 * studio/router.js — rotas `/api/studio` do Campaign Studio (specs/010).
 *
 * Montado em server-prod.js DEPOIS do requireAuth global:
 *   app.use('/api/studio', require('./studio/router').createStudioRouter(prisma));
 *
 * Convenções do contrato (specs/010-campaign-studio/contracts/rest-api.md):
 *  - Toda rota tem escopo de organização: `requireOrg` resolve o orgId do
 *    usuário autenticado (mesma semântica de `requireRequestOrgId` no
 *    server-prod.js — o JWT de sessão carrega orgId, fallback no banco).
 *  - Erros: `{ error: CODE, message? }` com status HTTP semântico
 *    (401/400/402/403/404/409). Helpers `httpError(code, status, message)`.
 *  - Gating premium: `requirePremiumOrg` (plan.js — trial → 403
 *    PREMIUM_REQUIRED). Cotas diárias de IA: studio/quotas.js.
 */

const express = require('express');
const { requirePremiumOrg } = require('./org-gating');
const { registerStudioRoutes } = require('./routes');
const { httpError } = require('./errors');

function createStudioRouter(prisma, options = {}) {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit || '2mb' }));

  // ── Helpers de escopo/erro compartilhados pelas rotas ────────────────────
  async function requireOrg(req) {
    const orgIdFromToken = req.user && req.user.orgId;
    const userId = req.user && (req.user.id || req.user.uid);
    if (!orgIdFromToken && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { orgId: true },
      });
      if (user) return { userId, orgId: user.orgId };
    }
    if (orgIdFromToken) return { userId, orgId: orgIdFromToken };
    throw httpError('UNAUTHENTICATED', 401, 'Não autenticado');
  }

  // Contexto (req.studio) disponível para todas as rotas do Studio.
  router.use((req, res, next) => {
    requireOrg(req)
      .then(({ userId, orgId }) => {
        req.studio = { prisma, orgId, userId };
        next();
      })
      .catch(next);
  });

  // Healthcheck do módulo (usado pelo smoke test).
  router.get('/health', (req, res) => {
    res.json({ success: true, module: 'studio', timestamp: new Date().toISOString() });
  });

  // Rotas de domínio (registradas em ordem de implementação das stories).
  registerStudioRoutes(router, {
    prisma,
    httpError,
    overrides: options.overrides || {},
    // Gate premium com o erro semântico do contrato (403 PREMIUM_REQUIRED).
    requirePremiumOrg: (orgId) => requirePremiumOrg(prisma, orgId, httpError),
  });

  // 404 JSON para qualquer rota de studio não implementada.
  router.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Rota studio inexistente: ${req.method} ${req.path}` });
  });

  // Handler de erro final do router (mantém o formato do contrato).
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error('[studio]', err);
    }
    res.status(status).json({
      error: err.code || 'INTERNAL_ERROR',
      message: status >= 500 ? 'Erro interno' : err.message,
    });
  });

  return router;
}

module.exports = { createStudioRouter, httpError };
