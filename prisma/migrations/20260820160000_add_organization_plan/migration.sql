-- Planos de assinatura (trial | premium)
-- Toda nova conta começa em "trial". O plano é por Organization (que é o
-- contexto de cada conta isolada). Limites do trial:
--   * máximo de 10 leads captados
--   * sem exportação de dados
-- Premium remove esses limites.

ALTER TABLE "Organization"
ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'trial';
