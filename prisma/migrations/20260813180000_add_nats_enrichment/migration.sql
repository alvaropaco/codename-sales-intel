-- Add NATS enrichment pipeline persistence.
-- 1) Track the applied enrichment version on Prospect (guards against reordering
--    of at-least-once messages: only newer versions are applied).
ALTER TABLE "Prospect" ADD COLUMN "enrichmentVersion" INTEGER NOT NULL DEFAULT 0;

-- 2) Idempotent result table keyed by (companyId, enrichmentVersion).
CREATE TABLE "CnpjEnrichment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "enrichmentVersion" INTEGER NOT NULL DEFAULT 1,
    "requestEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "companyName" TEXT,
    "tradeName" TEXT,
    "industry" TEXT,
    "revenueEstimate" INTEGER,
    "employees" INTEGER,
    "cnpjEmail" TEXT,
    "cnpjPhones" JSONB,
    "cnpjPartners" JSONB,
    "cnpjOpenedAt" TIMESTAMP(3),
    "cnpjLegalNature" TEXT,
    "score" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CnpjEnrichment_pkey" PRIMARY KEY ("id")
);

-- Unique key for idempotent persistence (company_id + enrichment_version).
CREATE UNIQUE INDEX "CnpjEnrichment_companyId_enrichmentVersion_key"
    ON "CnpjEnrichment"("companyId", "enrichmentVersion");

-- Lookup indexes for status queries and CNPJ-based matching.
CREATE INDEX "CnpjEnrichment_cnpj_idx" ON "CnpjEnrichment"("cnpj");
CREATE INDEX "CnpjEnrichment_status_idx" ON "CnpjEnrichment"("status");
