-- CreateTable
CREATE TABLE "StudioMetricDaily" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "variantLabel" TEXT NOT NULL DEFAULT 'A',
    "stepIndex" INTEGER NOT NULL DEFAULT 1,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "deliveredEstimated" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "opensEstimated" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "unsubs" INTEGER NOT NULL DEFAULT 0,
    "whatsappReads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StudioMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioMetricDaily_campaignId_idx" ON "StudioMetricDaily"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioMetricDaily_campaignId_day_channel_variantLabel_stepI_key" ON "StudioMetricDaily"("campaignId", "day", "channel", "variantLabel", "stepIndex");

