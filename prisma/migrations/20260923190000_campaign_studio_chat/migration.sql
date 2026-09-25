-- CreateTable
CREATE TABLE "StudioChatMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "cards" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioChatMessage_campaignId_createdAt_idx" ON "StudioChatMessage"("campaignId", "createdAt");

