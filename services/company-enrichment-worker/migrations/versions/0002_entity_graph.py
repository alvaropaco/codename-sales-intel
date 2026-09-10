"""multi-worker OSINT entity graph

Revision ID: 0002_entity_graph
Revises: 0001_initial
Create Date: 2026-08-16

Additive tables in schema `company_enrichment`:
  - enrichment_cases
  - enrichment_worker_jobs
  - entities
  - entity_relations
  - enrichment_facts
Backward-compatible; no destructive changes to the existing tables.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_entity_graph"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

SCHEMA = "company_enrichment"


def upgrade() -> None:
    op.execute(f"""
    CREATE TABLE {SCHEMA}.enrichment_cases (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_event_id   UUID NOT NULL,
        tenant_id          UUID,
        company_id         UUID NOT NULL,
        cnpj               VARCHAR(20) NOT NULL,
        max_depth          INTEGER NOT NULL DEFAULT 2,
        max_directives     INTEGER NOT NULL DEFAULT 50,
        max_facts          INTEGER NOT NULL DEFAULT 200,
        pending            INTEGER NOT NULL DEFAULT 0,
        directives_total   INTEGER NOT NULL DEFAULT 0,
        facts_total        INTEGER NOT NULL DEFAULT 0,
        status             VARCHAR(32) NOT NULL DEFAULT 'OPEN',
        completed_at       TIMESTAMPTZ,
        error_code         VARCHAR(64),
        error_message      TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_enrichment_cases_request_event UNIQUE (request_event_id)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_enrichment_cases_status ON {SCHEMA}.enrichment_cases (status, updated_at)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.enrichment_worker_jobs (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id           UUID NOT NULL REFERENCES {SCHEMA}.enrichment_cases(id),
        request_event_id  UUID NOT NULL,
        tenant_id         UUID,
        company_id        UUID NOT NULL,
        worker_type       VARCHAR(32) NOT NULL,
        target            VARCHAR(512) NOT NULL,
        entity_type       VARCHAR(32),
        entity_key        VARCHAR(512) NOT NULL,
        target_company_id UUID,
        depth             INTEGER NOT NULL DEFAULT 0,
        hints             JSONB,
        status            VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
        attempt           INTEGER NOT NULL DEFAULT 0,
        worker_id         VARCHAR(255),
        started_at        TIMESTAMPTZ,
        heartbeat_at      TIMESTAMPTZ,
        lease_expires_at  TIMESTAMPTZ,
        completed_at      TIMESTAMPTZ,
        error_code        VARCHAR(64),
        error_message     TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_worker_jobs_case_type_entity UNIQUE (case_id, worker_type, entity_key)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_worker_jobs_pending ON {SCHEMA}.enrichment_worker_jobs (status, lease_expires_at)"
    )
    op.execute(
        f"CREATE INDEX ix_worker_jobs_case ON {SCHEMA}.enrichment_worker_jobs (case_id)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.entities (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type       VARCHAR(32) NOT NULL,
        entity_key        VARCHAR(512) NOT NULL,
        label             VARCHAR(512),
        canonical         UUID REFERENCES {SCHEMA}.entities(id),
        status            VARCHAR(32) NOT NULL DEFAULT 'NEW',
        meta              JSONB,
        first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_entities_type_key UNIQUE (entity_type, entity_key)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_entities_kind_key ON {SCHEMA}.entities (entity_type, entity_key)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.entity_relations (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_entity_id   UUID NOT NULL REFERENCES {SCHEMA}.entities(id),
        target_entity_id   UUID NOT NULL REFERENCES {SCHEMA}.entities(id),
        relation_type      VARCHAR(32) NOT NULL,
        confidence         DOUBLE PRECISION NOT NULL DEFAULT 0.5,
        source             JSONB,
        observed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_entity_relations_src_dst_type UNIQUE (source_entity_id, target_entity_id, relation_type)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_entity_relations_target ON {SCHEMA}.entity_relations (target_entity_id)"
    )
    op.execute(
        f"CREATE INDEX ix_entity_relations_observed ON {SCHEMA}.entity_relations (observed_at)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.enrichment_facts (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id   UUID NOT NULL REFERENCES {SCHEMA}.entities(id),
        fact_key    VARCHAR(128) NOT NULL,
        value       JSONB,
        confidence  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
        source      JSONB,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_enrichment_facts_entity_key UNIQUE (entity_id, fact_key)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_enrichment_facts_entity ON {SCHEMA}.enrichment_facts (entity_id)"
    )


def downgrade() -> None:
    for table in (
        "enrichment_facts",
        "entity_relations",
        "entities",
        "enrichment_worker_jobs",
        "enrichment_cases",
    ):
        op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.{table} CASCADE")
