"""JSON Schema loading and validation against contracts/."""

from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from cnpj_data_publisher.events.subjects import EventType

#: Candidate locations for contracts/, covering source and container layouts.
_CANDIDATES = (
    Path(__file__).resolve().parents[4] / "contracts",  # <repo>/src/pkg/events/schemas -> <repo>
    Path("/app/contracts"),  # container WORKDIR
    Path.cwd() / "contracts",
    Path(__file__).resolve().parent / "json",  # packaged alongside the module
)

SCHEMA_FILES: dict[EventType, str] = {
    EventType.COMPANY_DISCOVERED: "company-discovered-v1.schema.json",
    EventType.COMPANY_UPDATED: "company-updated-v1.schema.json",
    EventType.COMPANY_REACTIVATED: "company-reactivated-v1.schema.json",
    EventType.COMPANY_INACTIVATED: "company-inactivated-v1.schema.json",
    EventType.CNPJ_SNAPSHOT_READY: "snapshot-ready-v1.schema.json",
    EventType.INGEST_COMPLETED: "ingest-completed-v1.schema.json",
    EventType.INGEST_FAILED: "ingest-failed-v1.schema.json",
}


class SchemaNotFoundError(FileNotFoundError):
    pass


def contracts_dir() -> Path:
    for candidate in _CANDIDATES:
        if candidate.is_dir():
            return candidate
    raise SchemaNotFoundError(
        "contracts directory not found; looked in " + ", ".join(str(c) for c in _CANDIDATES)
    )


@functools.cache
def load_schema(event_type: EventType | str) -> dict[str, Any]:
    key = EventType(event_type)
    path = contracts_dir() / SCHEMA_FILES[key]
    if not path.exists():
        raise SchemaNotFoundError(f"schema not found: {path}")
    schema: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return schema


@functools.cache
def get_validator(event_type: EventType | str) -> Draft202012Validator:
    return Draft202012Validator(load_schema(event_type))


def validate_event(payload: dict[str, Any]) -> list[str]:
    """Return a list of human-readable validation errors (empty when valid)."""
    event_type = payload.get("event_type")
    if not event_type:
        return ["event_type is missing"]
    try:
        validator = get_validator(event_type)
    except (ValueError, SchemaNotFoundError) as exc:
        return [str(exc)]

    return [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
    ]


def assert_valid(payload: dict[str, Any]) -> None:
    errors = validate_event(payload)
    if errors:
        raise ValueError(f"event does not match its schema: {'; '.join(errors[:5])}")
