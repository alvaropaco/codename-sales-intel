"""initial schema: company_enrichment

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-13

"""
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "company_enrichment"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    op.execute(f"""
    CREATE TABLE {SCHEMA}.enrichment_jobs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id        UUID NOT NULL,
        tenant_id       UUID,
        company_id      UUID NOT NULL,
        cnpj            VARCHAR(20) NOT NULL,
        company_name    VARCHAR(512),
        trade_name      VARCHAR(512),
        address_city    VARCHAR(255),
        address_state   VARCHAR(10),
        status          VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
        attempt         INTEGER NOT NULL DEFAULT 0,
        worker_id       VARCHAR(255),
        started_at      TIMESTAMPTZ,
        heartbeat_at    TIMESTAMPTZ,
        lease_expires_at TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        error_code      VARCHAR(64),
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_enrichment_jobs_event_id UNIQUE (event_id)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_enrichment_jobs_status_created ON {SCHEMA}.enrichment_jobs (status, created_at)"
    )
    op.execute(
        f"CREATE INDEX ix_enrichment_jobs_lease ON {SCHEMA}.enrichment_jobs (lease_expires_at, status)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.company_enrichments (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id           UUID NOT NULL,
        tenant_id            UUID,
        cnpj                 VARCHAR(20) NOT NULL,
        enrichment_version   INTEGER NOT NULL DEFAULT 1,
        job_id               UUID REFERENCES {SCHEMA}.enrichment_jobs(id),
        result               JSONB NOT NULL DEFAULT '{{}}',
        summary              JSONB,
        firmographics        JSONB,
        domain               JSONB,
        business_profile     JSONB,
        digital_presence     JSONB,
        technologies         JSONB,
        contacts             JSONB,
        launch_velocity      JSONB,
        operational_readiness JSONB,
        commercial_potential JSONB,
        buying_intent        JSONB,
        ai_analysis          JSONB,
        evidence             JSONB,
        provider_statistics  JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_company_enrichments_company_version UNIQUE (company_id, enrichment_version)
    )
    """)
    op.execute(
        f"CREATE INDEX ix_company_enrichments_company_id ON {SCHEMA}.company_enrichments (company_id)"
    )

    op.execute(f"""
    CREATE TABLE {SCHEMA}.outbox_events (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject      VARCHAR(255) NOT NULL,
        payload      JSONB NOT NULL,
        headers      JSONB,
        job_id       UUID REFERENCES {SCHEMA}.enrichment_jobs(id),
        processed    BOOLEAN NOT NULL DEFAULT false,
        published_at TIMESTAMPTZ,
        attempts     INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute(
        f"CREATE INDEX ix_outbox_events_processed_created ON {SCHEMA}.outbox_events (processed, created_at)"
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.outbox_events")
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.company_enrichments")
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.enrichment_jobs")
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
