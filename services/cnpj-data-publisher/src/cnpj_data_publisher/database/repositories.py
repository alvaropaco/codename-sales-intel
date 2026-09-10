"""Repositories for the six spec tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import func, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from cnpj_data_publisher.database.models import (
    BackfillRun,
    BackfillStatus,
    EventOutbox,
    IngestRun,
    IngestRunStatus,
    OutboxStatus,
    RejectedRow,
    SnapshotStatus,
    SourceSnapshot,
)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------
class SnapshotRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, snapshot_version: str) -> SourceSnapshot | None:
        return self.session.execute(
            select(SourceSnapshot).where(SourceSnapshot.snapshot_version == snapshot_version)
        ).scalar_one_or_none()

    def create(
        self,
        snapshot_version: str,
        source_url: str,
        schema_version: int = 1,
        previous_snapshot_version: str | None = None,
    ) -> SourceSnapshot:
        snapshot = SourceSnapshot(
            snapshot_version=snapshot_version,
            source_url=source_url,
            schema_version=schema_version,
            previous_snapshot_version=previous_snapshot_version,
            status=SnapshotStatus.DISCOVERED,
        )
        self.session.add(snapshot)
        self.session.flush()
        return snapshot

    def get_or_create(
        self,
        snapshot_version: str,
        source_url: str,
        schema_version: int = 1,
        previous_snapshot_version: str | None = None,
    ) -> SourceSnapshot:
        existing = self.get(snapshot_version)
        if existing is not None:
            return existing
        return self.create(snapshot_version, source_url, schema_version, previous_snapshot_version)

    def set_status(
        self,
        snapshot_version: str,
        status: SnapshotStatus,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        values: dict[str, Any] = {"status": status, "updated_at": _now()}
        if error_code is not None:
            values["error_code"] = error_code
        if error_message is not None:
            values["error_message"] = error_message
        if status == SnapshotStatus.DOWNLOADING:
            values["download_started_at"] = _now()
        elif status == SnapshotStatus.DOWNLOADED:
            values["download_completed_at"] = _now()
        elif status == SnapshotStatus.EXTRACTING:
            values["processing_started_at"] = _now()
        elif status in (SnapshotStatus.COMPLETED, SnapshotStatus.FAILED):
            values["processing_completed_at"] = _now()
        self.session.execute(
            update(SourceSnapshot)
            .where(SourceSnapshot.snapshot_version == snapshot_version)
            .values(**values)
        )

    def set_manifest(self, snapshot_version: str, manifest: dict[str, Any]) -> None:
        self.session.execute(
            update(SourceSnapshot)
            .where(SourceSnapshot.snapshot_version == snapshot_version)
            .values(manifest=manifest, updated_at=_now())
        )

    def latest_completed(self, before_version: str | None = None) -> SourceSnapshot | None:
        stmt = select(SourceSnapshot).where(SourceSnapshot.status == SnapshotStatus.COMPLETED)
        if before_version:
            stmt = stmt.where(SourceSnapshot.snapshot_version < before_version)
        stmt = stmt.order_by(SourceSnapshot.snapshot_version.desc()).limit(1)
        return self.session.execute(stmt).scalar_one_or_none()

    def is_completed(self, snapshot_version: str) -> bool:
        snap = self.get(snapshot_version)
        return snap is not None and snap.status == SnapshotStatus.COMPLETED

    def count_completed(self) -> int:
        return int(
            self.session.execute(
                select(func.count(SourceSnapshot.id)).where(
                    SourceSnapshot.status == SnapshotStatus.COMPLETED
                )
            ).scalar_one()
        )

    def older_than(self, months: int) -> list[SourceSnapshot]:
        cutoff = _now() - timedelta(days=30 * months)
        return list(
            self.session.execute(
                select(SourceSnapshot).where(SourceSnapshot.created_at < cutoff)
            ).scalars()
        )


# ---------------------------------------------------------------------
class IngestRunRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def start(self, snapshot_id: uuid.UUID | None, configuration: dict[str, Any]) -> IngestRun:
        run = IngestRun(
            snapshot_id=snapshot_id,
            status=IngestRunStatus.RUNNING,
            configuration=configuration,
        )
        self.session.add(run)
        self.session.flush()
        return run

    def finish(
        self,
        run_id: uuid.UUID,
        status: IngestRunStatus,
        statistics: dict[str, Any] | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        self.session.execute(
            update(IngestRun)
            .where(IngestRun.id == run_id)
            .values(
                status=status,
                completed_at=_now(),
                statistics=statistics,
                error_code=error_code,
                error_message=error_message,
            )
        )


# ---------------------------------------------------------------------
class OutboxRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_many(self, events: list[EventOutbox]) -> None:
        self.session.add_all(events)
        self.session.flush()

    def bulk_insert(self, rows: list[dict[str, Any]]) -> None:
        """Fast path for very large diffs."""
        if rows:
            self.session.bulk_insert_mappings(EventOutbox, rows)

    def claim_batch(self, batch_size: int) -> list[EventOutbox]:
        """Claim pending events using FOR UPDATE SKIP LOCKED (spec section 19)."""
        stmt = (
            select(EventOutbox)
            .where(
                EventOutbox.status.in_([OutboxStatus.PENDING, OutboxStatus.FAILED]),
                EventOutbox.available_at <= _now(),
            )
            .order_by(EventOutbox.created_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        events = list(self.session.execute(stmt).scalars())
        if events:
            self.session.execute(
                update(EventOutbox)
                .where(EventOutbox.id.in_([e.id for e in events]))
                .values(status=OutboxStatus.PUBLISHING, updated_at=_now())
            )
        return events

    def mark_published(self, event_ids: list[uuid.UUID]) -> None:
        if not event_ids:
            return
        self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id.in_(event_ids))
            .values(status=OutboxStatus.PUBLISHED, published_at=_now(), updated_at=_now())
        )

    def mark_failed(
        self, event_id: uuid.UUID, error: str, retry_delay_seconds: int, max_attempts: int
    ) -> None:
        row = self.session.get(EventOutbox, event_id)
        if row is None:
            return
        attempts = row.attempts + 1
        exhausted = attempts >= max_attempts
        row.attempts = attempts
        row.last_error = error[:4000]
        row.status = OutboxStatus.FAILED
        row.available_at = _now() + timedelta(seconds=retry_delay_seconds)
        row.updated_at = _now()
        if exhausted:
            # Keep FAILED but push far into the future so it stops cycling.
            row.available_at = _now() + timedelta(days=3650)

    def count_pending(self) -> int:
        return int(
            self.session.execute(
                select(func.count(EventOutbox.id)).where(
                    EventOutbox.status.in_([OutboxStatus.PENDING, OutboxStatus.FAILED])
                )
            ).scalar_one()
        )

    def delete_published_older_than(self, days: int) -> int:
        cutoff = _now() - timedelta(days=days)
        result = cast(
            "CursorResult[Any]",
            self.session.execute(
                text(
                    "DELETE FROM event_outbox WHERE status = 'PUBLISHED' AND published_at < :cutoff"
                ),
                {"cutoff": cutoff},
            ),
        )
        return int(result.rowcount or 0)


# ---------------------------------------------------------------------
class BackfillRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        snapshot_version: str,
        filters: dict[str, Any],
        rate_limit: int,
        batch_size: int,
        total_rows: int = 0,
    ) -> BackfillRun:
        run = BackfillRun(
            snapshot_version=snapshot_version,
            filters=filters,
            rate_limit=rate_limit,
            batch_size=batch_size,
            total_rows=total_rows,
            status=BackfillStatus.PENDING,
        )
        self.session.add(run)
        self.session.flush()
        return run

    def get(self, run_id: uuid.UUID) -> BackfillRun | None:
        return self.session.get(BackfillRun, run_id)

    def find_resumable(self, snapshot_version: str) -> BackfillRun | None:
        return self.session.execute(
            select(BackfillRun)
            .where(
                BackfillRun.snapshot_version == snapshot_version,
                BackfillRun.status.in_(
                    [BackfillStatus.PENDING, BackfillStatus.RUNNING, BackfillStatus.PAUSED]
                ),
            )
            .order_by(BackfillRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

    def mark_running(self, run_id: uuid.UUID) -> None:
        self.session.execute(
            update(BackfillRun)
            .where(BackfillRun.id == run_id)
            .values(status=BackfillStatus.RUNNING, started_at=_now(), updated_at=_now())
        )

    def save_cursor(
        self,
        run_id: uuid.UUID,
        cursor: dict[str, Any],
        processed_rows: int,
        published_rows: int,
        failed_rows: int = 0,
    ) -> None:
        self.session.execute(
            update(BackfillRun)
            .where(BackfillRun.id == run_id)
            .values(
                cursor=cursor,
                processed_rows=processed_rows,
                published_rows=published_rows,
                failed_rows=failed_rows,
                updated_at=_now(),
            )
        )

    def finish(
        self, run_id: uuid.UUID, status: BackfillStatus, error_message: str | None = None
    ) -> None:
        self.session.execute(
            update(BackfillRun)
            .where(BackfillRun.id == run_id)
            .values(
                status=status,
                completed_at=_now(),
                error_message=error_message,
                updated_at=_now(),
            )
        )


# ---------------------------------------------------------------------
class RejectedRowRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(
        self,
        snapshot_version: str,
        source_file: str,
        line_number: int | None,
        raw_data: str | None,
        error_code: str,
        error_message: str,
    ) -> None:
        self.session.add(
            RejectedRow(
                snapshot_version=snapshot_version,
                source_file=source_file,
                line_number=line_number,
                raw_data=(raw_data or "")[:8000] or None,
                error_code=error_code,
                error_message=error_message[:4000],
            )
        )

    def count(self, snapshot_version: str) -> int:
        return int(
            self.session.execute(
                select(func.count(RejectedRow.id)).where(
                    RejectedRow.snapshot_version == snapshot_version
                )
            ).scalar_one()
        )

    def delete_older_than(self, months: int) -> int:
        cutoff = _now() - timedelta(days=30 * months)
        deleted = cast(
            "CursorResult[Any]",
            self.session.execute(
                text("DELETE FROM rejected_rows WHERE created_at < :cutoff"), {"cutoff": cutoff}
            ),
        )
        return int(deleted.rowcount or 0)
