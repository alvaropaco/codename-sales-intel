-- CreateTable
CREATE TABLE "StudioJourney" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "stopConditions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "webhookToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioJourneyLead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "currentBlockId" TEXT,
    "waitingUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "stopReason" TEXT,
    "blockHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioJourneyLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioJourney_orgId_idx" ON "StudioJourney"("orgId");

-- CreateIndex
CREATE INDEX "StudioJourney_campaignId_idx" ON "StudioJourney"("campaignId");

-- CreateIndex
CREATE INDEX "StudioJourneyLead_journeyId_idx" ON "StudioJourneyLead"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioJourneyLead_journeyId_prospectId_key" ON "StudioJourneyLead"("journeyId", "prospectId");

-- AddForeignKey
ALTER TABLE "StudioJourneyLead" ADD CONSTRAINT "StudioJourneyLead_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "StudioJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

