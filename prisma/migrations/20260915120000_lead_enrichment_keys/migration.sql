-- Chaves de enriquecimento opcionais + unicidade de CNPJ por org.
-- A identidade do lead passa a ser o id do Prospect; o CNPJ vira uma chave
-- opcional de enriquecimento (leads importados sem CNPJ ficam null).

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "taxIdType" TEXT DEFAULT 'br_cnpj';
ALTER TABLE "Prospect" ADD COLUMN "domain" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "importKey" TEXT;
ALTER TABLE "Prospect" ALTER COLUMN "cnpj" DROP NOT NULL;

-- Redefine a unicidade: por org (dois clientes podem prospectar a mesma
-- empresa). NULLs não conflitam em índice único no Postgres.
DROP INDEX "Prospect_cnpj_key";
CREATE UNIQUE INDEX "Prospect_orgId_cnpj_key" ON "Prospect"("orgId", "cnpj");
CREATE UNIQUE INDEX "Prospect_orgId_importKey_key" ON "Prospect"("orgId", "importKey");

-- CreateTable — ledger de pedidos de enriquecimento (correlação request →
-- prospect/org via request_event_id; auditoria por provider).
CREATE TABLE "EnrichmentRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "cnpj" TEXT,
    "taxIdType" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'nats.br_cnpj.v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentRequest_eventId_key" ON "EnrichmentRequest"("eventId");
CREATE INDEX "EnrichmentRequest_prospectId_idx" ON "EnrichmentRequest"("prospectId");
CREATE INDEX "EnrichmentRequest_orgId_idx" ON "EnrichmentRequest"("orgId");

-- AddForeignKey
ALTER TABLE "EnrichmentRequest" ADD CONSTRAINT "EnrichmentRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnrichmentRequest" ADD CONSTRAINT "EnrichmentRequest_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rastreabilidade do org/prospect nos resultados do pipeline (log segue por
-- empresa; a idempotência por prospect fica na enrichmentVersion do Prospect).
ALTER TABLE "CnpjEnrichment" ADD COLUMN "orgId" TEXT;
ALTER TABLE "CnpjEnrichment" ADD COLUMN "prospectId" TEXT;
CREATE INDEX "CnpjEnrichment_orgId_idx" ON "CnpjEnrichment"("orgId");
CREATE INDEX "CnpjEnrichment_prospectId_idx" ON "CnpjEnrichment"("prospectId");
