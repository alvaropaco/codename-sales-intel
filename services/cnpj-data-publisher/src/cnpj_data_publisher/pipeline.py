"""Ingestion pipeline orchestrator (spec section 5.1).

Drives the documented stage machine:

    DISCOVERED -> DOWNLOADING -> DOWNLOADED -> EXTRACTING -> NORMALIZING
               -> VALIDATING -> DIFFING -> CREATING_EVENTS -> COMPLETED
"""

from __future__ import annotations

import sys
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any

from cnpj_data_publisher import metrics
from cnpj_data_publisher.config import InitialSnapshotMode, Sink, get_settings
from cnpj_data_publisher.database.models import (
    IngestRunStatus,
    SnapshotStatus,
)
from cnpj_data_publisher.database.repositories import (
    IngestRunRepository,
    SnapshotRepository,
)
from cnpj_data_publisher.database.session import (
    advisory_lock,
    get_session_factory,
    session_scope,
)
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.notifications import NotificationService
from cnpj_data_publisher.outbox.service import OutboxService
from cnpj_data_publisher.processing.canonical_snapshot import (
    CanonicalSnapshotBuilder,
    read_snapshot_manifest,
)
from cnpj_data_publisher.processing.diff import DiffEngine
from cnpj_data_publisher.processing.validation import SnapshotValidator
from cnpj_data_publisher.receita.discovery import SnapshotDiscovery, SnapshotInfo
from cnpj_data_publisher.receita.downloader import Downloader
from cnpj_data_publisher.receita.extractor import Extractor
from cnpj_data_publisher.storage import get_storage

logger = get_logger(__name__)


class IngestSkipped(Exception):
    """Raised when there is nothing to do. Not an error (spec section 28)."""


class IngestLocked(Exception):
    """Another ingestion already holds the advisory lock."""


class IngestFailed(Exception):
    def __init__(self, stage: str, message: str, code: str = "INGEST_ERROR") -> None:
        super().__init__(message)
        self.stage = stage
        self.code = code


@dataclass(slots=True)
class IngestResult:
    snapshot_version: str
    status: str
    statistics: dict[str, Any] = field(default_factory=dict)
    events_created: int = 0
    skipped_reason: str | None = None


