-- Motor de enriquecimento distribuído (specs/001-distributed-enrichment)
-- 5 tabelas novas: EnrichmentJob, EnrichmentTask, EnrichmentResult,
-- EnrichmentEvidence, RawRecord. Sem FKs para tabelas existentes (orgId é
-- coluna simples) — isolamento por organização é aplicado nas queries.

-- CreateTable
CREATE TABLE "EnrichmentJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'v2',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "dependsOn" TEXT[] NOT NULL DEFAULT ARRAY()::TEXT[],
    "depth" INTEGER NOT NULL DEFAULT 0,
    "spawnedByTaskId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL,
    "data" JSONB,
    "confidence" DOUBLE PRECISION,
    "durationMs" INTEGER NOT NULL,
    "workerVersion" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentEvidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "provider" TEXT,
    "url" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "payload" TEXT,
    "storageBackend" TEXT NOT NULL DEFAULT 'postgres',
    "storageRef" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentTask_taskKey_key" ON "EnrichmentTask"("taskKey");

-- CreateIndex
CREATE INDEX "EnrichmentJob_orgId_createdAt_idx" ON "EnrichmentJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentJob_prospectId_createdAt_idx" ON "EnrichmentJob"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentTask_jobId_status_idx" ON "EnrichmentTask"("jobId", "status");

-- CreateIndex
CREATE INDEX "EnrichmentTask_status_priority_idx" ON "EnrichmentTask"("status", "priority");

-- CreateIndex
CREATE INDEX "EnrichmentTask_orgId_prospectId_idx" ON "EnrichmentTask"("orgId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentResult_taskId_key" ON "EnrichmentResult"("taskId");

-- CreateIndex
CREATE INDEX "EnrichmentResult_orgId_prospectId_idx" ON "EnrichmentResult"("orgId", "prospectId");

-- CreateIndex
CREATE INDEX "EnrichmentResult_jobId_idx" ON "EnrichmentResult"("jobId");

-- CreateIndex
CREATE INDEX "EnrichmentEvidence_orgId_attribute_idx" ON "EnrichmentEvidence"("orgId", "attribute");

-- CreateIndex
CREATE INDEX "RawRecord_orgId_capability_createdAt_idx" ON "RawRecord"("orgId", "capability", "createdAt");

-- AddForeignKey
ALTER TABLE "EnrichmentTask" ADD CONSTRAINT "EnrichmentTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EnrichmentJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentResult" ADD CONSTRAINT "EnrichmentResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "EnrichmentTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentEvidence" ADD CONSTRAINT "EnrichmentEvidence_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "EnrichmentResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
