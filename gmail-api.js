/**
 * Gmail API client for sending messages and syncing mailbox.
 *
 * Uses googleapis Node.js client library with OAuth2 tokens
 * stored encrypted in the EmailAccount table.
 *
 * Auth flow:
 *   1. GET /api/gmail/auth-url  →  redirect user to Google consent
 *   2. GET /api/gmail/callback  →  exchange code for tokens
 *   3. Tokens encrypted → saved to EmailAccount table
 *   4. Outbound workers refresh access_token as needed
 */
const crypto = require('crypto');
const { google } = require('googleapis');
const { encrypt, decrypt, getGoogleConfig } = require('./gmail-auth');

// OAuth2 state tracker (short-lived, in-memory)
const _oauthState = new Map();

/**
 * Generate Google OAuth2 authorization URL.
 * Stores state in memory to prevent CSRF.
 *
 * @param {string} userId - internal user id
 * @returns {string} authorization URL
 */
function getAuthUrl(userId) {
  const config = getGoogleConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  const state = crypto.randomUUID();
  _oauthState.set(state, { userId, createdAt: Date.now() });

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // get refresh_token
    response_type: 'code',
    scope: config.scopes,
    state: state,
    prompt: 'consent', // always show consent screen to ensure refresh_token
  });

  return url;
}

/**
 * Exchange authorization code for tokens and save to DB.
 * Must be called from API handler with prisma available.
 *
 * @param {object} prisma - Prisma client
 * @param {string} code - OAuth authorization code
 * @param {string} userId - internal user id
 * @returns {object} { email, tokens }
 */
async function exchangeCodeForTokens(prisma, code, userId) {
  const config = getGoogleConfig();
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(code);

  // Get user email from Google
  const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
  const { data: googleUser } = await oauth2.userinfo.get();

  // Find or create EmailAccount (uma linha por email; não pode
  // sobrescrever contas de outros providers do mesmo usuário)
  let account = await prisma.emailAccount.findFirst({
    where: { userId, email: googleUser.email },
  });

  const encryptedRefreshToken = tokens.refresh_token
    ? encrypt(tokens.refresh_token)
    : null;

  const scopes = tokens.scope ? tokens.scope.split(' ') : config.scopes;

  // tenantId = org do dono (o userId era só um fallback que quebrava lookups
  // escopados por organization.id). No update também normaliza contas
  // antigas que foram gravadas com o fallback errado.
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true },
  });
  const tenantId = owner?.orgId || userId;

  if (account) {
    account = await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        provider: 'gmail',
        tenantId,
        email: googleUser.email,
        encryptedRefreshToken,
        encryptedSecret: null,
        scopes,
        status: 'connected',
      },
    });
  } else {
    account = await prisma.emailAccount.create({
      data: {
        userId,
        tenantId,
        email: googleUser.email,
        encryptedRefreshToken,
        scopes,
        status: 'connected',
      },
    });
  }

  return { email: googleUser.email, tokens };
}

/**
 * Create an OAuth2 client with a valid access token.
 * Refreshes if needed using the stored refresh_token.
 *
 * @param {object} prisma - Prisma client
 * @param {string} emailAccount_id - EmailAccount.id
 * @returns {google.auth.OAuth2} configured OAuth2 client
 */
async function getValidOAuth2Client(prisma, emailAccount_id) {
  const account = await prisma.emailAccount.findUnique({
    where: { id: emailAccount_id },
  });

  if (!account) {
    throw new Error('Email account not found');
  }

  if (account.status !== 'connected') {
    throw new Error(`Email account status is ${account.status}`);
  }

  const config = getGoogleConfig();
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  // Set credentials (refresh_token will be used for auto-refresh)
  try {
    const refreshToken = account.encryptedRefreshToken
      ? decrypt(account.encryptedRefreshToken)
      : null;

    if (refreshToken) {
      oauth2Client.setCredentials({ refresh_token: refreshToken });
    }
  } catch (err) {
    console.error('[gmail] Failed to decrypt refresh token:', err.message);
    throw new Error('Gmail account has invalid credentials');
  }

  // Force a token refresh to get a valid access_token
  try {
    await oauth2Client.refreshAccessToken();
  } catch (err) {
    // Token refresh may fail if user revoked access
    console.error('[gmail] Token refresh failed:', err.message);
    await prisma.emailAccount.update({
      where: { id: emailAccount_id },
      data: { status: 'expired' },
    });
    throw new Error('Gmail credentials expired — reconnect required');
  }

  return oauth2Client;
}

/**
 * Send a single email via Gmail API.
 *
 * Builds an RFC2822 MIME message and calls users.messages.send.
 *
 * @param {object} prisma - Prisma client
 * @param {string} emailAccount_id - EmailAccount.id to send from
 * @param {object} params - { to, subject, body, htmlBody, messageId }
 * @returns {object} { gmailMessageId, gmailThreadId }
 */
async function sendEmail(prisma, emailAccount_id, { to, subject, body, htmlBody, messageId }) {
  const oauth2Client = await getValidOAuth2Client(prisma, emailAccount_id);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Build MIME message
  const boundary = `_boundary_${Date.now()}`;
  let mimeMessage;

  if (htmlBody) {
    mimeMessage = [
      `From: ${await _getSenderEmail(prisma, emailAccount_id)}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      messageId ? `Message-ID: <${messageId}>` : '',
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      body,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      htmlBody,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');
  } else {
    mimeMessage = [
      `From: ${await _getSenderEmail(prisma, emailAccount_id)}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      messageId ? `Message-ID: <${messageId}>` : '',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      body,
      '',
    ].join('\r\n');
  }

  // Gmail API expects base64url encoding
  const encoded = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encoded,
    },
  });

  return {
    gmailMessageId: response.data.id,
    gmailThreadId: response.data.threadId,
  };
}

/**
 * Get the sender email from an EmailAccount.
 */
async function _getSenderEmail(prisma, emailAccount_id) {
  const account = await prisma.emailAccount.findUnique({
    where: { id: emailAccount_id },
    select: { email: true },
  });
  return account?.email || 'unknown@unknown.com';
}

/**
 * List recent changes to the mailbox via Gmail History API.
 * Returns an array of change objects with messages.
 *
 * @param {object} prisma - Prisma client
 * @param {string} emailAccount_id - EmailAccount.id
 * @param {string} [historyId] - lastHistoryId from EmailAccount (optional)
 * @returns {Promise<{changes: object[], newHistoryId: string}>}
 */
async function listHistory(prisma, emailAccount_id, historyId) {
  const oauth2Client = await getValidOAuth2Client(prisma, emailAccount_id);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const params = {
    userId: 'me',
    startHistoryId: historyId || '0',
    maxResults: 500,
  };

  const response = await gmail.users.history.list(params);
  const history = response.data.history || [];
  const newHistoryId = response.data.historyId || historyId || '0';

  return {
    changes: history,
    newHistoryId,
  };
}

/**
 * Get a Gmail message by ID (for reply detection).
 * Returns message metadata including headers.
 */
async function getMessage(prisma, emailAccount_id, messageId) {
  const oauth2Client = await getValidOAuth2Client(prisma, emailAccount_id);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Message-ID', 'In-Reply-To', 'References'],
  });

  return response.data;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getValidOAuth2Client,
  sendEmail,
  listHistory,
  getMessage,
};
