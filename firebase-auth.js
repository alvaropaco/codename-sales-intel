/**
 * Firebase Authentication + session management for the B2Base platform.
 *
 * Responsibilities:
 *   - Verify Firebase ID tokens (Google / email-password / phone) via the Admin SDK.
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
 *   SESSION_COOKIE_NAME             Cookie name (default: b2base_session).
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

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'b2base_session';
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 336);
const SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'shadowtrace-7199f';

/**
 * Origin of the real Firebase Auth handler. When the Web SDK's `authDomain`
 * points at this app's own domain, the SDK calls `/__/auth/*` on this server.
 * We always forward those calls to the Firebase Hosting handler for the
 * project (`<project>.firebaseapp.com`), which is where the OAuth handshake
 * actually runs.
 *
 * IMPORTANT: the public `authDomain` (`VITE_FIREBASE_AUTH_DOMAIN` on the
 * frontend) is NOT the proxy target. If we forwarded to the app's own domain
 * we would loop back into this same handler. Use FIREBASE_AUTH_HANDLER_ORIGIN
 * only when the handler is served from a custom Firebase Hosting domain.
 */
function getFirebaseAuthProxyOrigin() {
  const override = String(process.env.FIREBASE_AUTH_HANDLER_ORIGIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const domain = override || `${FIREBASE_PROJECT_ID}.firebaseapp.com`;
  return `https://${domain}`;
}

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

/**
 * Friendly, user-facing messages for the Firebase Auth / session error codes
 * that can bubble out of the Admin SDK or the client SDK. Technical error
 * strings are never exposed to the end user.
 */
const AUTH_ERROR_MESSAGES = {
  'auth/argument-error': 'Dados de autenticação inválidos. Tente novamente.',
  'auth/id-token-expired': 'Sua sessão expirou. Entre novamente.',
  'auth/id-token-revoked': 'Sua sessão foi encerrada. Entre novamente.',
  'auth/invalid-id-token': 'Sessão inválida. Entre novamente.',
  'auth/invalid-credential': 'Credenciais inválidas.',
  'auth/session-cookie-expired': 'Sua sessão expirou. Entre novamente.',
  'auth/session-cookie-revoked': 'Sua sessão foi encerrada. Entre novamente.',
  'auth/user-not-found': 'Nenhuma conta encontrada para essas credenciais.',
  'auth/wrong-password': 'Senha incorreta. Tente novamente.',
  'auth/email-already-exists': 'Este e-mail já está cadastrado.',
  'auth/phone-number-already-exists': 'Este telefone já está cadastrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/invalid-phone-number': 'Telefone inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet e tente novamente.',
  'auth/operation-not-allowed': 'Este método de login não está habilitado.',
  'auth/unauthorized-continue-uri': 'O endereço de retorno do login não está autorizado.',
  'auth/internal-error': 'Erro interno de autenticação. Tente novamente.',
};

function errorCodeOf(err) {
  if (!err) return null;
  if (typeof err.code === 'string' && err.code) return err.code;
  if (err.errorInfo && typeof err.errorInfo.code === 'string' && err.errorInfo.code) {
    return err.errorInfo.code;
  }
  return null;
}

/**
 * Converts any authentication error into a safe public payload. Codes owned by
 * this application (EMAIL_NOT_VERIFIED, NON_CORPORATE_EMAIL, ...) are kept
 * verbatim together with their already-friendly message. Firebase Admin SDK
 * codes are translated. Everything else is collapsed into a generic message so
 * internal error strings never leak to the client.
 */
function toPublicAuthError(err) {
  const code = errorCodeOf(err);

  if (code && !code.startsWith('auth/')) {
    return {
      status: Number(err && err.status) || 401,
      message: String((err && err.message) || 'Não foi possível autenticar. Tente novamente.'),
      code,
    };
  }

  if (code && AUTH_ERROR_MESSAGES[code]) {
    return {
      status: Number(err && err.status) || 401,
      message: AUTH_ERROR_MESSAGES[code],
      code,
    };
  }

  return {
    status: Number(err && err.status) || 401,
    message: 'Não foi possível autenticar. Tente novamente.',
    code: code || 'AUTH_FAILED',
  };
}

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

/**
 * Temporarily disabled by default. Set AUTH_REQUIRE_CORPORATE_EMAIL=true to
 * re-enable the corporate-domain gate (blocking Gmail/Outlook/etc.).
 */
function isCorporateEmailRequired() {
  return String(process.env.AUTH_REQUIRE_CORPORATE_EMAIL).toLowerCase() === 'true';
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
      issuer: 'b2base',
    }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, getSessionSecret(), { issuer: 'b2base' });
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
  if (process.env.DEBUG_DASHBOARD === 'true' && req.path && req.path.startsWith('/api/')) {
    console.log('[dashboard-debug] req', req.method, req.path, 'hasCookie=', !!Object.keys(req.cookies || {}).length, 'cookieKeys=', Object.keys(req.cookies || {}).join(','));
  }
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
    // The session JWT carries the user id as `uid` (see signSessionToken), but
    // many route handlers read `req.user.id`. Alias it here so every authed
    // endpoint resolves the user regardless of which field it uses.
    if (payload && payload.uid != null && req.user.id == null) {
      req.user.id = payload.uid;
    }
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

  // IMPORTANTE (isolamento de dados): cada usuário possui uma Organization
  // própria. Antes, todos os usuários eram apontados para a primeira
  // organização do banco (findFirst), o que fazia todo mundo enxergar os
  // mesmos dados (dashboard, leads, pipeline, configuração e outreach).
  //
  // Agora tentamos reutilizar a organização já vinculada ao usuário e, quando
  // o usuário ainda não existe, criamos uma organização nova e exclusiva para
  // ele. Assim os dados ficam logicamente separados por usuário.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { email },
      data: { name, phone },
    });
  }

  const org = await prisma.organization.create({
    data: { name: name || email.split('@')[0] || 'Organização principal' },
  });

  return prisma.user.create({
    data: {
      email,
      name,
      phone,
      role: 'member',
      orgId: org.id,
    },
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
    err.code = 'MISSING_ID_TOKEN';
    throw err;
  }

  const auth = getAuthInstance();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(String(idToken));
  } catch (verifyErr) {
    const pub = toPublicAuthError(verifyErr);
    const err = new Error(pub.message);
    err.status = pub.status;
    err.code = pub.code;
    throw err;
  }

  const hasEmail = Boolean(decoded.email);
  const hasPhone = Boolean(decoded.phone_number);

  if (!hasEmail && !hasPhone) {
    const err = new Error('Não foi possível identificar um e-mail ou telefone no token.');
    err.status = 403;
    err.code = 'IDENTITY_NOT_FOUND';
    throw err;
  }

  // E-mail providers (Google, email/password) must be corporate-only.
  if (hasEmail) {
    if (decoded.email_verified === false) {
      const err = new Error(
        'E-mail ainda não verificado. Verifique sua caixa de entrada antes de continuar.'
      );
      err.status = 403;
      err.code = 'EMAIL_NOT_VERIFIED';
      throw err;
    }

    if (isCorporateEmailRequired() && !isAllowedEmailDomain(decoded.email)) {
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
      const pub = toPublicAuthError(err);
      res.status(pub.status).json({
        success: false,
        authenticated: false,
        error: pub.message,
        code: pub.code,
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

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'host',
  // Let fetch negotiate/decompress this itself; forwarding the client's
  // accept-encoding would make the upstream response bytes arrive compressed
  // while we strip content-encoding below (breaking the forwarded body).
  'accept-encoding',
]);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Self-hosted Firebase Auth callback endpoints.
 *
 * The Firebase JS SDK calls `__/auth/handler`, `__/auth/iframe` and
 * `__/auth/experiments` on the configured `authDomain`. When `authDomain` is
 * this app's own domain, those calls would 404 unless we serve them. This
 * middleware forwards them to the Firebase-hosted handler (which keeps the
 * OAuth popup/redirect flows working) and passes the response back verbatim.
 */
function createFirebaseAuthHandlerProxy() {
  return async function firebaseAuthHandlerProxy(req, res) {
    let upstreamUrl;
    try {
      upstreamUrl = getFirebaseAuthProxyOrigin() + req.originalUrl;
    } catch (_err) {
      return res.status(500).type('text/plain').send('Configuração de autenticação inválida.');
    }

    const method = String(req.method || 'GET').toUpperCase();
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';

    const headers = {};
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (name === undefined || value === undefined) continue;
      if (HOP_BY_HOP_HEADERS.has(String(name).toLowerCase())) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    let body;
    if (hasBody) {
      try {
        body = await readRawBody(req);
      } catch (_err) {
        return res.status(400).type('text/plain').send('Falha ao ler a requisição de login.');
      }
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method,
        headers,
        body: body && body.length ? body : undefined,
        redirect: 'manual',
      });

      const responseHeaders = {};
      upstream.headers.forEach((value, name) => {
        const lower = String(name).toLowerCase();
        if (
          lower === 'set-cookie' ||
          lower === 'content-length' ||
          lower === 'content-encoding' ||
          lower === 'connection' ||
          lower === 'keep-alive' ||
          lower === 'transfer-encoding'
        ) {
          return;
        }
        responseHeaders[lower] = responseHeaders[lower]
          ? `${responseHeaders[lower]}, ${value}`
          : value;
      });

      res.status(upstream.status);
      res.set(responseHeaders);

      // Cookies minted by the Firebase handler must be scoped to this origin
      // (host-only), so the browser stores them for the self-hosted handler.
      if (typeof upstream.headers.getSetCookie === 'function') {
        const cookies = upstream.headers
          .getSetCookie()
          .map((cookie) => cookie.replace(/\s*Domain=[^;]*;?/gi, ''));
        if (cookies.length) res.setHeader('set-cookie', cookies);
      }

      const payload = Buffer.from(await upstream.arrayBuffer());
      res.end(payload);
    } catch (err) {
      console.error('[auth] Falha ao repassar o callback do Firebase:', err);
      res.status(502).type('text/plain').send('Não foi possível concluir o login. Tente novamente.');
    }
  };
}

module.exports = {
  createAuthRouter,
  createFirebaseAuthHandlerProxy,
  cookieParserMiddleware,
  createRequireAuth,
  isAllowedEmailDomain,
  FREE_EMAIL_DOMAINS,
  SESSION_COOKIE_NAME,
  getFirebaseApp,
  getAuthInstance,
};
