-- CreateTable
CREATE TABLE "StudioBrandProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "voice" JSONB NOT NULL DEFAULT '{}',
    "kit" JSONB NOT NULL DEFAULT '{}',
    "consistencyChecks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioBrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioComplianceReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioComplianceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioBrandProfile_orgId_key" ON "StudioBrandProfile"("orgId");

-- CreateIndex
CREATE INDEX "StudioComplianceReview_campaignId_idx" ON "StudioComplianceReview"("campaignId");

