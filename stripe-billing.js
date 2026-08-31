/**
 * stripe-billing — assinatura do plano premium via Stripe Checkout.
 *
 * Fluxo: o org em trial pede um Checkout Session (mode=subscription) no
 * endpoint /api/billing/checkout-session e é redirecionado ao Stripe. O
 * plano só muda via webhook (fonte de verdade = ciclo de vida da
 * assinatura), nunca na página de sucesso — ver handleStripeWebhookEvent.
 *
 * Requisitos de env:
 *   STRIPE_SECRET_KEY    — rk_/sk_ (teste ou live)
 *   STRIPE_PRICE_ID      — price_xxx do plano premium (mensal)
 *   STRIPE_WEBHOOK_SECRET— whsec_... (só para o endpoint de webhook)
 *
 * Convenções (skill stripe-best-practices):
 *   - nunca enviar payment_method_types (métodos dinâmicos do Dashboard);
 *   - instância de StripeClient, sem api key global;
 *   - integration_identifier com sufixo de 8 letras aleatórias.
 */
const crypto = require('crypto');
const Stripe = require('stripe');

let _stripe = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('Billing não configurado: defina STRIPE_SECRET_KEY.');
    err.status = 503;
    throw err;
  }
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function isBillingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

/**
 * Customer Stripe do org — cria na primeira vez e reusa (o customer
 * persiste cartão e assinaturas entre tentativas de checkout).
 */
async function getOrCreateStripeCustomer(prisma, org) {
  const stripe = getStripe();

  if (org.stripeCustomerId) {
    try {
      return await stripe.customers.retrieve(org.stripeCustomerId);
    } catch (err) {
      // customer apagado no Dashboard → recria abaixo
      console.warn(`[billing] customer ${org.stripeCustomerId} inválido, recriando: ${err.message}`);
    }
  }

  const customer = await stripe.customers.create({
    name: org.name,
    metadata: { orgId: org.id },
  });
  await prisma.organization.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer;
}

/**
 * Checkout Session de assinatura do plano premium.
 * baseUrl = origem do frontend (para success/cancel voltarem pra Settings).
 */
async function createPremiumCheckoutSession(prisma, org, baseUrl) {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    const err = new Error('Billing não configurado: defina STRIPE_PRICE_ID.');
    err.status = 503;
    throw err;
  }

  const customer = await getOrCreateStripeCustomer(prisma, org);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: org.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { orgId: org.id } },
    success_url: `${baseUrl}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/settings?checkout=cancel`,
    allow_promotion_codes: true,
    integration_identifier: `b2base-checkout-${crypto.randomBytes(4).toString('hex')}`,
  });
}

/**
 * Sessão do Customer Portal (trocar cartão, cancelar, ver faturas).
 * Só faz sentido para org com assinatura ativa — sem assinatura o portal
 * não tem nada para gerenciar.
 */
async function createBillingPortalSession(prisma, org, baseUrl) {
  const stripe = getStripe();
  if (!org.stripeCustomerId || !org.stripeSubscriptionId) {
    const err = new Error('Nenhuma assinatura encontrada para esta organização.');
    err.status = 400;
    throw err;
  }
  return stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${baseUrl}/settings`,
  });
}

// ─── Webhook: fonte de verdade do plano ──────────────────────────────────────

async function findOrgBy(prisma, { orgId, customerId, subscriptionId }) {
  if (orgId) {
    const byId = await prisma.organization.findUnique({ where: { id: orgId } });
    if (byId) return byId;
  }
  if (subscriptionId) {
    const bySub = await prisma.organization.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (bySub) return bySub;
  }
  if (customerId) {
    const byCustomer = await prisma.organization.findFirst({ where: { stripeCustomerId: customerId } });
    if (byCustomer) return byCustomer;
  }
  return null;
}

/**
 * Estado-fonte → plano. Assinatura saudável (ativa, em trial ou em
 * recuperação de pagamento) mantém premium; cancelada/expirada rebaixa.
 */
async function applySubscriptionState(prisma, org, { customerId, subscriptionId, status }) {
  const premium = ['active', 'trialing', 'past_due', 'unpaid'].includes(status);
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      plan: premium ? 'premium' : 'trial',
      stripeCustomerId: customerId || org.stripeCustomerId,
      stripeSubscriptionId: subscriptionId || (premium ? org.stripeSubscriptionId : null),
      stripePlanStatus: status,
    },
  });
  console.log(`[billing] org ${org.id}: assinatura ${status} → plano ${premium ? 'premium' : 'trial'}`);
}

/**
 * Processa um evento já verificado do Stripe. Nunca lança — falhas de
 * suíte não podem derrubar o endpoint de webhook (Stripe faria retry
 * exponencial de qualquer forma; logar basta para eventos ignoráveis).
 */
async function handleStripeWebhookEvent(prisma, event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      // Gate de payment_status: pagamento efetivado (ou sem pagamento
      // necessário) é o que ativa o premium.
      if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
        console.log(`[billing] checkout ${session.id} com payment_status=${session.payment_status} — aguardando`);
        return { handled: false, reason: `payment_status=${session.payment_status}` };
      }
      const stripe = getStripe();
      const subscription = session.subscription
        ? await stripe.subscriptions.retrieve(session.subscription)
        : null;
      const org = await findOrgBy(prisma, {
        orgId: session.client_reference_id || session.metadata?.orgId,
        customerId: session.customer,
        subscriptionId: subscription?.id,
      });
      if (!org) {
        console.error(`[billing] checkout ${session.id} sem org correspondente (customer=${session.customer})`);
        return { handled: false, reason: 'org não encontrado' };
      }
      await applySubscriptionState(prisma, org, {
        customerId: session.customer,
        subscriptionId: subscription?.id || null,
        status: subscription?.status || 'active',
      });
      return { handled: true };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const org = await findOrgBy(prisma, {
        orgId: sub.metadata?.orgId,
        customerId: sub.customer,
        subscriptionId: sub.id,
      });
      if (!org) return { handled: false, reason: 'org não encontrado' };
      await applySubscriptionState(prisma, org, {
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: sub.status,
      });
      return { handled: true };
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const org = await findOrgBy(prisma, {
        orgId: sub.metadata?.orgId,
        customerId: sub.customer,
        subscriptionId: sub.id,
      });
      if (!org) return { handled: false, reason: 'org não encontrado' };
      await applySubscriptionState(prisma, org, {
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: 'canceled',
      });
      return { handled: true };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (!invoice.subscription) return { handled: false, reason: 'sem subscription' };
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(invoice.subscription);
      const org = await findOrgBy(prisma, {
        customerId: sub.customer,
        subscriptionId: sub.id,
      });
      if (!org) return { handled: false, reason: 'org não encontrado' };
      await applySubscriptionState(prisma, org, {
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: sub.status || 'past_due',
      });
      return { handled: true };
    }

    default:
      return { handled: false, reason: `evento ${event.type} ignorado` };
  }
}

module.exports = {
  isBillingConfigured,
  getStripe,
  getOrCreateStripeCustomer,
  createPremiumCheckoutSession,
  createBillingPortalSession,
  handleStripeWebhookEvent,
};
