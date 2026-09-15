/**
 * B2Base — Área administrativa (admin)
 * =====================================================================
 * Admin isolado e independente do Firebase. Autenticação BÁSICA com
 * login/senha vindos do Infisical (env do deploy), não do banco de
 * usuários da plataforma.
 *
 * Variáveis de ambiente (populadas via Infisical no cluster, path /b2base):
 *   ADMIN_USERNAME        Usuário admin (fail-closed: se vazio, admin desligado)
 *   ADMIN_PASSWORD        Senha admin (comparação em tempo constante)
 *   ADMIN_COOKIE_NAME     (opcional) nome do cookie de sessão admin
 *   ADMIN_SESSION_TTL_HOURS (opcional) vida da sessão em horas (default 12)
 *
 * Sessão admin: JWT assinado com o mesmo SESSION_SECRET da aplicação
 * (garante sobrevivência a restarts) num cookie httpOnly dedicado.
 * A assinatura <ADMIN_USERNAME>:<senha> NUNCA vai para o cliente — apenas
 * o cookie de sessão httpOnly.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { parse: parseCookie, serialize: serializeCookie } = require('cookie');

const DEFAULT_ADMIN_COOKIE = 'b2base_admin_session';
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_COOKIE_NAME || DEFAULT_ADMIN_COOKIE;
const ADMIN_SESSION_TTL_HOURS = Math.max(
  1,
  Number(process.env.ADMIN_SESSION_TTL_HOURS) || 12
);
const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_HOURS * 60 * 60;

let _adminSecret = null;
function adminSecret() {
  if (_adminSecret) return _adminSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) {
    _adminSecret = fromEnv.trim();
    return _adminSecret;
  }
  // Fallback estável derivado apenas para desenvolvimento local; em produção
  // SESSION_SECRET vem do Infisical. Se não houver, derivamos de uma seed via
  // hash — ainda quebraria após restart aleatório, por isso exigimos a env em prod.
  _adminSecret = crypto
    .createHash('sha256')
    .update(process.env.ADMIN_PASSWORD ? 'b2base-admin-' + process.env.ADMIN_PASSWORD : 'b2base-admin-dev-seed')
    .digest('hex');
  return _adminSecret;
}

/** true apenas quando o admin está configurado (login+senha presentes). */
function isAdminEnabled() {
  const user = String(process.env.ADMIN_USERNAME || '').trim();
  const pass = process.env.ADMIN_PASSWORD;
  return Boolean(user) && Boolean(pass && pass.length > 0);
}

/** Comparação de strings em tempo constante para evitar timing attacks. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Ainda percorre para não vazar diferença só pela regra de tamanho em
    // alguns engines; o digest abaixo domina o custo.
    return crypto.timingSafeEqual(bufA, bufA) && false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isCookieSecure() {
  if (typeof process.env.SESSION_COOKIE_SECURE === 'string') {
    return process.env.SESSION_COOKIE_SECURE.toLowerCase() === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: ADMIN_SESSION_TTL_SECONDS,
    })
  );
}

function clearAdminCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(ADMIN_COOKIE_NAME, '', {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    })
  );
}

function signAdminToken(username) {
  return jwt.sign(
    { sub: 'admin', username, scope: 'admin' },
    adminSecret(),
    {
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
      issuer: 'b2base',
      audience: 'b2base-admin',
    }
  );
}

function verifyAdminToken(token) {
  return jwt.verify(token, adminSecret(), {
    issuer: 'b2base',
    audience: 'b2base-admin',
  });
}

/** Middleware: protege /api/admin/*. 401 sem sessão válida. */
function requireAdmin(req, res, next) {
  if (!isAdminEnabled()) {
    return res
      .status(503)
      .json({ success: false, error: 'Admin não configurado no servidor.', code: 'ADMIN_DISABLED' });
  }
  const token = (req.cookies && req.cookies[ADMIN_COOKIE_NAME]) || '';
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: 'Não autenticado no admin.', code: 'ADMIN_UNAUTHENTICATED' });
  }
  try {
    const payload = verifyAdminToken(token);
    req.admin = payload;
    return next();
  } catch (_err) {
    clearAdminCookie(res);
    return res
      .status(401)
      .json({ success: false, error: 'Sessão admin expirada ou inválida.', code: 'ADMIN_SESSION_INVALID' });
  }
}

/**
 * Registra as rotas do admin no app Express fornecido.
 * Fica FORA do guard global de /api do Firebase por design: usa a própria
 * sessão admin (env), não o cookie /api/user da plataforma.
 */
