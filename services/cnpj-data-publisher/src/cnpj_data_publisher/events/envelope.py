"""Event envelope (spec section 21)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.events.subjects import EventType, subject_for

SOURCE = "cnpj-data-publisher"


def new_event_id() -> uuid.UUID:
    return uuid.uuid4()


def utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class EventEnvelope(BaseModel):
    """Standard envelope wrapping every published payload."""

    model_config = ConfigDict(extra="forbid")

    event_id: str
    event_type: str
    event_version: int = 1
    subject: str
    source: str = SOURCE
    occurred_at: str
    correlation_id: str
    causation_id: str | None = None
    trace_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


def build_envelope(
    event_type: EventType | str,
    data: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    correlation_id: str | uuid.UUID | None = None,
    causation_id: str | uuid.UUID | None = None,
    trace_id: str | None = None,
    event_id: str | uuid.UUID | None = None,
    occurred_at: str | None = None,
) -> EventEnvelope:
    """Construct an envelope with the required fields populated."""
    resolved_type = EventType(event_type)
    settings = get_settings()

    base_metadata: dict[str, Any] = {
        "dataset": "RECEITA_FEDERAL_CNPJ",
        "schema_version": settings.schema_version,
    }
    base_metadata.update(metadata or {})

    return EventEnvelope(
        event_id=str(event_id or new_event_id()),
        event_type=resolved_type.value,
        event_version=1,
        subject=subject_for(resolved_type),
        source=SOURCE,
        occurred_at=occurred_at or utc_now_iso(),
        correlation_id=str(correlation_id or new_event_id()),
        causation_id=str(causation_id) if causation_id else None,
        trace_id=trace_id,
        data=data,
        metadata=base_metadata,
    )


def nats_headers(envelope: EventEnvelope) -> dict[str, str]:
    """Headers used for JetStream deduplication (spec section 19)."""
    headers = {
        "Nats-Msg-Id": envelope.event_id,
        "Ce-Type": envelope.event_type,
        "Ce-Source": envelope.source,
        "Ce-Id": envelope.event_id,
        "Ce-Time": envelope.occurred_at,
        "X-Correlation-Id": envelope.correlation_id,
    }
    if envelope.trace_id:
        headers["X-Trace-Id"] = envelope.trace_id
    return headers
