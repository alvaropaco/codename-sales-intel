-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "campaignContactId" TEXT,
ADD COLUMN "stepIndex" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_campaignContactId_stepIndex_key" ON "WhatsAppMessage"("campaignContactId", "stepIndex");
