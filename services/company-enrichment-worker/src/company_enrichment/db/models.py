"""SQLAlchemy ORM models for the enrichment service.

Tables (dedicated schema `company_enrichment`):
  - enrichment_jobs      (durable job state + lease)
  - company_enrichments  (immutable, versioned enrichment history)
  - outbox_events        (transactional outbox)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _uuid_col() -> Mapped[uuid.UUID]:
    return mapped_column(PgUUID(as_uuid=True))


class JobStatus(StrEnum):
    REQUESTED = "REQUESTED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISCARDED = "DISCARDED"
    PARTIAL = "PARTIAL"
    DLQ = "DLQ"


SCHEMA = "company_enrichment"


class EnrichmentJob(Base):
    __tablename__ = "enrichment_jobs"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_enrichment_jobs_event_id"),
        Index("ix_enrichment_jobs_status_created", "status", "created_at"),
        Index("ix_enrichment_jobs_lease", "lease_expires_at", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    company_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    cnpj: Mapped[str] = mapped_column(String(20), nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    trade_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    address_city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_state: Mapped[str | None] = mapped_column(String(10), nullable=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default=JobStatus.REQUESTED)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    worker_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<EnrichmentJob id={self.id} cnpj={self.cnpj} status={self.status}>"


class CompanyEnrichment(Base):
    """Immutable, versioned enrichment history. Never overwritten."""

    __tablename__ = "company_enrichments"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "enrichment_version", name="uq_company_enrichments_company_version"
        ),
        Index("ix_company_enrichments_company_id", "company_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    cnpj: Mapped[str] = mapped_column(String(20), nullable=False)
    enrichment_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("company_enrichment.enrichment_jobs.id"), nullable=True
    )

    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Per-field results kept denormalized for convenient querying.
    firmographics: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    domain: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    business_profile: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    digital_presence: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    technologies: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    contacts: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    launch_velocity: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    operational_readiness: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    commercial_potential: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    buying_intent: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ai_analysis: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    evidence: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    provider_statistics: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CompanyEnrichment company_id={self.company_id} v{self.enrichment_version}>"


class OutboxEvent(Base):
    """Transactional outbox. Events published to NATS only after commit."""

    __tablename__ = "outbox_events"
    __table_args__ = (
        Index("ix_outbox_events_processed_created", "processed", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    headers: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("company_enrichment.enrichment_jobs.id"), nullable=True
    )
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<OutboxEvent id={self.id} subject={self.subject} processed={self.processed}>"
