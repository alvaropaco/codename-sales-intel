"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-06

Creates the six tables defined in the implementation spec section 18.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- 18.1 source_snapshots ---------------------------------------
    op.create_table(
        "source_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_version", sa.String(20), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("manifest", postgresql.JSONB(), nullable=True),
        sa.Column("download_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("download_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_snapshot_version", sa.String(20), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_source_snapshots_status", "source_snapshots", ["status"])

    # --- 18.2 ingest_runs ---------------------------------------------
    op.create_table(
        "ingest_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("statistics", postgresql.JSONB(), nullable=True),
        sa.Column("configuration", postgresql.JSONB(), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"], ["source_snapshots.id"], ondelete="SET NULL"
        ),
    )
    op.create_index("ix_ingest_runs_snapshot_id", "ingest_runs", ["snapshot_id"])
    op.create_index("ix_ingest_runs_status", "ingest_runs", ["status"])

    # --- 18.3 event_outbox ---------------------------------------------
    op.create_table(
        "event_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("event_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("aggregate_id", sa.String(64), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("headers", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "available_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_event_outbox_status_available_at", "event_outbox", ["status", "available_at"]
    )
    op.create_index("ix_event_outbox_aggregate_id", "event_outbox", ["aggregate_id"])
    op.create_index("ix_event_outbox_event_type", "event_outbox", ["event_type"])
    op.create_index("ix_event_outbox_created_at", "event_outbox", ["created_at"])

    # --- 18.4 backfill_runs ---------------------------------------------
    op.create_table(
        "backfill_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_version", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("filters", postgresql.JSONB(), nullable=True),
        sa.Column("rate_limit", sa.Integer(), nullable=True),
        sa.Column("batch_size", sa.Integer(), nullable=True),
        sa.Column("cursor", postgresql.JSONB(), nullable=True),
        sa.Column("total_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("processed_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("published_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("failed_rows", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_backfill_runs_status", "backfill_runs", ["status"])
    op.create_index(
        "ix_backfill_runs_snapshot_version", "backfill_runs", ["snapshot_version"]
    )

    # --- 18.5 rejected_rows ---------------------------------------------
    op.create_table(
        "rejected_rows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("snapshot_version", sa.String(20), nullable=False),
        sa.Column("source_file", sa.Text(), nullable=False),
        sa.Column("line_number", sa.BigInteger(), nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_rejected_rows_snapshot_version", "rejected_rows", ["snapshot_version"]
    )

    # --- 18.6 system_locks ---------------------------------------------
    op.create_table(
        "system_locks",
        sa.Column("lock_name", sa.String(255), primary_key=True),
        sa.Column("owner_id", sa.String(255), nullable=True),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("system_locks")
    op.drop_index("ix_rejected_rows_snapshot_version", table_name="rejected_rows")
    op.drop_table("rejected_rows")
    op.drop_index("ix_backfill_runs_snapshot_version", table_name="backfill_runs")
    op.drop_index("ix_backfill_runs_status", table_name="backfill_runs")
    op.drop_table("backfill_runs")
    op.drop_index("ix_event_outbox_created_at", table_name="event_outbox")
    op.drop_index("ix_event_outbox_event_type", table_name="event_outbox")
    op.drop_index("ix_event_outbox_aggregate_id", table_name="event_outbox")
    op.drop_index("ix_event_outbox_status_available_at", table_name="event_outbox")
    op.drop_table("event_outbox")
    op.drop_index("ix_ingest_runs_status", table_name="ingest_runs")
    op.drop_index("ix_ingest_runs_snapshot_id", table_name="ingest_runs")
    op.drop_table("ingest_runs")
    op.drop_index("ix_source_snapshots_status", table_name="source_snapshots")
    op.drop_table("source_snapshots")
