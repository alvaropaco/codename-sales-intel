-- Contexto de negócio da org (pilar 1 dos prompts de IA — org-context.js).
ALTER TABLE "CommercialSettings" ADD COLUMN "productDescription" TEXT;
ALTER TABLE "CommercialSettings" ADD COLUMN "businessModel" TEXT;
ALTER TABLE "CommercialSettings" ADD COLUMN "differentiators" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CommercialSettings" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "CommercialSettings" ADD COLUMN "ctaGoal" TEXT;
ALTER TABLE "CommercialSettings" ADD COLUMN "toneNotes" TEXT;

-- Proposta comercial da campanha (pilar 2 dos prompts de IA).
ALTER TABLE "OutreachCampaign" ADD COLUMN "objective" TEXT;
ALTER TABLE "OutreachCampaign" ADD COLUMN "offer" TEXT;
ALTER TABLE "WhatsAppCampaign" ADD COLUMN "objective" TEXT;
ALTER TABLE "WhatsAppCampaign" ADD COLUMN "offer" TEXT;
ALTER TABLE "WhatsAppCampaign" ADD COLUMN "ctaUrl" TEXT;

-- Auditoria do contexto usado na geração (org configurada? campanha de origem?).
ALTER TABLE "WhatsAppReengagementEvent" ADD COLUMN "context" JSONB;
