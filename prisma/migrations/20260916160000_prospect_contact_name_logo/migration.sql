-- Enriquecimento avançado (premium): nome do contato capturado no import CSV
-- e logo da empresa resolvido no enriquecimento profundo.

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "logoUrl" TEXT;