class IngestPipeline:
    """Runs one full ingestion."""

    def __init__(self, requested_snapshot: str = "latest", force: bool = False) -> None:
        self.settings = get_settings()
        self.requested = requested_snapshot
        self.force = force
        self.correlation_id = str(uuid.uuid4())
        self.stats: dict[str, Any] = {}
        self.discovered_version: str | None = None

    # -- helpers ----------------------------------------------------------
    def _stage(self, name: str) -> Any:
        return metrics.snapshot_run_duration_seconds.labels(stage=name).time()

    def _set_status(self, version: str, status: SnapshotStatus, **kwargs: Any) -> None:
        with session_scope() as session:
            SnapshotRepository(session).set_status(version, status, **kwargs)

    # -- main --------------------------------------------------------------
    def run(self) -> IngestResult:
        started = time.perf_counter()

        # The lock must be held for the entire run, so it uses its own
        # long-lived session distinct from the per-stage transactions.
        lock_session = get_session_factory()()
        try:
            with advisory_lock(lock_session) as acquired:
                if not acquired:
                    raise IngestLocked("another ingestion is already running")

                try:
                    result = self._run_locked()
                except IngestSkipped as exc:
                    metrics.snapshot_runs_total.labels(status="SKIPPED").inc()
                    logger.info("ingest_skipped", reason=str(exc))
                    return IngestResult(
                        snapshot_version=self.requested,
                        status="SKIPPED",
                        skipped_reason=str(exc),
                    )
                except Exception:
                    metrics.snapshot_runs_total.labels(status="FAILED").inc()
                    self._notify_failure()
                    raise
        finally:
            lock_session.close()

        metrics.snapshot_runs_total.labels(status="COMPLETED").inc()
        self.stats["total_seconds"] = time.perf_counter() - started
        metrics.snapshot_run_duration_seconds.labels(stage="total").observe(
            time.perf_counter() - started
        )
        NotificationService().send_ingest_success(
            version=result.snapshot_version, statistics=self.stats
        )
        return result

    # -- notifications -------------------------------------------------------
    def _notify_failure(self) -> None:
        """Best-effort failure e-mail. Never masks the original exception."""
        exc_info = sys.exc_info()[1]
        if isinstance(exc_info, IngestFailed):
            stage, code, message = exc_info.stage, exc_info.code, str(exc_info)
        else:
            stage, code, message = "UNEXPECTED", "UNEXPECTED", str(exc_info or "")
        NotificationService().send_ingest_failure(
            version=self.discovered_version or self.requested,
            stage=stage,
            code=code,
            message=message,
        )

    def _run_locked(self) -> IngestResult:
        # --- DISCOVERED ---------------------------------------------------
        with self._stage("discovery"):
            info = self._discover()

        version = info.version
        self.discovered_version = version
        self.settings.ensure_dirs(version)

        with session_scope() as session:
            snap_repo = SnapshotRepository(session)
            previous = snap_repo.latest_completed(before_version=version)
            snapshot = snap_repo.get_or_create(
                snapshot_version=version,
                source_url=info.source_url,
                schema_version=self.settings.schema_version,
                previous_snapshot_version=previous.snapshot_version if previous else None,
            )
            snapshot_id = snapshot.id
            previous_version = previous.snapshot_version if previous else None
            # "First snapshot" means "no prior snapshot to diff against", not
            # "database is empty": a backfill of an earlier year (e.g. 2025-01
            # after 2026 is already present) has no predecessor either, and
            # would otherwise flood consumers with a full discovered diff.
            is_first_snapshot = previous is None
            run = IngestRunRepository(session).start(
                snapshot_id,
                configuration={
                    "requested": self.requested,
                    "force": self.force,
                    "include_branches": self.settings.include_branches,
                    "include_partners": self.settings.receita_include_partners,
                    "initial_snapshot_mode": self.settings.initial_snapshot_mode.value,
                },
            )
            run_id = run.id

        try:
            result = self._execute(info, version, previous_version, is_first_snapshot)
        except IngestFailed as exc:
            self._set_status(
                version, SnapshotStatus.FAILED, error_code=exc.code, error_message=str(exc)
            )
            with session_scope() as session:
                IngestRunRepository(session).finish(
                    run_id, IngestRunStatus.FAILED, self.stats, exc.code, str(exc)
                )
                OutboxService(session).enqueue_ingest_failed(
                    version, exc.stage, exc.code, str(exc), self.correlation_id
                )
            raise
        except Exception as exc:
            self._set_status(
                version, SnapshotStatus.FAILED, error_code="UNEXPECTED", error_message=str(exc)
            )
            with session_scope() as session:
                IngestRunRepository(session).finish(
                    run_id,
                    IngestRunStatus.FAILED,
                    self.stats,
                    "UNEXPECTED",
                    f"{exc}\n{traceback.format_exc()}",
                )
                # Unexpected errors must be observable on NATS too, not only
                # on job logs — consumers key their alerts on this event.
                OutboxService(session).enqueue_ingest_failed(
                    version, "UNEXPECTED", "UNEXPECTED", str(exc), self.correlation_id
                )
            raise

        with session_scope() as session:
            IngestRunRepository(session).finish(
                run_id, IngestRunStatus.COMPLETED, result.statistics
            )
        return result

    # -- stages -------------------------------------------------------------
    def _discover(self) -> SnapshotInfo:
        discovery = SnapshotDiscovery()
        info = discovery.resolve(self.requested)
        if info is None:
            raise IngestSkipped(f"no snapshot available for {self.requested!r}")
        if not info.complete:
            raise IngestSkipped(
                f"snapshot {info.version} is incomplete "
                f"(missing: {', '.join(info.missing_prefixes)})"
            )

        with session_scope() as session:
            if SnapshotRepository(session).is_completed(info.version) and not self.force:
                raise IngestSkipped(f"snapshot {info.version} was already processed")

        logger.info("snapshot_discovered", snapshot_version=info.version, files=len(info.files))
        return info

    def _execute(
        self,
        info: SnapshotInfo,
        version: str,
        previous_version: str | None,
        is_first_snapshot: bool,
    ) -> IngestResult:
        # --- DOWNLOADING ---------------------------------------------------
        self._set_status(version, SnapshotStatus.DOWNLOADING)
        downloads_dir = self.settings.downloads_dir(version)
        downloader = Downloader(downloads_dir)
        download_started = time.perf_counter()
        with self._stage("download"):
            try:
                downloader.download_all(list(info.files))
            except Exception as exc:
                raise IngestFailed("DOWNLOADING", str(exc), "DOWNLOAD_FAILED") from exc
        self.stats["download_seconds"] = time.perf_counter() - download_started

        problems = downloader.verify_all()
        if problems:
            raise IngestFailed("DOWNLOADING", "; ".join(problems), "INTEGRITY_FAILED")

        with session_scope() as session:
            SnapshotRepository(session).set_manifest(version, downloader.manifest.to_dict())
        self._set_status(version, SnapshotStatus.DOWNLOADED)

        # --- EXTRACTING -----------------------------------------------------
        self._set_status(version, SnapshotStatus.EXTRACTING)
        extracted_dir = self.settings.extracted_dir(version)
        with self._stage("extract"):
            try:
                Extractor(extracted_dir).extract_all(sorted(downloads_dir.glob("*.zip")))
            except Exception as exc:
                raise IngestFailed("EXTRACTING", str(exc), "EXTRACTION_FAILED") from exc

        # --- NORMALIZING ------------------------------------------------------
        self._set_status(version, SnapshotStatus.NORMALIZING)
        builder = CanonicalSnapshotBuilder(version, extracted_dir)
        with self._stage("normalize"):
            try:
                snapshot_stats = builder.build()
            except Exception as exc:
                builder.discard()
                raise IngestFailed("NORMALIZING", str(exc), "NORMALIZATION_FAILED") from exc

        metrics.rows_processed_total.inc(snapshot_stats.total_rows)
        metrics.rows_rejected_total.inc(snapshot_stats.rejected_rows)
        self.stats.update(snapshot_stats.as_dict())

        # --- VALIDATING -------------------------------------------------------
        self._set_status(version, SnapshotStatus.VALIDATING)
        with self._stage("validate"):
            report = SnapshotValidator(version, builder.building_dir).validate()

        if not report.ok:
            builder.discard()  # never replace a good snapshot with a bad one
            raise IngestFailed("VALIDATING", "; ".join(report.errors), "VALIDATION_FAILED")

        snapshot_dir = builder.promote()
        metrics.active_companies_total.set(snapshot_stats.active_rows)

        # --- DIFFING ------------------------------------------------------------
        self._set_status(version, SnapshotStatus.DIFFING)
        previous_dir = self.settings.snapshot_dir(previous_version) if previous_version else None
        if previous_dir is not None and not previous_dir.exists():
            logger.warning("previous_snapshot_missing", previous_snapshot_version=previous_version)
            previous_dir = None

        with self._stage("diff"):
            diff = DiffEngine(
                snapshot_version=version,
                current_dir=snapshot_dir,
                previous_dir=previous_dir,
                previous_snapshot_version=previous_version if previous_dir else None,
            ).run()

        self.stats.update(diff.counts.as_dict())

        # --- CREATING_EVENTS -------------------------------------------------------
        self._set_status(version, SnapshotStatus.CREATING_EVENTS)
        store_only = (
            is_first_snapshot
            and self.settings.initial_snapshot_mode is InitialSnapshotMode.STORE_ONLY
        )

        storage = get_storage()
        manifest = read_snapshot_manifest(snapshot_dir) or {}
        checksum = None
        if storage.backend in ("S3", "GCS"):
            with self._stage("upload"):
                storage.upload_directory(snapshot_dir, f"{version}")
                checksum = storage.checksum_of_local(snapshot_dir)  # type: ignore[attr-defined]

        # --- SINK (OLAP / RAG) -------------------------------------------------
        # Load the active dataset into the analytical store. Best-effort: a sink
        # failure must not fail an otherwise-good snapshot, since the Parquet and
        # events are already the source of truth.
        if self.settings.sink is Sink.POSTGRES:
            from cnpj_data_publisher.processing.postgres_sink import PostgresSink

            try:
                with self._stage("sink"):
                    sink_result = PostgresSink(snapshot_dir).load()
                self.stats["sink_rows_loaded"] = sink_result.rows_loaded
            except Exception as exc:  # noqa: BLE001 - non-fatal by design
                logger.error("sink_failed", snapshot_version=version, error=str(exc))
                self.stats["sink_error"] = str(exc)

        with self._stage("create_events"), session_scope() as session:
            outbox = OutboxService(session)
            counts = outbox.enqueue_diff(
                diff, correlation_id=self.correlation_id, publish_discovered=not store_only
            )
            outbox.enqueue_snapshot_ready(
                version,
                manifest,
                storage.descriptor(f"{version}/active/", f"{version}/manifest.json"),
                checksum,
                self.correlation_id,
            )
            outbox.enqueue_ingest_completed(version, self.stats, self.correlation_id)

        events_created = sum(counts.values()) + 2
        self.stats["events_created"] = events_created
        self.stats["store_only"] = store_only

        # --- COMPLETED ---------------------------------------------------------------
        self._set_status(version, SnapshotStatus.COMPLETED)
        logger.info("ingest_completed", snapshot_version=version, **self.stats)

        return IngestResult(
            snapshot_version=version,
            status="COMPLETED",
            statistics=self.stats,
            events_created=events_created,
        )


def ingest_year(year: int, force: bool = False) -> list[IngestResult]:
    """Ingest every available monthly snapshot of a year, oldest first.

    Each month runs through the normal :class:`IngestPipeline`, so the
    month-over-month diff chains correctly (``2025-01`` first, then ``2025-02``
    against it, and so on). Snapshots already marked COMPLETED are reported as
    ``SKIPPED`` results by the pipeline rather than re-processed.
    """
    versions = sorted(
        v for v in SnapshotDiscovery().list_versions() if v.startswith(f"{year:04d}-")
    )
    results: list[IngestResult] = []
    for version in versions:
        logger.info("ingest_year_snapshot", snapshot_version=version, year=year)
        results.append(IngestPipeline(requested_snapshot=version, force=force).run())
    return results
