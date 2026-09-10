"""NATS event contracts for the enrichment pipeline.

Event subjects (JetStream):
  - enrichment.company.requested.v1   (in)
  - enrichment.company.completed.v1   (out)
  - enrichment.company.failed.v1      (out)
  - enrichment.company.discarded.v1   (out)
  - enrichment.company.partial.v1     (out)
  - enrichment.company.dlq.v1         (DLQ)
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(UTC)


class EnrichmentRequestStatus(StrEnum):
    REQUESTED = "REQUESTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISCARDED = "DISCARDED"
    PARTIAL = "PARTIAL"


class EnrichmentRequestedV1(BaseModel):
    """Payload of enrichment.company.requested.v1."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    cnpj: str
    company_name: str | None = None
    trade_name: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    published_at: datetime = Field(default_factory=utcnow)


class CompanyResultEventV1(BaseModel):
    """Payload of enrichment.company.completed.v1 / partial / failed / discarded."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    request_event_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    company_id: uuid.UUID
    cnpj: str
    status: EnrichmentRequestStatus
    enrichment_version: int | None = None
    summary: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    published_at: datetime = Field(default_factory=utcnow)


class DLQEventV1(BaseModel):
    """Payload written to enrichment.company.dlq.v1 for poison messages."""

    version: str = Field(default="1")
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    original_event_id: uuid.UUID | None = None
    subject: str
    payload: dict[str, Any]
    consumer_seq: int | None = None
    error_code: str
    error_message: str
    published_at: datetime = Field(default_factory=utcnow)
