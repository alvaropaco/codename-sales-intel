-- DropIndex
DROP INDEX "EnrichmentTask_nextAttemptAt_idx";

-- AlterTable
ALTER TABLE "DiscoverySignal" ALTER COLUMN "evidenceIds" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "OutreachCampaign" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "compositionOrigin" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppCampaign" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "compositionOrigin" TEXT;
