-- AlterTable
ALTER TABLE "OutreachCampaign" ADD COLUMN     "guardrails" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sequence" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "studioCampaignId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppCampaign" ADD COLUMN     "guardrails" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "studioCampaignId" TEXT;

-- CreateTable
CREATE TABLE "StudioCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "offer" TEXT,
    "funnelStage" TEXT NOT NULL DEFAULT 'middle',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statusReason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "sourceCampaignId" TEXT,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "goalMetric" TEXT,
    "convertedValue" INTEGER,
    "utmTemplate" JSONB NOT NULL DEFAULT '{}',
    "fallbackPolicy" JSONB NOT NULL DEFAULT '{}',
    "approval" JSONB NOT NULL DEFAULT '{}',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "emailExecutionId" TEXT,
    "whatsappExecutionId" TEXT,
    "journeyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioSegment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL,
    "naturalLanguageInput" TEXT,
    "lastCount" INTEGER,
    "lastCountAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioAudienceSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "segmentId" TEXT,
    "criteriaVersion" JSONB NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "includedCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioAudienceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioAudienceMember" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "excludeReason" TEXT,
    "variantLabel" TEXT,
    "excludedManuallyById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioAudienceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioContent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL DEFAULT 'A',
    "kind" TEXT NOT NULL DEFAULT 'base',
    "stepIndex" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "emailDoc" JSONB,
    "subject" TEXT,
    "preheader" TEXT,
    "whatsappText" TEXT,
    "whatsappMeta" JSONB,
    "linkedinText" TEXT,
    "ctaUrl" TEXT,
    "tone" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "editHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioCampaign_orgId_idx" ON "StudioCampaign"("orgId");

-- CreateIndex
CREATE INDEX "StudioCampaign_status_idx" ON "StudioCampaign"("status");

-- CreateIndex
CREATE INDEX "StudioSegment_orgId_idx" ON "StudioSegment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioSegment_orgId_name_key" ON "StudioSegment"("orgId", "name");

-- CreateIndex
CREATE INDEX "StudioAudienceSnapshot_campaignId_idx" ON "StudioAudienceSnapshot"("campaignId");

-- CreateIndex
CREATE INDEX "StudioAudienceMember_snapshotId_idx" ON "StudioAudienceMember"("snapshotId");

-- CreateIndex
CREATE INDEX "StudioAudienceMember_prospectId_idx" ON "StudioAudienceMember"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioAudienceMember_snapshotId_prospectId_key" ON "StudioAudienceMember"("snapshotId", "prospectId");

-- CreateIndex
CREATE INDEX "StudioContent_campaignId_channel_variantLabel_kind_stepInde_idx" ON "StudioContent"("campaignId", "channel", "variantLabel", "kind", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachCampaign_studioCampaignId_key" ON "OutreachCampaign"("studioCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCampaign_studioCampaignId_key" ON "WhatsAppCampaign"("studioCampaignId");

-- AddForeignKey
ALTER TABLE "StudioAudienceSnapshot" ADD CONSTRAINT "StudioAudienceSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "StudioCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAudienceMember" ADD CONSTRAINT "StudioAudienceMember_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StudioAudienceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioContent" ADD CONSTRAINT "StudioContent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "StudioCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

