"""Entity graph ORM models for the multi-worker OSINT expansion.

Additive tables (dedicated schema `company_enrichment`):
  - enrichment_cases        (durable graph root per company request)
  - enrichment_worker_jobs  (per-directive job state + lease)
  - entities                (canonical entity per type + normalized key)
  - entity_relations        (directed, typed, evidence-cited edges)
  - enrichment_facts        (per-entity facts with confidence + provenance)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column

from company_enrichment.db.models import SCHEMA, Base


class CaseStatus(StrEnum):
    OPEN = "OPEN"
    PENDING_CHILD = "PENDING_CHILD"
    COMPLETING = "COMPLETING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class EntityKind(StrEnum):
    COMPANY = "COMPANY"
    PERSON = "PERSON"
    DOMAIN = "DOMAIN"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    URL = "URL"
    SOCIAL_PROFILE = "SOCIAL_PROFILE"
    ADDRESS = "ADDRESS"
    TECHNOLOGY = "TECHNOLOGY"


class EntityStatus(StrEnum):
    NEW = "NEW"
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    MERGED = "MERGED"


class EdgeKind(StrEnum):
    OWNER_OF = "OWNER_OF"
    DIRECTOR_OF = "DIRECTOR_OF"
    EMPLOYEE_OF = "EMPLOYEE_OF"
    HAS_DOMAIN = "HAS_DOMAIN"
    HAS_EMAIL = "HAS_EMAIL"
    EMAILS = "EMAILS"
    FOLLOWS = "FOLLOWS"
    USES_TECH = "USES_TECH"
    CO_HOSTED_WITH = "CO_HOSTED_WITH"
    SAME_OWNER = "SAME_OWNER"
    MENTIONS = "MENTIONS"


class WorkerDirectiveStatus(StrEnum):
    REQUESTED = "REQUESTED"
    RUNNING = "RUNNING"
    COLLECTED = "COLLECTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISCARDED = "DISCARDED"


class EnrichmentCase(Base):
    """Durable root of one company enrichment graph."""

    __tablename__ = "enrichment_cases"
    __table_args__ = (
        UniqueConstraint("request_event_id", name="uq_enrichment_cases_request_event"),
        Index("ix_enrichment_cases_status", "status", "updated_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    request_event_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    company_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    cnpj: Mapped[str] = mapped_column(String(20), nullable=False)

    max_depth: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    max_directives: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    max_facts: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    pending: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    directives_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    facts_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default=CaseStatus.OPEN)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EnrichmentWorkerJob(Base):
    """One durable worker directive (case + worker type + entity key)."""

    __tablename__ = "enrichment_worker_jobs"
    __table_args__ = (
        UniqueConstraint(
            "case_id", "worker_type", "entity_key",
            name="uq_worker_jobs_case_type_entity",
        ),
        Index("ix_worker_jobs_pending", "status", "lease_expires_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey(f"{SCHEMA}.enrichment_cases.id"), nullable=False
    )
    request_event_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    company_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    worker_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target: Mapped[str] = mapped_column(String(512), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=True)
    entity_key: Mapped[str] = mapped_column(String(512), nullable=False)
    target_company_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)

    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hints: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=WorkerDirectiveStatus.REQUESTED
    )
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


class Entity(Base):
    """Canonical entity. Unique per (kernel kind, normalized key)."""

    __tablename__ = "entities"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_key", name="uq_entities_type_key"),
        Index("ix_entities_kind_key", "entity_type", "entity_key"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(512), nullable=False)
    label: Mapped[str | None] = mapped_column(String(512), nullable=True)
    canonical: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey(f"{SCHEMA}.entities.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=EntityStatus.NEW)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EntityRelation(Base):
    """Directed, typed, evidence-cited edge between two entities."""

    __tablename__ = "entity_relations"
    __table_args__ = (
        UniqueConstraint(
            "source_entity_id", "target_entity_id", "relation_type",
            name="uq_entity_relations_src_dst_type",
        ),
        Index("ix_entity_relations_target", "target_entity_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_entity_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey(f"{SCHEMA}.entities.id"), nullable=False
    )
    target_entity_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey(f"{SCHEMA}.entities.id"), nullable=False
    )
    relation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.5)
    source: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EnrichmentFact(Base):
    """Per-entity fact. Unique per (entity_id, fact_key); last write wins."""

    __tablename__ = "enrichment_facts"
    __table_args__ = (
        UniqueConstraint("entity_id", "fact_key", name="uq_enrichment_facts_entity_key"),
        {"schema": SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey(f"{SCHEMA}.entities.id"), nullable=False
    )
    fact_key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.5)
    source: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
