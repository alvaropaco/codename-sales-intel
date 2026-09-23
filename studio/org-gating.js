'use strict';

/**
 * studio/org-gating.js — gating de plano do Campaign Studio (constituição IV).
 *
 * O Studio é freemium (decisão de clarify): base para todos os planos,
 * capacidades de IA avançadas exclusivas do premium. Centraliza o erro
 * semântico do contrato (403 PREMIUM_REQUIRED) sobre o plan.js existente.
 */

const { getOrgPlan } = require('../plan');

const PLAN_GATE_ERROR =
  'Este recurso do Studio é exclusivo do plano Premium. Faça upgrade para desbloquear.';

/**
 * Lança 403 PREMIUM_REQUIRED quando a organização não é premium.
 * `httpError` é injetado para evitar dependência circular com router.js.
 */
async function requirePremiumOrg(prisma, orgId, httpError) {
  const plan = await getOrgPlan(prisma, orgId);
  if (plan !== 'premium') {
    const err = httpError('PREMIUM_REQUIRED', 403, PLAN_GATE_ERROR);
    throw err;
  }
  return plan;
}

module.exports = { requirePremiumOrg, PLAN_GATE_ERROR };
