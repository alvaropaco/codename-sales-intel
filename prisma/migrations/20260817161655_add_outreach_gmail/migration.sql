-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachContact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "emailAccount_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "outreachSequence" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "nextFollowupAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "templateId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "htmlBody" TEXT,
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "messageHeaderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "trackingToken" TEXT,
    "aiReasoningFacts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailAccount_tenantId_idx" ON "EmailAccount"("tenantId");

-- CreateIndex
CREATE INDEX "EmailAccount_userId_idx" ON "EmailAccount"("userId");

-- CreateIndex
CREATE INDEX "EmailAccount_email_idx" ON "EmailAccount"("email");

-- CreateIndex
CREATE INDEX "OutreachCampaign_tenantId_idx" ON "OutreachCampaign"("tenantId");

-- CreateIndex
CREATE INDEX "OutreachCampaign_status_idx" ON "OutreachCampaign"("status");

-- CreateIndex
CREATE INDEX "OutreachContact_campaignId_idx" ON "OutreachContact"("campaignId");

-- CreateIndex
CREATE INDEX "OutreachContact_prospectId_idx" ON "OutreachContact"("prospectId");

-- CreateIndex
CREATE INDEX "OutreachContact_status_idx" ON "OutreachContact"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_prospectId_campaignId_key" ON "OutreachContact"("prospectId", "campaignId");

-- CreateIndex
CREATE INDEX "OutreachTemplate_tenantId_idx" ON "OutreachTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "OutreachMessage_contactId_idx" ON "OutreachMessage"("contactId");

-- CreateIndex
CREATE INDEX "OutreachMessage_status_idx" ON "OutreachMessage"("status");

-- CreateIndex
CREATE INDEX "OutreachMessage_trackingToken_idx" ON "OutreachMessage"("trackingToken");

-- CreateIndex
CREATE INDEX "OutreachMessage_gmailMessageId_idx" ON "OutreachMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "OutreachEvent_contactId_idx" ON "OutreachEvent"("contactId");

-- CreateIndex
CREATE INDEX "OutreachEvent_messageId_idx" ON "OutreachEvent"("messageId");

-- CreateIndex
CREATE INDEX "OutreachEvent_type_idx" ON "OutreachEvent"("type");

-- CreateIndex
CREATE INDEX "OutreachEvent_createdAt_idx" ON "OutreachEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SuppressionList_tenantId_idx" ON "SuppressionList"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionList_tenantId_email_key" ON "SuppressionList"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "OutreachContact" ADD CONSTRAINT "OutreachContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachContact" ADD CONSTRAINT "OutreachContact_emailAccount_id_fkey" FOREIGN KEY ("emailAccount_id") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OutreachTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutreachMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
