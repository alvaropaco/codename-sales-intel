/**
 * WhatsAppRateLimiter — limites conservadores por conta/recipiente.
 *
 * Não assumimos que uma conta pode enviar indefinidamente. Limites por env:
 *   - messagesPerHour      (default 10)
 *   - messagesPerDay       (default 50)
 *   - minDelayBetweenMessages (segundos, default 45)
 *   - maxDelayBetweenMessages (segundos, default 180)
 *   - activeHours          ("8-20")
 *
 * Adicionamos jitter/randomização aos intervalos (calculateDelay) para evitar
 * comportamento artificialmente uniforme. Não há mecanismo para contornar
 * bloqueios ou políticas da plataforma.
 */
const DEFAULTS = {
  messagesPerHour: 10,
  messagesPerDay: 50,
  minDelay: 45,
  maxDelay: 180,
  activeHoursStart: 8,
  activeHoursEnd: 20,
  timezone: 'America/Sao_Paulo',
  recipientDailyCap: 4,
};

function getConfig() {
  return {
    messagesPerHour: Number(process.env.WHATSAPP_HOURLY_LIMIT || DEFAULTS.messagesPerHour),
    messagesPerDay: Number(process.env.WHATSAPP_DAILY_LIMIT || DEFAULTS.messagesPerDay),
    minDelay: Number(process.env.WHATSAPP_MIN_INTERVAL || DEFAULTS.minDelay),
    maxDelay: Number(process.env.WHATSAPP_MAX_INTERVAL || DEFAULTS.maxDelay),
    activeHoursStart: Number(process.env.WHATSAPP_ALLOWED_HOURS_START || DEFAULTS.activeHoursStart),
    activeHoursEnd: Number(process.env.WHATSAPP_ALLOWED_HOURS_END || DEFAULTS.activeHoursEnd),
    timezone: process.env.WHATSAPP_TIMEZONE || DEFAULTS.timezone,
    recipientDailyCap: Number(process.env.WHATSAPP_RECIPIENT_DAILY_LIMIT || DEFAULTS.recipientDailyCap),
  };
}

function isWithinActiveHours(cfg, now = new Date()) {
  // Uso de hora local (America/Sao_Paulo por padrão). Para produção multi-fuso,
  // usar Intl para calcular a hora no timezone configurado.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hour = Number(formatter.format(now));
  return hour >= cfg.activeHoursStart && hour < cfg.activeHoursEnd;
}

/**
 * Verifica se uma conta/recipiente pode enviar agora.
 * @param {object} prisma
 * @param {object} ctx { whatsappAccountId, phoneNumber }
 * @returns {Promise<{ allowed: boolean, retryIn?: number }>}
 */
async function checkLimit(prisma, ctx) {
  const cfg = getConfig();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const accountFilter = ctx.whatsappAccountId
    ? { conversation: { whatsappAccountId: ctx.whatsappAccountId } }
    : {};

  // Diário por conta.
  const sentToday = await prisma.whatsAppMessage.count({
    where: {
      direction: 'OUTBOUND',
      status: 'SENT',
      sentAt: { gte: todayStart },
      ...accountFilter,
    },
  });
  if (sentToday >= cfg.messagesPerDay) {
    return { allowed: false, retryIn: 24 * 60 * 60 * 1000 };
  }

  // Horário por conta.
  const sentLastHour = await prisma.whatsAppMessage.count({
    where: {
      direction: 'OUTBOUND',
      status: 'SENT',
      sentAt: { gte: oneHourAgo },
      ...accountFilter,
    },
  });
  if (sentLastHour >= cfg.messagesPerHour) {
    return { allowed: false, retryIn: 60 * 60 * 1000 };
  }

  // Intervalo mínimo entre envios (qualquer conta, mesmo recipiente).
  const lastSent = await prisma.whatsAppMessage.findFirst({
    where: { direction: 'OUTBOUND', status: 'SENT', sentAt: { not: null }, ...accountFilter },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  if (lastSent && lastSent.sentAt) {
    const diffMs = now.getTime() - lastSent.sentAt.getTime();
    if (diffMs < cfg.minDelay * 1000) {
      return { allowed: false, retryIn: cfg.minDelay * 1000 - diffMs };
    }
  }

  // Teto diário por recipiente.
  if (ctx.phoneNumber) {
    const recipientSentToday = await prisma.whatsAppMessage.count({
      where: {
        direction: 'OUTBOUND',
        status: 'SENT',
        sentAt: { gte: todayStart },
        conversation: { phoneNumber: ctx.phoneNumber },
      },
    });
    if (recipientSentToday >= cfg.recipientDailyCap) {
      return { allowed: false, retryIn: 24 * 60 * 60 * 1000 };
    }
  }

  if (!isWithinActiveHours(cfg, now)) {
    return { allowed: false, retryIn: 60 * 60 * 1000 };
  }

  return { allowed: true };
}

/**
 * Calcula o atraso (em milissegundos) até o próximo envio, com jitter entre
 * minDelay e maxDelay para evitar cadência artificialmente uniforme.
 */
function calculateDelay(cfg = getConfig()) {
  const jitter = Math.random() * (cfg.maxDelay - cfg.minDelay);
  return Math.round((cfg.minDelay + jitter) * 1000);
}

module.exports = {
  checkLimit,
  calculateDelay,
  getConfig,
  isWithinActiveHours,
};
