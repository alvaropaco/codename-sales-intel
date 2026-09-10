const test = require('node:test');
const assert = require('node:assert');
const {
  checkLimit,
  getConfig,
  msUntilNextAllowedWindow,
  isWithinAllowedHours,
} = require('../outreach-rate-limiter');

// Prisma fake: a 1ª chamada de count é a contagem diária, a 2ª é a da hora.
function fakePrisma({ daily = 0, hourly = 0, lastSentAt = null } = {}) {
  let countCall = 0;
  return {
    emailAccount: { findUnique: async () => ({ provider: 'resend' }) },
    outreachMessage: {
      count: async () => {
        countCall += 1;
        return countCall === 1 ? daily : hourly;
      },
      findFirst: async () => (lastSentAt ? { sentAt: new Date(lastSentAt) } : null),
    },
  };
}

/** Hora/minuto de um instante num fuso IANA (para validar o destino do retry). */
function hourOfDayInTZ(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  return { hour: get('hour') % 24, minute: get('minute') };
}

test('dentro dos limites: envio permitido (ou bloqueio só pela janela)', async () => {
  const cfg = getConfig();
  const result = await checkLimit(fakePrisma({ daily: 5, hourly: 2 }), 'acct-1', cfg);
  if (isWithinAllowedHours(cfg)) {
    assert.deepStrictEqual(result, { allowed: true });
  } else {
    // rodando fora da janela (ex.: após 17h SP): só a janela bloqueia
    assert.strictEqual(result.allowed, false);
    assert.ok(Math.abs(result.retryIn - msUntilNextAllowedWindow(cfg)) < 5000);
  }
});

test('limite diário atingido: retry aponta para a reabertura da janela (não +24h fixas)', async () => {
  const cfg = getConfig();
  const result = await checkLimit(fakePrisma({ daily: 30 }), 'acct-1', cfg);
  assert.strictEqual(result.allowed, false);
  // destino do retry cai na hora de abertura da janela (9h no fuso configurado);
  // tolera o minuto anterior quando a conta do relógio pega a borda de 1s
  const target = hourOfDayInTZ(new Date(Date.now() + result.retryIn), cfg.timezone);
  assert.strictEqual(target.hour, cfg.allowedHoursStart);
  assert.ok([0, 59].includes(target.minute), `minuto inesperado: ${target.minute}`);
  // nunca mais o retry fixo de 24h (teto real: 23h59 até a próxima abertura)
  assert.ok(result.retryIn < 24 * 60 * 60 * 1000);
});

test('retry diário é consistente com msUntilNextAllowedWindow', async () => {
  const cfg = getConfig();
  const result = await checkLimit(fakePrisma({ daily: 30 }), 'acct-1', cfg);
  const expected = msUntilNextAllowedWindow(cfg);
  assert.ok(Math.abs(result.retryIn - expected) < 5000, `${result.retryIn} ≠ ${expected}`);
});

test('limite horário atingido: retry segue de 1h', async () => {
  const result = await checkLimit(fakePrisma({ daily: 5, hourly: 5 }), 'acct-1', getConfig());
  assert.strictEqual(result.allowed, false);
  assert.deepStrictEqual(result.retryIn, 60 * 60 * 1000);
});

test('teto do provider (resend 100/dia) vence o limite configurado', async () => {
  process.env.OUTREACH_DAILY_LIMIT = '200';
  try {
    // sem o teto, 150 enviados < 200 configurados → enviaria; com o cap do
    // Resend (100/dia), 150 >= 100 bloqueia antes
    const result = await checkLimit(fakePrisma({ daily: 150 }), 'acct-1', getConfig());
    assert.strictEqual(result.allowed, false);
    assert.ok(result.retryIn < 24 * 60 * 60 * 1000);
  } finally {
    delete process.env.OUTREACH_DAILY_LIMIT;
  }
});
