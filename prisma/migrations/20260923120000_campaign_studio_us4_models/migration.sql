-- CreateTable
CREATE TABLE "StudioMaterial" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "extraction" JSONB,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionError" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioPersonalization" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "dataBasis" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "editedById" TEXT,
    "propagatedRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioPersonalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'system',
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "funnelStage" TEXT NOT NULL DEFAULT 'middle',
    "subject" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "variables" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioMaterial_orgId_idx" ON "StudioMaterial"("orgId");

-- CreateIndex
CREATE INDEX "StudioPersonalization_contentId_idx" ON "StudioPersonalization"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioPersonalization_contentId_prospectId_key" ON "StudioPersonalization"("contentId", "prospectId");

-- CreateIndex
CREATE INDEX "StudioTemplate_orgId_objective_idx" ON "StudioTemplate"("orgId", "objective");

-- AddForeignKey
ALTER TABLE "StudioPersonalization" ADD CONSTRAINT "StudioPersonalization_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "StudioContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

