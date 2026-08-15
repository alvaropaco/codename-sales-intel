/**
 * Firebase Authentication + session management for the SalesIntel platform.
 *
 * Responsibilities:
 *   - Verify Firebase ID tokens (Google / GitHub) via the Admin SDK.
 *   - Enforce corporate-only email sign-up (free webmail providers are blocked).
 *   - Issue a signed, httpOnly session cookie so authentication is persistent
 *     across requests and browser restarts (no re-login on next visits).
 *   - Expose Express middleware to protect API routes.
 *
 * Environment variables:
 *   FIREBASE_SERVICE_ACCOUNT_JSON   Inline JSON of the service account (preferred).
 *   FIREBASE_SERVICE_ACCOUNT_PATH   Path to the service account JSON file.
 *   GOOGLE_APPLICATION_CREDENTIALS  Standard GCP path (used as fallback).
 *   SESSION_SECRET                  Secret used to sign session JWTs (>= 32 chars).
 *   SESSION_COOKIE_NAME             Cookie name (default: salesintel_session).
 *   SESSION_TTL_HOURS               Session lifetime in hours (default: 336 = 14 days).
 *   SESSION_COOKIE_SECURE           Force the Secure flag on the cookie ("true"/"false").
 *   AUTH_ALLOWED_DOMAINS            Optional comma-separated corporate domain allowlist.
 *                                   When set, ONLY these domains are allowed.
 */

const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { parse: parseCookie, serialize: serializeCookie } = require('cookie');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'salesintel_session';
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 336);
const SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60;

/**
 * Free / consumer webmail providers that are NOT allowed to sign up.
 * This list is intentionally broad; the corporate-domain check runs after it.
 */
const FREE_EMAIL_DOMAINS = new Set(
  [
    // Google
    'gmail.com',
    'googlemail.com',
    // Microsoft
    'outlook.com',
    'outlook.com.br',
    'hotmail.com',
    'hotmail.com.br',
    'live.com',
    'msn.com',
    'windowslive.com',
    // Yahoo / AOL / Verizon
    'yahoo.com',
    'yahoo.com.br',
    'ymail.com',
    'rocketmail.com',
    'aol.com',
    'verizon.net',
    // Apple
    'icloud.com',
    'me.com',
    'mac.com',
    // Proton / Tutanota (Tuta)
    'protonmail.com',
    'protonmail.ch',
    'proton.me',
    'pm.me',
    'tutanota.com',
    'tutanota.de',
    'tutamail.com',
    'tuta.io',
    'keemail.me',
    // Fastmail / Zoho / GMX / Mail.com
    'fastmail.com',
    'fastmail.fm',
    'fastmail.net',
    'zoho.com',
    'zohomail.com',
    'zohomail.eu',
    'gmx.com',
    'gmx.net',
    'gmx.de',
    'mail.com',
    'email.com',
    'inbox.com',
    'mail.ru',
    'bk.ru',
    'list.ru',
    'inbox.ru',
    'internet.ru',
    // Yandex
    'yandex.com',
    'yandex.ru',
    'ya.ru',
    // Chinese consumer providers
    'qq.com',
    '163.com',
    '126.com',
    'sina.com',
    'sina.cn',
    'yeah.net',
    // Brazilian consumer providers
    'uol.com.br',
    'bol.com.br',
    'terra.com.br',
    'ig.com.br',
    'globo.com',
    'oi.com.br',
    'r7.com',
    'zipmail.com.br',
    'itelefonica.com.br',
    'click21.com.br',
    'pop.com.br',
    'ibest.com.br',
  ].map((domain) => domain.toLowerCase())
);

let cachedAdmin = null;
let cachedSessionSecret = null;

