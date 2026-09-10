"""NATS subject names (spec section 20.2)."""

from __future__ import annotations

from enum import StrEnum

from cnpj_data_publisher.config import get_settings


class EventType(StrEnum):
    COMPANY_DISCOVERED = "COMPANY_DISCOVERED"
    COMPANY_UPDATED = "COMPANY_UPDATED"
    COMPANY_REACTIVATED = "COMPANY_REACTIVATED"
    COMPANY_INACTIVATED = "COMPANY_INACTIVATED"
    CNPJ_SNAPSHOT_READY = "CNPJ_SNAPSHOT_READY"
    INGEST_COMPLETED = "INGEST_COMPLETED"
    INGEST_FAILED = "INGEST_FAILED"


#: Subject leaf for each event type, appended to NATS_SUBJECT_PREFIX.
SUBJECT_LEAVES: dict[EventType, str] = {
    EventType.COMPANY_DISCOVERED: "discovered.v1",
    EventType.COMPANY_UPDATED: "updated.v1",
    EventType.COMPANY_REACTIVATED: "reactivated.v1",
    EventType.COMPANY_INACTIVATED: "inactivated.v1",
    EventType.CNPJ_SNAPSHOT_READY: "snapshot.ready.v1",
    EventType.INGEST_COMPLETED: "ingest.completed.v1",
    EventType.INGEST_FAILED: "ingest.failed.v1",
}

#: Diff dataset name -> event type.
DIFF_EVENT_TYPES: dict[str, EventType] = {
    "discovered": EventType.COMPANY_DISCOVERED,
    "updated": EventType.COMPANY_UPDATED,
    "reactivated": EventType.COMPANY_REACTIVATED,
    "inactivated": EventType.COMPANY_INACTIVATED,
}


def subject_for(event_type: EventType | str) -> str:
    """Fully qualified subject for an event type."""
    key = EventType(event_type)
    return get_settings().subject(SUBJECT_LEAVES[key])


def stream_subject_filter() -> str:
    """Wildcard covering every subject this service publishes."""
    return f"{get_settings().nats_subject_prefix}.>"


def all_subjects() -> list[str]:
    return [subject_for(event_type) for event_type in EventType]
