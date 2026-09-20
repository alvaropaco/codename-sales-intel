-- Resiliência e observabilidade do enriquecimento (feature 006-enrichment-resilience)
-- PARKED/DEGRADED + auditoria de retries + registro de notificações.

-- AlterTable
ALTER TABLE "EnrichmentTask" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "parkedAt" TIMESTAMP(3),
ADD COLUMN     "parkCycles" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EnrichmentTaskRetryEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "errorType" TEXT NOT NULL,
    "provider" TEXT,
    "message" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentTaskRetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsNotification" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "orgId" TEXT,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentTask_nextAttemptAt_idx" ON "EnrichmentTask"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "EnrichmentTask_status_nextAttemptAt_idx" ON "EnrichmentTask"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpsNotification_dedupKey_key" ON "OpsNotification"("dedupKey");

-- CreateIndex
CREATE INDEX "OpsNotification_createdAt_idx" ON "OpsNotification"("createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentTaskRetryEvent_taskId_cycle_idx" ON "EnrichmentTaskRetryEvent"("taskId", "cycle");

-- CreateIndex
CREATE INDEX "EnrichmentTaskRetryEvent_orgId_createdAt_idx" ON "EnrichmentTaskRetryEvent"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "EnrichmentTaskRetryEvent" ADD CONSTRAINT "EnrichmentTaskRetryEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "EnrichmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
