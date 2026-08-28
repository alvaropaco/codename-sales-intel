-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "encryptedSecret" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT false;
