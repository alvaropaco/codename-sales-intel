-- Auditoria e fila de sugestões do agente de reengajamento (modo suggest).

-- CreateTable
CREATE TABLE "WhatsAppReengagementEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "prospectId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "strategy" TEXT,
    "reason" TEXT,
    "content" TEXT,
    "origin" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppReengagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppReengagementEvent_orgId_status_createdAt_idx" ON "WhatsAppReengagementEvent"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppReengagementEvent_conversationId_idx" ON "WhatsAppReengagementEvent"("conversationId");
