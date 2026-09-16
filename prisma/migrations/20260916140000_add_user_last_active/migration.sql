-- Rastreamento de atividade do usuário no painel admin.
-- lastActiveAt = último momento em que o usuário fez uma request autenticada
-- na plataforma (atualizado com throttle no requireAuth, ~1x/60s por usuário).
-- Serve para o admin ver "última atividade" de cada conta na plataforma.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Backfill opcional: para usuários existentes, o último login conhecido
-- (updatedAt) vira a base de "atividade" — os valores reais se ajustam
-- conforme o usuário volta a usar a plataforma.
UPDATE "User" SET "lastActiveAt" = "updatedAt" WHERE "lastActiveAt" IS NULL;
