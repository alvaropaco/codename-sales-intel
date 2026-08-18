-- ============================================================================
-- Isolamento de dados por usuário (multi-tenant)
-- ----------------------------------------------------------------------------
-- Antes desta migração, todos os usuários apontavam para uma única Organization
-- (a primeira criada via `findFirst`), fazendo com que todos enxergassem os
-- mesmos dados: dashboard, leads, pipeline, configurações e outreach.
--
-- Esta migração dá a cada usuário uma Organization própria (contexto isolado).
-- Estratégia de backfill:
--   * Mantém os usuários que JÁ são donos únicos de uma Organization (ou seja,
--     já estão isolados) exatamente como estão.
--   * Para os usuários que compartilham a Organization "comum", cria uma nova
--     Organization exclusiva para cada um deles, de forma que ninguém enxergue
--     mais os dados dos outros.
--
-- Como os dados antigos (prospects, atividades, workflows, configurações e
-- outreach) estavam todos sob a Organization comum e não havia como atribuí-los
-- com segurança a um usuário específico, eles permanecem na Organization comum
-- (que continua pertencendo ao usuário mais antigo). Os demais usuários iniciam
-- com um contexto limpo, sem dados vazados.
--
-- Idempotente: pode ser executada mais de uma vez sem efeitos colaterais.
-- ============================================================================

DO $$
DECLARE
  u RECORD;
  shared_org RECORD;
  v_org_count BIGINT;
  v_new_org_id TEXT;
BEGIN
  -- 1) Encontra Organizations que possuem mais de um usuário (instâncias
  --    compartilhadas) e que, portanto, precisam ser separadas.
  FOR shared_org IN
    SELECT org."id" AS org_id
    FROM "Organization" org
    JOIN "User" usr ON usr."orgId" = org."id"
    GROUP BY org."id"
    HAVING COUNT(*) > 1
  LOOP
    -- Mantém o usuário mais antigo na Organization original e move os demais.
    FOR u IN
      SELECT usr."id" AS user_id, usr."email" AS email, usr."name" AS name
      FROM "User" usr
      WHERE usr."orgId" = shared_org.org_id
      ORDER BY usr."createdAt" ASC, usr."id" ASC
      OFFSET 1
    LOOP
      -- Cada usuário adicional recebe uma Organization própria.
      v_new_org_id := 'org_' || u.user_id;

      INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
      VALUES (
        v_new_org_id,
        COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1), 'Organização do usuário'),
        now(),
        now()
      )
      ON CONFLICT ("id") DO NOTHING;

      -- Reaponta o usuário para a própria Organization.
      UPDATE "User"
      SET "orgId" = v_new_org_id, "updatedAt" = now()
      WHERE "id" = u.user_id;
    END LOOP;
  END LOOP;

  -- 2) Garante que TODO usuário tenha uma Organization exclusiva, mesmo aqueles
  --    cuja Organization não apareceu acima (ex.: registro órfão / inconsistência).
  FOR u IN
    SELECT usr."id" AS user_id, usr."email" AS email, usr."name" AS name, usr."orgId" AS org_id
    FROM "User" usr
  LOOP
    SELECT COUNT(*) INTO v_org_count
    FROM "User" usr2
    WHERE usr2."orgId" = u.org_id;

    -- Se a Organization compartilhada ainda tiver mais de um usuário (ex.: caso
    -- de corrida ou dados pré-existentes), cria uma org própria para este usuário.
    IF v_org_count > 1 THEN
      v_new_org_id := 'org_' || u.user_id;
      INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
      VALUES (
        v_new_org_id,
        COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1), 'Organização do usuário'),
        now(),
        now()
      )
      ON CONFLICT ("id") DO NOTHING;

      UPDATE "User"
      SET "orgId" = v_new_org_id, "updatedAt" = now()
      WHERE "id" = u.user_id;
    END IF;
  END LOOP;
END $$;
