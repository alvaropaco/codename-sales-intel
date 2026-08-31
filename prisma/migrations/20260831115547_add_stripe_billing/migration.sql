-- Billing Stripe: customer e subscription da assinatura do plano premium.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "stripeCustomerId"     TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripePlanStatus"     TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");
