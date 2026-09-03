-- JID original do chat WhatsApp (LID/grupo) para envio correto no handoff.

-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN "chatId" TEXT;
