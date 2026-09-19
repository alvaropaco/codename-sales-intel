-- Análise profunda de lead por IA (feature 005-deep-lead-analysis)
-- Nova tabela DeepAnalysis (uma linha por execução) + campos em Prospect.

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "analysisStatus" TEXT NOT NULL DEFAULT 'not_started',
ADD COLUMN     "verdict" TEXT,
ADD COLUMN     "currentDeepAnalysisId" TEXT;

-- CreateTable
CREATE TABLE "DeepAnalysis" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "modelVersion" TEXT,
    "finalScore" INTEGER,
    "verdict" TEXT,
    "summary" TEXT,
    "impressions" JSONB NOT NULL DEFAULT '[]',
    "factorsPro" JSONB NOT NULL DEFAULT '[]',
    "factorsCon" JSONB NOT NULL DEFAULT '[]',
    "deterministicScore" INTEGER,
    "contactDecisionSnapshot" JSONB,
    "orgContextConsidered" BOOLEAN NOT NULL DEFAULT false,
    "override" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "enrichmentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeepAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_currentDeepAnalysisId_key" ON "Prospect"("currentDeepAnalysisId");

-- CreateIndex
CREATE INDEX "DeepAnalysis_prospectId_idx" ON "DeepAnalysis"("prospectId");

-- CreateIndex
CREATE INDEX "DeepAnalysis_orgId_createdAt_idx" ON "DeepAnalysis"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeepAnalysis" ADD CONSTRAINT "DeepAnalysis_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeepAnalysis" ADD CONSTRAINT "DeepAnalysis_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_currentDeepAnalysisId_fkey" FOREIGN KEY ("currentDeepAnalysisId") REFERENCES "DeepAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma execução de análise ativa por lead (índice parcial — fora do modelo
-- Prisma, aplicado aqui no banco; specs/005-deep-lead-analysis/data-model.md).
CREATE UNIQUE INDEX "DeepAnalysis_one_running_per_prospect" ON "DeepAnalysis"("prospectId") WHERE status = 'running';
