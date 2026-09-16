/**
 * plan.js — plano da organização, compartilhado entre server-prod e os
 * módulos de enriquecimento (gating: enriquecimento profundo é Premium).
 */

function normalizePlan(value) {
  return value === 'premium' ? 'premium' : 'trial';
}

/** Plano normalizado da Organization (default 'trial' quando não existe). */
async function getOrgPlan(prisma, orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true },
  });
  return normalizePlan(org ? org.plan : null);
}

async function isPremiumOrg(prisma, orgId) {
  return (await getOrgPlan(prisma, orgId)) === 'premium';
}

module.exports = { normalizePlan, getOrgPlan, isPremiumOrg };