function readEnvJson(key) {
  const raw = process.env[key];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${key} não contém JSON válido: ${err.message}`);
  }
}

function loadServiceAccount() {
  // 1) Inline JSON (best for container platforms like Coolify/Render).
  const inline = readEnvJson('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (inline) return inline;

  // 2) Explicit file path.
  const paths = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean);

  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      throw new Error(`Não foi possível ler a service account em ${filePath}: ${err.message}`);
    }
  }

  return null;
}

function getSessionSecret() {
  if (cachedSessionSecret) return cachedSessionSecret;

  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) {
    cachedSessionSecret = fromEnv.trim();
    return cachedSessionSecret;
  }

  // Stable fallback derived from the service account private key, so sessions
  // survive restarts even when SESSION_SECRET is not set explicitly.
  try {
    const sa = loadServiceAccount();
    if (sa && sa.private_key) {
      cachedSessionSecret = crypto
        .createHash('sha256')
        .update(String(sa.private_key))
        .digest('hex');
      return cachedSessionSecret;
    }
  } catch (_err) {
    // ignore and fall through to ephemeral secret
  }

  console.warn(
    '[auth] SESSION_SECRET ausente e nenhuma service account disponível; ' +
      'gerando segredo efêmero (as sessões serão invalidadas ao reiniciar).'
  );
  cachedSessionSecret = crypto.randomBytes(48).toString('hex');
  return cachedSessionSecret;
}

function getFirebaseApp() {
  if (cachedAdmin) return cachedAdmin;

  // firebase-admin v14+ uses the modular API: firebase-admin/app + firebase-admin/auth.
  // Lazy require so the server still boots when firebase-admin is not installed.
  const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
  const serviceAccount = loadServiceAccount();

  try {
    if (serviceAccount && serviceAccount.private_key) {
      cachedAdmin = initializeApp({ credential: cert(serviceAccount) });
    } else {
      // Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or GCE metadata).
      cachedAdmin = initializeApp({ credential: applicationDefault() });
    }
    console.log('[auth] Firebase Admin SDK inicializado.');
  } catch (err) {
    console.error(
      '[auth] Falha ao inicializar o Firebase Admin SDK. Configure ' +
        'FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_PATH.'
    );
    throw err;
  }

  return cachedAdmin;
}

function getAuthInstance() {
  const { getAuth } = require('firebase-admin/auth');
  return getAuth(getFirebaseApp());
}

function getAllowlistedDomains() {
  return (process.env.AUTH_ALLOWED_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedEmailDomain(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return false;

  const domain = normalized.slice(at + 1);
  if (FREE_EMAIL_DOMAINS.has(domain)) return false;

  const allowlist = getAllowlistedDomains();
  if (allowlist.length) return allowlist.includes(domain);

  // No explicit allowlist: any domain that is not a known free provider is accepted.
  return true;
}

function createSessionToken(user) {
  return jwt.sign(
    {
      uid: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      role: user.role,
      orgId: user.orgId,
      ver: Number(user.sessionVersion ?? 0),
    },
    getSessionSecret(),
    {
      expiresIn: SESSION_TTL_SECONDS,
      issuer: 'salesintel',
    }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, getSessionSecret(), { issuer: 'salesintel' });
}

function isCookieSecure() {
  if (typeof process.env.SESSION_COOKIE_SECURE === 'string') {
    return process.env.SESSION_COOKIE_SECURE.toLowerCase() === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: isCookieSecure(),
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    })
  );
}

function cookieParserMiddleware(req, _res, next) {
  req.cookies = parseCookie(req.headers.cookie || '');
  next();
}

async function isSessionRevoked(prisma, payload) {
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user) return true;
  return Number(payload.ver ?? 0) !== Number(user.sessionVersion ?? 0);
}

function createRequireAuth(prisma) {
  return async function requireAuth(req, res, next) {
    const token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: 'Não autenticado', code: 'UNAUTHENTICATED' });
    }

    let payload;
    try {
      payload = verifySessionToken(token);
    } catch (_err) {
      clearSessionCookie(res);
      return res
        .status(401)
        .json({ success: false, error: 'Sessão expirada', code: 'SESSION_EXPIRED' });
    }

    try {
      if (await isSessionRevoked(prisma, payload)) {
        clearSessionCookie(res);
        return res
          .status(401)
          .json({ success: false, error: 'Sessão encerrada', code: 'SESSION_REVOKED' });
      }
    } catch (_err) {
      // DB outage must not silently allow access.
      return res
        .status(401)
        .json({ success: false, error: 'Não foi possível validar a sessão', code: 'AUTH_ERROR' });
    }

    req.user = payload;
    return next();
  };
}

async function upsertUserFromDecodedToken(prisma, decodedToken) {
  const emailFromToken = String(decodedToken.email || '').toLowerCase().trim();
  const phone = decodedToken.phone_number ? String(decodedToken.phone_number) : null;

  // Phone sign-in has no email. Store a synthetic, unique email so the existing
  // `email @unique` column keeps working; the real identifier is `phone`.
  const email = emailFromToken || (phone ? `phone-${decodedToken.uid}@shadowtrace.local` : '');

  if (!email) {
    throw new Error('Não foi possível identificar um e-mail ou telefone no token.');
  }

  const name =
    decodedToken.name ||
    decodedToken.displayName ||
    (emailFromToken ? emailFromToken.split('@')[0] : phone) ||
    email;

  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Organização principal' },
    });
  }

  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      phone,
      role: 'member',
      orgId: org.id,
    },
    update: { name, phone },
  });
}

function serializeUser(user) {
  return {
    uid: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone ?? null,
    role: user.role,
    orgId: user.orgId,
  };
}

async function loginWithIdToken(prisma, idToken) {
  if (!idToken) {
    const err = new Error('ID token ausente');
    err.status = 400;
    throw err;
  }

  const auth = getAuthInstance();
  const decoded = await auth.verifyIdToken(String(idToken));

  const hasEmail = Boolean(decoded.email);
  const hasPhone = Boolean(decoded.phone_number);

  if (!hasEmail && !hasPhone) {
    const err = new Error('Não foi possível identificar um e-mail ou telefone no token.');
    err.status = 403;
    throw err;
  }

  // E-mail providers (Google, GitHub, email/password) must be corporate-only.
  if (hasEmail) {
    if (decoded.email_verified === false) {
      const err = new Error(
        'E-mail ainda não verificado. Verifique sua caixa de entrada antes de continuar.'
      );
      err.status = 403;
      err.code = 'EMAIL_NOT_VERIFIED';
      throw err;
    }

    if (!isAllowedEmailDomain(decoded.email)) {
      const err = new Error(
        'Apenas e-mails corporativos são permitidos. E-mails de provedores gratuitos ' +
          '(Gmail, Outlook, Yahoo, etc.) não podem se cadastrar.'
      );
      err.status = 403;
      err.code = 'NON_CORPORATE_EMAIL';
      throw err;
    }
  }

  const user = await upsertUserFromDecodedToken(prisma, decoded);
  const token = createSessionToken(user);
  return { token, user: serializeUser(user) };
}

function createAuthRouter(prisma) {
  const router = express.Router();

  // POST /api/auth/session - exchange a Firebase ID token for a session cookie.
  router.post('/session', async (req, res) => {
    try {
      const { idToken } = req.body || {};
      const { token, user } = await loginWithIdToken(prisma, idToken);
      setSessionCookie(res, token);
      res.json({
        success: true,
        authenticated: true,
        data: user,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const status = err.status || 401;
      res.status(status).json({
        success: false,
        authenticated: false,
        error: err.message,
        code: err.code || 'AUTH_FAILED',
      });
    }
  });

  // GET /api/auth/session - resolve the current session from the cookie.
  router.get('/session', async (req, res) => {
    const token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Não autenticado',
        code: 'UNAUTHENTICATED',
      });
    }

    try {
      const payload = verifySessionToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.uid } });
      if (!user) {
        clearSessionCookie(res);
        return res.status(401).json({
          success: false,
          authenticated: false,
          error: 'Usuário não encontrado',
          code: 'USER_NOT_FOUND',
        });
      }
      if (Number(payload.ver ?? 0) !== Number(user.sessionVersion ?? 0)) {
        clearSessionCookie(res);
        return res.status(401).json({
          success: false,
          authenticated: false,
          error: 'Sessão encerrada',
          code: 'SESSION_REVOKED',
        });
      }
      res.json({
        success: true,
        authenticated: true,
        data: serializeUser(user),
        timestamp: new Date().toISOString(),
      });
    } catch (_err) {
      clearSessionCookie(res);
      res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Sessão expirada',
        code: 'SESSION_EXPIRED',
      });
    }
  });

  // POST /api/auth/logout - clear the session cookie and revoke the session
  // server-side so a previously captured cookie no longer works.
  router.post('/logout', async (req, res) => {
    const token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
    if (token) {
      try {
        const payload = verifySessionToken(token);
        await prisma.user.update({
          where: { id: payload.uid },
          data: { sessionVersion: { increment: 1 } },
        });
      } catch (_err) {
        // The token is already invalid/expired; the cookie clear below is enough.
      }
    }
    clearSessionCookie(res);
    res.json({ success: true, message: 'Logout realizado' });
  });

  return router;
}

module.exports = {
  createAuthRouter,
  cookieParserMiddleware,
  createRequireAuth,
  isAllowedEmailDomain,
  FREE_EMAIL_DOMAINS,
  SESSION_COOKIE_NAME,
  getFirebaseApp,
  getAuthInstance,
};
