-- Reengajamento automático de conversas WhatsApp (agente de IA).

-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN "reengageAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "reengageTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppConversation" ADD COLUMN "lastReengageAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppConversation" ADD COLUMN "automationPausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
