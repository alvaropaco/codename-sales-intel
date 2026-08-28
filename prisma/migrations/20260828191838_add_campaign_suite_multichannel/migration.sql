-- AlterTable
ALTER TABLE "OutreachCampaign" ADD COLUMN     "autoActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoWhatsAppCampaignId" TEXT,
ADD COLUMN     "channels" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "emailAccountId" TEXT,
ADD COLUMN     "emailTemplateBody" TEXT,
ADD COLUMN     "emailTemplateSubject" TEXT,
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "whatsappAccountId" TEXT,
ADD COLUMN     "whatsappTemplate" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "contactedChannels" JSONB NOT NULL DEFAULT '[]';
