-- CreateTable
CREATE TABLE "StudioAgentProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "requestPrompt" TEXT NOT NULL,
    "plan" JSONB NOT NULL DEFAULT '{}',
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioAgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioRecommendation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "targetProspectId" TEXT,
    "kind" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "appliedAt" TIMESTAMP(3),
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioAgentProposal_orgId_idx" ON "StudioAgentProposal"("orgId");

-- CreateIndex
CREATE INDEX "StudioRecommendation_orgId_campaignId_idx" ON "StudioRecommendation"("orgId", "campaignId");

