-- Discovery Engine (specs/006-discovery-engine)
-- Job/run de providers, entidade canônica multi-tipo, relações tipadas,
-- evidência imutável deduplicada por rawHash, candidato de venda e sinal
-- derivado. Todo recurso é tenant-scoped por orgId.

-- CreateTable
CREATE TABLE "DiscoveryJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "providerConfig" JSONB NOT NULL,
    "providersTotal" INTEGER NOT NULL DEFAULT 0,
    "providersDone" INTEGER NOT NULL DEFAULT 0,
    "providersFailed" INTEGER NOT NULL DEFAULT 0,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastError" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryProviderRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "items" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "lastCursor" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryProviderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryEntity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT,
    "identifiers" JSONB NOT NULL DEFAULT '{}',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRelationship" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "observedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryEvidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT,
    "providerRunId" TEXT,
    "entityId" TEXT,
    "relationshipId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceRef" TEXT,
    "observedValue" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DiscoveryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "companyEntityId" TEXT,
    "cnpj" TEXT,
    "name" TEXT,
    "domain" TEXT,
    "location" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "dedupeKey" TEXT NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "importedProspectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceIds" TEXT[],
    "observedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryJob_orgId_createdAt_idx" ON "DiscoveryJob"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryProviderRun_jobId_provider_key" ON "DiscoveryProviderRun"("jobId", "provider");

-- CreateIndex
CREATE INDEX "DiscoveryProviderRun_orgId_status_idx" ON "DiscoveryProviderRun"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryEntity_orgId_type_canonicalKey_key" ON "DiscoveryEntity"("orgId", "type", "canonicalKey");

-- CreateIndex
CREATE INDEX "DiscoveryEntity_orgId_type_lastSeenAt_idx" ON "DiscoveryEntity"("orgId", "type", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryRelationship_orgId_fromEntityId_toEntityId_type_key" ON "DiscoveryRelationship"("orgId", "fromEntityId", "toEntityId", "type");

-- CreateIndex
CREATE INDEX "DiscoveryRelationship_orgId_fromEntityId_idx" ON "DiscoveryRelationship"("orgId", "fromEntityId");

-- CreateIndex
CREATE INDEX "DiscoveryRelationship_orgId_toEntityId_idx" ON "DiscoveryRelationship"("orgId", "toEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryEvidence_orgId_rawHash_key" ON "DiscoveryEvidence"("orgId", "rawHash");

-- CreateIndex
CREATE INDEX "DiscoveryEvidence_orgId_entityId_idx" ON "DiscoveryEvidence"("orgId", "entityId");

-- CreateIndex
CREATE INDEX "DiscoveryEvidence_providerRunId_idx" ON "DiscoveryEvidence"("providerRunId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_orgId_dedupeKey_key" ON "DiscoveryCandidate"("orgId", "dedupeKey");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_orgId_status_confidence_idx" ON "DiscoveryCandidate"("orgId", "status", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySignal_orgId_companyEntityId_type_key" ON "DiscoverySignal"("orgId", "companyEntityId", "type");

-- CreateIndex
CREATE INDEX "DiscoverySignal_orgId_type_observedAt_idx" ON "DiscoverySignal"("orgId", "type", "observedAt");

-- AddForeignKey
ALTER TABLE "DiscoveryProviderRun" ADD CONSTRAINT "DiscoveryProviderRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
