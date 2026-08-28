/**
 * MailboxRateLimiter — per-account rate limiting for outbound sends.
 *
 * Rules (configurable via env):
 *   - daily_limit:    max sends per account per day       (default 30)
 *   - hourly_limit:   max sends per account per hour       (default 5)
 *   - min_interval:   min seconds between sends            (default 60)
 *   - max_interval:   max seconds between sends            (default 600)
 *   - allowed_hours:  "9-17" (24h format range)            (default "9-17")
 *   - timezone:       IANA timezone                        (default "America/Sao_Paulo")
 *
 * Also enforces the Gmail API free-tier daily ceiling (5000 sends/day per account)
 * as a hard cap.
 */
const { getQueues } = require('./outreach-queues');
const { PROVIDER_DAILY_CAPS } = require('./email-provider');

const DEFAULTS = {
  dailyLimit: 30,
  hourlyLimit: 5,
  minInterval: 60,
  maxInterval: 600,
  allowedHoursStart: 9,
  allowedHoursEnd: 17,
  timezone: 'America/Sao_Paulo',
};

// Teto diário por provider (hard cap): gmail API 5000, SMTP Gmail
// gratuito 500, Resend free tier 100.
const DEFAULT_PROVIDER_CAP = 500;

// ─── Get config from env ─────────────────────────────────────────
function getConfig() {
  return {
    dailyLimit: Number(process.env.OUTREACH_DAILY_LIMIT || DEFAULTS.dailyLimit),
    hourlyLimit: Number(process.env.OUTREACH_HOURLY_LIMIT || DEFAULTS.hourlyLimit),
    minInterval: Number(process.env.OUTREACH_MIN_INTERVAL || DEFAULTS.minInterval),
    maxInterval: Number(process.env.OUTREACH_MAX_INTERVAL || DEFAULTS.maxInterval),
    allowedHoursStart: Number(process.env.OUTREACH_ALLOWED_HOURS_START || DEFAULTS.allowedHoursStart),
    allowedHoursEnd: Number(process.env.OUTREACH_ALLOWED_HOURS_END || DEFAULTS.allowedHoursEnd),
    timezone: process.env.OUTREACH_TIMEZONE || DEFAULTS.timezone,
  };
}

/**
 * Check if the current time is within allowed hours.
 */
function isWithinAllowedHours(cfg) {
  const now = new Date();
  // Simple UTC check — in prod use a timezone library like `timezone-date`.
  const hour = now.getHours();
  return hour >= cfg.allowedHoursStart && hour < cfg.allowedHoursEnd;
}

/**
 * Check if an account can send right now.
 * Returns { allowed: true } or { allowed: false, retryIn: ms }.
 */
async function checkLimit(prisma, emailAccount_id, cfg) {
  const limit = getConfig();

  // Hard cap específico do provider da conta
  const account = await prisma.emailAccount.findUnique({
    where: { id: emailAccount_id },
    select: { provider: true },
  });
  const providerCap = PROVIDER_DAILY_CAPS[account?.provider] || DEFAULT_PROVIDER_CAP;

  if (limit.dailyLimit > providerCap) {
    console.warn(`[ratelimit] dailyLimit ${limit.dailyLimit} exceeds provider cap (${providerCap}) — capping.`);
  }

  const dailyCap = Math.min(limit.dailyLimit, providerCap);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Count today's sends
  const sentCount = await prisma.outreachMessage.count({
    where: {
      contact: { emailAccount_id },
      sentAt: { gte: todayStart },
      status: 'SENT',
    },
  });

  if (sentCount >= dailyCap) {
    return { allowed: false, retryIn: 24 * 60 * 60 * 1000 };
  }

  // Count last hour
  const sentLastHour = await prisma.outreachMessage.count({
    where: {
      contact: { emailAccount_id },
      sentAt: { gte: oneHourAgo },
      status: 'SENT',
    },
  });

  if (sentLastHour >= limit.hourlyLimit) {
    return { allowed: false, retryIn: 60 * 60 * 1000 };
  }

  // Check interval since last send
  const lastSent = await prisma.outreachMessage.findFirst({
    where: {
      contact: { emailAccount_id },
      sentAt: { not: null },
      status: 'SENT',
    },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });

  if (lastSent && lastSent.sentAt) {
    const diffMs = now.getTime() - lastSent.sentAt.getTime();
    if (diffMs < limit.minInterval * 1000) {
      return { allowed: false, retryIn: limit.minInterval * 1000 - diffMs };
    }
  }

  if (!isWithinAllowedHours(cfg)) {
    return { allowed: false, retryIn: (cfg.allowedHoursStart * 60 * 60 * 1000) - now.getTime() + (86400000) };
  }

  return { allowed: true };
}

/**
 * Calculate the delay before next send: base_delay + random_jitter.
 */
function calculateDelay(cfg) {
  const jitter = Math.random() * (cfg.maxInterval - cfg.minInterval);
  const delayMs = (cfg.minInterval + jitter) * 1000;
  return Math.round(delayMs / 1000); // seconds
}

module.exports = {
  checkLimit,
  calculateDelay,
  getConfig,
  isWithinAllowedHours,
};
