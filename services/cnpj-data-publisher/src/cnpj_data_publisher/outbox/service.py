"""Outbox writing (spec section 19).

Events are always persisted inside the ingest transaction. Nothing is ever
published to NATS directly while the diff is being computed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import insert
from sqlalchemy.orm import Session

from cnpj_data_publisher import metrics
from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.database.models import EventOutbox, OutboxStatus
from cnpj_data_publisher.events import company_events as builders
from cnpj_data_publisher.events.envelope import EventEnvelope, nats_headers
from cnpj_data_publisher.events.subjects import DIFF_EVENT_TYPES
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.processing.diff import DIFF_DATASETS, DiffResult, iter_diff_rows

logger = get_logger(__name__)

INSERT_CHUNK = 2_000


def envelope_to_row(envelope: EventEnvelope, aggregate_id: str) -> dict[str, Any]:
    """Map an envelope onto an ``event_outbox`` row."""
    now = datetime.now(UTC)
    return {
        "id": uuid.uuid4(),
        "event_id": uuid.UUID(envelope.event_id),
        "subject": envelope.subject,
        "event_type": envelope.event_type,
        "event_version": envelope.event_version,
        "aggregate_id": aggregate_id,
        "payload": envelope.to_dict(),
        "headers": nats_headers(envelope),
        "status": OutboxStatus.PENDING.value,
        "attempts": 0,
        "available_at": now,
        "created_at": now,
        "updated_at": now,
    }


def _build_event(
    dataset: str,
    record: dict[str, Any],
    snapshot_version: str,
    correlation_id: str,
) -> EventEnvelope:
    """Dispatch to the builder for one diff dataset."""
    if dataset == "discovered":
        return builders.build_discovered(record, snapshot_version, correlation_id)
    if dataset == "updated":
        changes = builders.diff_changes(record)
        return builders.build_updated(record, snapshot_version, changes, correlation_id)
    if dataset == "reactivated":
        return builders.build_reactivated(record, snapshot_version, correlation_id)
    if dataset == "inactivated":
        return builders.build_inactivated(record, snapshot_version, correlation_id)
    raise ValueError(f"unknown diff dataset {dataset!r}")


class OutboxService:
    """Turns diff output into durable outbox rows."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    # -- low level -------------------------------------------------------
    def enqueue(self, envelope: EventEnvelope, aggregate_id: str) -> None:
        row = envelope_to_row(envelope, aggregate_id)
        self.session.add(EventOutbox(**row))

    def enqueue_many(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        for start in range(0, len(rows), INSERT_CHUNK):
            chunk = rows[start : start + INSERT_CHUNK]
            self.session.execute(insert(EventOutbox), chunk)
        return len(rows)

    # -- diff ingestion ---------------------------------------------------
    def enqueue_diff(
        self,
        diff: DiffResult,
        correlation_id: str | uuid.UUID | None = None,
        publish_discovered: bool = True,
    ) -> dict[str, int]:
        """Persist one event per diff row.

        ``publish_discovered=False`` implements ``INITIAL_SNAPSHOT_MODE=STORE_ONLY``
        for the very first snapshot: the Parquet diff still exists, but no
        millions of events are emitted (spec section 16).
        """
        correlation = str(correlation_id or uuid.uuid4())
        counts: dict[str, int] = {}

        for dataset in DIFF_DATASETS:
            if dataset == "discovered" and not publish_discovered:
                logger.info("discovered_events_suppressed", reason="STORE_ONLY")
                counts[dataset] = 0
                continue

            event_type = DIFF_EVENT_TYPES[dataset]
            rows: list[dict[str, Any]] = []
            written = 0

            for record in iter_diff_rows(diff.output_dir, dataset):
                envelope = _build_event(dataset, record, diff.snapshot_version, correlation)
                rows.append(envelope_to_row(envelope, str(record.get("cnpj") or "")))

                if len(rows) >= INSERT_CHUNK:
                    written += self.enqueue_many(rows)
                    rows = []

            written += self.enqueue_many(rows)
            counts[dataset] = written
            if written:
                metrics.diff_companies_total.labels(event_type=event_type.value).inc(written)

        logger.info(
            "outbox_events_created",
            snapshot_version=diff.snapshot_version,
            **counts,
        )
        return counts

    # -- lifecycle events --------------------------------------------------
    def enqueue_snapshot_ready(
        self,
        snapshot_version: str,
        manifest: dict[str, Any],
        storage: dict[str, Any],
        checksum: str | None = None,
        correlation_id: str | uuid.UUID | None = None,
    ) -> None:
        envelope = builders.build_snapshot_ready(
            snapshot_version, manifest, storage, checksum, str(correlation_id or uuid.uuid4())
        )
        self.enqueue(envelope, snapshot_version)

    def enqueue_ingest_completed(
        self,
        snapshot_version: str,
        statistics: dict[str, Any],
        correlation_id: str | uuid.UUID | None = None,
    ) -> None:
        envelope = builders.build_ingest_completed(
            snapshot_version, statistics, str(correlation_id or uuid.uuid4())
        )
        self.enqueue(envelope, snapshot_version)

    def enqueue_ingest_failed(
        self,
        snapshot_version: str,
        stage: str,
        error_code: str,
        error_message: str,
        correlation_id: str | uuid.UUID | None = None,
    ) -> None:
        envelope = builders.build_ingest_failed(
            snapshot_version,
            stage,
            error_code,
            error_message,
            str(correlation_id or uuid.uuid4()),
        )
        self.enqueue(envelope, snapshot_version)
