-- Memória de mapeamento de imports CSV por org: guarda apenas cabeçalhos +
-- mapeamento aceito (nunca valores das linhas) para reusar como referência
-- nos próximos imports do mesmo cliente.

-- CreateTable
CREATE TABLE "CsvMappingMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "headerSignature" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvMappingMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsvMappingMemory_orgId_headerSignature_key" ON "CsvMappingMemory"("orgId", "headerSignature");
CREATE INDEX "CsvMappingMemory_orgId_idx" ON "CsvMappingMemory"("orgId");

-- AddForeignKey
ALTER TABLE "CsvMappingMemory" ADD CONSTRAINT "CsvMappingMemory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
