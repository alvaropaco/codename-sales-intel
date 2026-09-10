-- Campanhas criadas pelo gerador de IA (feature premium).
ALTER TABLE "OutreachCampaign" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "WhatsAppCampaign" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- Step de sequência WhatsApp com mensagem única por lead (IA); template vira fallback.
ALTER TABLE "WhatsAppSequenceStep" ADD COLUMN "aiPersonalized" BOOLEAN NOT NULL DEFAULT false;
