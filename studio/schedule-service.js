'use strict';

/**
 * studio/schedule-service.js — janelas de envio, ritmo e previsão de
 * conclusão (specs/010, T033; FR-016–FR-022, FR-079).
 *
 * Funções puras e testáveis: `inWindow` avalia janelas no fuso da org ou do
 * lead (FR-022), `forecast` projeta a conclusão (FR-020), `decideConflict`
 * aplica a política de conflito entre campanhas e `nextFollowup` resolve a
 * sequência de follow-ups configurável (FR-079).
 */

const DEFAULT_TZ = 'America/Sao_Paulo';
const WEEKDAY_MAP = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const LEGACY_FOLLOWUP_DELAYS = [3, 5, 7]; // comportamento atual do motor

/** {hour, day} de um instante num fuso IANA (day: 1=segunda … 7=domingo). */
function hourInTz(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const weekdayShort = parts.find((p) => p.type === 'weekday').value;
  return { hour, day: WEEKDAY_MAP[weekdayShort] };
}

function startOfDayInTz(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 12));
}

/**
 * O instante `at` está dentro de alguma janela? Sem janelas configuradas,
 * envio é 24/7. Com `useLeadTimezone` e fuso do lead conhecido, rege o fuso
 * do lead; caso contrário, o da organização (FR-022).
 */
function inWindow(schedule, at, leadTimezone) {
  const windows = schedule?.windows || [];
  if (windows.length === 0) return true;
  const timezone = schedule.useLeadTimezone && leadTimezone ? leadTimezone : schedule.timezone || DEFAULT_TZ;
  const { hour, day } = hourInTz(at, timezone);
  return windows.some((w) => (w.days || []).includes(day) && hour >= w.startHour && hour < w.endHour);
}

/**
 * Previsão de conclusão (FR-020): simula hora a hora (até 90 dias) dentro
 * das janelas acumulando `hourlyLimit` por hora até cobrir `remaining`.
 */
function forecast(schedule, remaining, from = new Date()) {
  if (!remaining || remaining <= 0) return { estimatedAt: new Date(from), hoursNeeded: 0 };
  const hourly = schedule.hourlyLimit || 5;
  for (let i = 0; i < 24 * 90; i++) {
    const cursor = new Date(from.getTime() + i * 3600_000);
    if (!inWindow(schedule, cursor)) continue;
    const capacity = hourly * (i + 1 === 0 ? 1 : 1); // por hora avaliada
    let accumulated = 0;
    // Recalcula acumulado até esta hora (simples e determinístico).
    for (let j = 0; j <= i; j++) {
      const step = new Date(from.getTime() + j * 3600_000);
      if (inWindow(schedule, step)) accumulated += hourly;
    }
    if (accumulated >= remaining) {
      return { estimatedAt: cursor, hoursNeeded: i + 1, capacity };
    }
  }
  return { estimatedAt: null, hoursNeeded: null }; // janela nunca alcançada
}

/** Política de conflito entre campanhas sobre o mesmo lead (edge case). */
function decideConflict(fallbackPolicy = {}, hasActiveOtherCampaign) {
  if (!hasActiveOtherCampaign) return 'send';
  const policy = fallbackPolicy.campaignConflict;
  if (policy === 'block') return 'block';
  return 'postpone'; // default conservador
}

/**
 * Próximo follow-up de e-mail (FR-079): sequência configurada do Studio tem
 * precedência; sem configuração, o comportamento legado do motor ([3,5,7],
 * máx. 4 toques) é preservado.
 */
function nextFollowup(sequence, currentSeq) {
  if (Array.isArray(sequence) && sequence.length > 0) {
    const nextSeq = currentSeq + 1;
    const step = sequence.find((s) => s.stepIndex === nextSeq);
    if (!step) return null;
    return { stepIndex: nextSeq, delayDays: step.delayDays ?? 3 };
  }
  const nextSeq = currentSeq + 1;
  if (nextSeq > 4) return null; // máx. 4 toques (legado)
  const delayDays = LEGACY_FOLLOWUP_DELAYS[currentSeq - 1];
  return delayDays == null ? null : { stepIndex: nextSeq, delayDays };
}

module.exports = {
  DEFAULT_TZ,
  LEGACY_FOLLOWUP_DELAYS,
  hourInTz,
  startOfDayInTz,
  inWindow,
  forecast,
  decideConflict,
  nextFollowup,
};
