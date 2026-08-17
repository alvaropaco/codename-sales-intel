/**
 * Token encryption service for storing Gmail refresh tokens.
 *
 * Uses AES-256-GCM with TOKEN_ENCRYPTION_KEY from environment.
 * Key must be a 32-byte hex string (256-bit).
 *
 * Environment variables (in Infisical for production):
 *   TOKEN_ENCRYPTION_KEY — 64-char hex key for AES-256-GCM
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16; // GCM standard
const KEY_LENGTH = 32; // 256 bits

let _encryptionKey = null;

/**
 * Initialize the encryption key from environment.
 * Should be called once at startup.
 */
function initEncryption() {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    console.warn('[encryption] TOKEN_ENCRYPTION_KEY not set — token encryption disabled.');
    console.warn('[encryption] Set a 64-char hex key in .env.local or Infisical.');
    _encryptionKey = null;
    return;
  }

  const keyBuf = Buffer.from(keyHex, 'hex');
  if (keyBuf.length !== KEY_LENGTH) {
    console.error(
      `[encryption] TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${keyBuf.length} bytes.`
    );
    _encryptionKey = null;
    return;
  }

  _encryptionKey = keyBuf;
  console.log('[encryption] Token encryption initialized (AES-256-GCM).');
}

/**
 * Encrypt a plaintext string.
 * Returns a hex-encoded string: <iv>:<authTag>:<ciphertext>
 */
function encrypt(plaintext) {
  if (!_encryptionKey) {
    // Fallback: store as-is with a warning (only in dev without key)
    console.warn('[encryption] No encryption key — storing plaintext (DEVELOPMENT ONLY)');
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, _encryptionKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a previously encrypted string.
 * Expects format: <iv>:<authTag>:<ciphertext>
 */
function decrypt(ciphertext) {
  if (!_encryptionKey) {
    // If not encrypted, return as-is
    return ciphertext;
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGO, _encryptionKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Get Google OAuth2 client configuration.
 */
function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/gmail/callback',
    scopes: ['gmail.send', 'gmail.metadata'],
  };
}

module.exports = {
  initEncryption,
  encrypt,
  decrypt,
  getGoogleConfig,
};
