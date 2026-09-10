"""Event contracts for the multi-worker OSINT enrichment graph.

New subjects (stream `ENRICHMENT`, widened to `enrichment.>`):
  - enrichment.worker.<type>.requested.v1  (directive -> worker <type>)
  - enrichment.worker.<type>.completed.v1  (outcome -> orchestrator)
  - enrichment.entity.discovered.v1        (new entity -> orchestrator)
  - enrichment.fact.updated.v1             (fact written -> relationships/validator)
  - enrichment.ingest.collected.v1         (collected data -> persister worker)

Existing company.* subjects are unchanged.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from company_enrichment.events.contracts import utcnow


class GraphEntityRef(BaseModel):
    """Reference to an entity in the graph."""

    entity_type: str
    entity_key: str
    label: str | None = None
    target_company_id: uuid.UUID | None = None


class GraphBudget(BaseModel):
    """Per-directive budget ceiling."""

    max_facts: int = Field(default=200, ge=1)
    max_seconds: int = Field(default=600, ge=1)
    max_events: int = Field(default=5000, ge=1)


class WorkerDirectiveRequestedV1(BaseModel):
    """Payload of enrichment.worker.<type>.requested.v1."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    case_id: uuid.UUID
    request_event_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    worker_type: str
    entity: GraphEntityRef
    target: str
    hints: dict[str, Any] = Field(default_factory=dict)
    depth: int = Field(default=0, ge=0)
    budget: GraphBudget = Field(default_factory=GraphBudget)
    published_at: datetime = Field(default_factory=utcnow)


class WorkerResultEventV1(BaseModel):
    """Payload of enrichment.worker.<type>.completed.v1 (success or failure)."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    directive_event_id: uuid.UUID
    case_id: uuid.UUID
    request_event_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    worker_type: str
    status: str  # COMPLETED | FAILED | DISCARDED
    facts_written: int = 0
    entities_discovered: int = 0
    error_code: str | None = None
    error_message: str | None = None
    summary: dict[str, Any] | None = None
    published_at: datetime = Field(default_factory=utcnow)


class EntityDiscoveredV1(BaseModel):
    """Payload of enrichment.entity.discovered.v1 (may unlock follow-on work)."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    case_id: uuid.UUID
    request_event_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    operator_id: uuid.UUID | None = None
    entity: GraphEntityRef
    meta: dict[str, Any] | None = None
    depth: int = Field(default=1, ge=0)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None
    published_at: datetime = Field(default_factory=utcnow)


class FactUpdatedV1(BaseModel):
    """Payload of enrichment.fact.updated.v1 (post-dedup merge signal)."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    case_id: uuid.UUID
    request_event_id: uuid.UUID
    entity: GraphEntityRef
    fact_key: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None
    published_at: datetime = Field(default_factory=utcnow)


class IngestFact(BaseModel):
    """A single fact collected by a worker, to be persisted by the persister."""

    entity_type: str
    entity_key: str
    fact_key: str
    value: dict[str, Any] | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None


class IngestEntity(BaseModel):
    """A durable entity collected by a worker (plus optional operator relation)."""

    entity_type: str
    entity_key: str
    label: str | None = None
    relation_type: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    meta: dict[str, Any] | None = None
    emit_discovery: bool = True


class IngestRelation(BaseModel):
    """A directed, typed relation between two entity keys."""

    source: str
    target: str
    relation_type: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class IngestCollectedV1(BaseModel):
    """Payload of enrichment.ingest.collected.v1.

    This is the durable "collected data" queue item. A collection worker publishes
    one of these per successful directive; the dedicated `persister` worker consumes
    it and writes entities/facts/relations to PostgreSQL (idempotently).
    """

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    directive_event_id: uuid.UUID
    case_id: uuid.UUID
    request_event_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    worker_type: str
    entity: GraphEntityRef
    target: str
    depth: int = Field(default=0, ge=0)
    status: str = "COMPLETED"
    facts: list[IngestFact] = Field(default_factory=list)
    entities: list[IngestEntity] = Field(default_factory=list)
    relations: list[IngestRelation] = Field(default_factory=list)
    summary: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    published_at: datetime = Field(default_factory=utcnow)


def worker_directive_subject(worker_type: str) -> str:
    """Request subject for a worker type, e.g. enrichment.worker.bbot.requested.v1."""
    return f"enrichment.worker.{worker_type}.requested.v1"


def worker_result_subject(worker_type: str) -> str:
    """Result subject for a worker type, e.g. enrichment.worker.bbot.completed.v1."""
    return f"enrichment.worker.{worker_type}.completed.v1"


def ingest_collected_subject() -> str:
    """Queue subject for collected data consumed by the persister worker."""
    return "enrichment.ingest.collected.v1"
