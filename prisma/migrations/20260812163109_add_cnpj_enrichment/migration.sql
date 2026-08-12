-- Add CNPJ enrichment persistence fields to Prospect
ALTER TABLE "Prospect" ADD COLUMN "tradeName" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "cnpjEmail" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "cnpjPhones" JSONB;
ALTER TABLE "Prospect" ADD COLUMN "cnpjPartners" JSONB;
ALTER TABLE "Prospect" ADD COLUMN "cnpjRawData" JSONB;
ALTER TABLE "Prospect" ADD COLUMN "cnpjOpenedAt" TIMESTAMP(3);
ALTER TABLE "Prospect" ADD COLUMN "cnpjLegalNature" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Prospect" ADD COLUMN "enrichmentSource" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "enrichmentError" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "enrichedAt" TIMESTAMP(3);

CREATE INDEX "Prospect_createdAt_idx" ON "Prospect"("createdAt");
CREATE INDEX "Prospect_enrichedAt_idx" ON "Prospect"("enrichedAt");
CREATE INDEX "Prospect_enrichmentStatus_idx" ON "Prospect"("enrichmentStatus");
