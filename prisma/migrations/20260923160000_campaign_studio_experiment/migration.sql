-- CreateTable
CREATE TABLE "StudioExperiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "split" JSONB NOT NULL DEFAULT '{}',
    "winnerCriterion" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'running',
    "winnerVariant" TEXT,
    "declaredAt" TIMESTAMP(3),
    "declaredBasis" JSONB,
    "continuousOptimization" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioExperiment_campaignId_idx" ON "StudioExperiment"("campaignId");

