-- CreateTable
CREATE TABLE "StudioReplyClassification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioReplyClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioReplyClassification_orgId_prospectId_idx" ON "StudioReplyClassification"("orgId", "prospectId");

-- CreateIndex
CREATE INDEX "StudioReplyClassification_label_idx" ON "StudioReplyClassification"("label");

