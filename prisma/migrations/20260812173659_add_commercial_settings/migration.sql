-- Add commercial onboarding/settings preferences without seeding any demo data.
CREATE TABLE "CommercialSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "salesTeamSize" TEXT,
    "targetSegments" JSONB NOT NULL DEFAULT '[]',
    "targetCnaes" JSONB NOT NULL DEFAULT '[]',
    "targetLocations" JSONB NOT NULL DEFAULT '[]',
    "companyStatuses" JSONB NOT NULL DEFAULT '["active"]',
    "targetSizes" JSONB NOT NULL DEFAULT '[]',
    "ageRanges" JSONB NOT NULL DEFAULT '[]',
    "averageTicket" INTEGER,
    "salesCycle" TEXT,
    "valueProposition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialSettings_orgId_key" ON "CommercialSettings"("orgId");
CREATE INDEX "CommercialSettings_orgId_idx" ON "CommercialSettings"("orgId");

ALTER TABLE "CommercialSettings" ADD CONSTRAINT "CommercialSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