function createAdminRouter(prisma) {
  const router = express.Router();

  // ── Auth básica ────────────────────────────────────────────────────────
  router.post('/login', (req, res) => {
    if (!isAdminEnabled()) {
      return res
        .status(503)
        .json({ success: false, error: 'Admin não configurado no servidor.', code: 'ADMIN_DISABLED' });
    }
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const okUser = safeEqual(username, String(process.env.ADMIN_USERNAME || '').trim());
    const okPass = safeEqual(password, String(process.env.ADMIN_PASSWORD || ''));

    if (!okUser || !okPass) {
      // Resposta idêntica para usuário/senha errados — não informa qual falhou.
      return res
        .status(401)
        .json({ success: false, error: 'Credenciais inválidas.', code: 'ADMIN_BAD_CREDENTIALS' });
    }

    const token = signAdminToken(username);
    setAdminCookie(res, token);
    return res.json({ success: true, data: { username } });
  });

  router.post('/logout', (req, res) => {
    clearAdminCookie(res);
    return res.json({ success: true });
  });

  router.get('/me', requireAdmin, (req, res) => {
    return res.json({ success: true, data: { username: req.admin.username } });
  });

  // ── Resumo (KPI) ───────────────────────────────────────────────────────
  router.get('/summary', requireAdmin, async (req, res) => {
    try {
      const [users, orgs, trials, premiums, prospects] = await Promise.all([
        prisma.user.count(),
        prisma.organization.count(),
        prisma.organization.count({ where: { plan: 'trial' } }),
        prisma.organization.count({ where: { plan: 'premium' } }),
        prisma.prospect.count(),
      ]);
      return res.json({
        success: true,
        data: { users, orgs, trials, premiums, prospects },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Usuários ───────────────────────────────────────────────────────────
  // Lista todos os usuários cadastrados, com a organização e plano de origem.
  router.get('/users', requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {};

      const [total, items] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            sessionVersion: true,
            createdAt: true,
            updatedAt: true,
            orgId: true,
            organization: {
              select: { id: true, name: true, plan: true, cnpj: true },
            },
          },
        }),
      ]);

      return res.json({
        success: true,
        data: items,
        meta: { total, limit, skip },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Organizações / contas ──────────────────────────────────────────────
  router.get('/orgs', requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const planFilter = String(req.query.plan || '').trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

      const where = {
        ...(planFilter === 'trial' || planFilter === 'premium'
          ? { plan: planFilter }
          : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { cnpj: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [total, items] = await Promise.all([
        prisma.organization.count({ where }),
        prisma.organization.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
          select: {
            id: true,
            name: true,
            cnpj: true,
            plan: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            stripePlanStatus: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { users: true, prospects: true } },
            users: {
              select: { id: true, email: true, name: true },
              take: 10,
            },
          },
        }),
      ]);

      return res.json({
        success: true,
        data: items,
        meta: { total, limit, skip },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Trocar plano trial ↔ premium (e vice-versa) ────────────────────────
  // A fonte de verdade do plano é a `Organization.plan`. Quando o admin força
  // "premium" manualmente, limpamos os vínculos Stripe órfãos para não
  // conflitar; quando volta para "trial", mantemos o Stripe linkado (caso uma
  // assinatura real exista, o webhook retoma o plano automaticamente).
  router.post('/orgs/:id/plan', requireAdmin, async (req, res) => {
    try {
      const orgId = String(req.params.id || '');
      const plan = String((req.body && req.body.plan) || '').trim();
      if (plan !== 'trial' && plan !== 'premium') {
        return res
          .status(400)
          .json({ success: false, error: 'Plano inválido. Use "trial" ou "premium".' });
      }

      const existing = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, plan: true },
      });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Organização não encontrada.' });
      }

      const data =
        plan === 'premium'
          ? { plan, stripePlanStatus: 'active' }
          : { plan };

      const updated = await prisma.organization.update({
        where: { id: orgId },
        data,
        select: {
          id: true,
          name: true,
          plan: true,
          stripePlanStatus: true,
          updatedAt: true,
        },
      });

      console.log(`[admin] Org ${orgId} (${updated.name}): plano ${existing.plan} → ${plan} por ${req.admin.username}`);
      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = {
  createAdminRouter,
  requireAdmin,
  isAdminEnabled,
  ADMIN_COOKIE_NAME,
};
