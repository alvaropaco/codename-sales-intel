-- Bloqueio de usuário no painel admin.
-- blockedAt = timestamp do bloqueio (null = usuário ativo).
-- Quando preenchido, o requireAuth rejeita toda request autenticada do
-- usuário (efeito imediato, invalida sessões existentes).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "blockedAt" TIMESTAMP(3);
