"""Resumable backfill of active companies (spec sections 5.3 and 17)."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import duckdb

from cnpj_data_publisher import metrics
from cnpj_data_publisher.backfill.checkpoints import Cursor, RateLimiter
from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.database.models import BackfillStatus
from cnpj_data_publisher.database.repositories import BackfillRepository
from cnpj_data_publisher.database.session import session_scope
from cnpj_data_publisher.events import company_events as builders
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.outbox.service import OutboxService, envelope_to_row
from cnpj_data_publisher.processing._duckdb import fetch_scalar

logger = get_logger(__name__)


@dataclass(slots=True)
class BackfillFilters:
    """Every filter allowed by the spec."""

    state: str | None = None
    main_cnae: str | None = None
    opening_date_from: date | None = None
    opening_date_to: date | None = None
    headquarters_only: bool | None = None
    company_size_code: str | None = None
    mei_option: bool | None = None
    simple_tax_option: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "main_cnae": self.main_cnae,
            "opening_date_from": self.opening_date_from.isoformat()
            if self.opening_date_from
            else None,
            "opening_date_to": self.opening_date_to.isoformat() if self.opening_date_to else None,
            "headquarters_only": self.headquarters_only,
            "company_size_code": self.company_size_code,
            "mei_option": self.mei_option,
            "simple_tax_option": self.simple_tax_option,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> BackfillFilters:
        data = data or {}

        def _date(key: str) -> date | None:
            raw = data.get(key)
            return date.fromisoformat(raw) if raw else None

        return cls(
            state=data.get("state"),
            main_cnae=data.get("main_cnae"),
            opening_date_from=_date("opening_date_from"),
            opening_date_to=_date("opening_date_to"),
            headquarters_only=data.get("headquarters_only"),
            company_size_code=data.get("company_size_code"),
            mei_option=data.get("mei_option"),
            simple_tax_option=data.get("simple_tax_option"),
        )

    def where_clause(self) -> tuple[str, list[Any]]:
        """Build a parameterized WHERE clause."""
        clauses: list[str] = []
        params: list[Any] = []

        if self.state:
            clauses.append("state = ?")
            params.append(self.state.upper())
        if self.main_cnae:
            clauses.append("main_cnae = ?")
            params.append(self.main_cnae)
        if self.opening_date_from:
            clauses.append("opening_date >= ?")
            params.append(self.opening_date_from)
        if self.opening_date_to:
            clauses.append("opening_date <= ?")
            params.append(self.opening_date_to)
        if self.headquarters_only is True:
            clauses.append("is_headquarters")
        elif self.headquarters_only is False:
            clauses.append("NOT is_headquarters")
        if self.company_size_code:
            clauses.append("company_size_code = ?")
            params.append(self.company_size_code)
        if self.mei_option is not None:
            clauses.append("mei_option = ?")
            params.append(self.mei_option)
        if self.simple_tax_option is not None:
            clauses.append("simple_tax_option = ?")
            params.append(self.simple_tax_option)

        return (" AND ".join(clauses) if clauses else "true"), params


class BackfillService:
    """Streams the active dataset into the outbox at a controlled rate."""

    def __init__(
        self,
        snapshot_version: str,
        snapshot_dir: Path | None = None,
        filters: BackfillFilters | None = None,
        rate_limit: int | None = None,
        batch_size: int | None = None,
    ) -> None:
        self.settings = get_settings()
        self.snapshot_version = snapshot_version
        self.snapshot_dir = snapshot_dir or self.settings.snapshot_dir(snapshot_version)
        self.filters = filters or BackfillFilters()
        self.rate_limit = self.settings.backfill_default_rate if rate_limit is None else rate_limit
        self.batch_size = batch_size or self.settings.backfill_default_batch_size

    # -- dataset -----------------------------------------------------------
    @property
    def dataset(self) -> str:
        return str(self.snapshot_dir / "active" / "**" / "*.parquet")

    def _connect(self) -> duckdb.DuckDBPyConnection:
        con = duckdb.connect(":memory:")
        con.execute(f"SET memory_limit='{self.settings.duckdb_memory_limit}'")
        con.execute(f"SET threads={self.settings.duckdb_threads}")
        con.execute(f"SET temp_directory='{self.settings.temporary_dir}'")
        return con

    def count_rows(self) -> int:
        where, params = self.filters.where_clause()
        con = self._connect()
        try:
            return int(
                fetch_scalar(
                    con,
                    f"SELECT count(*) FROM read_parquet('{self.dataset}') WHERE {where}",
                    params,
                )
            )
        finally:
            con.close()

    def iter_batches(self, cursor: Cursor) -> Iterator[list[dict[str, Any]]]:
        """Yield batches ordered by CNPJ so the run is resumable."""
        where, params = self.filters.where_clause()
        con = self._connect()
        try:
            last = cursor.last_cnpj
            while True:
                resume = " AND cnpj > ?" if last else ""
                query_params = [*params, last] if last else list(params)
                rows = con.execute(
                    f"""
                    SELECT * FROM read_parquet('{self.dataset}')
                    WHERE {where}{resume}
                    ORDER BY cnpj
                    LIMIT {self.batch_size}
                    """,
                    query_params,
                ).fetchall()
                if not rows:
                    return

                columns = [d[0] for d in con.description]
                batch = [dict(zip(columns, row, strict=True)) for row in rows]
                yield batch
                last = batch[-1]["cnpj"]
        finally:
            con.close()

    # -- run ----------------------------------------------------------------
    def run(self, resume: bool = True, run_id: uuid.UUID | None = None) -> dict[str, Any]:
        if not self.snapshot_dir.exists():
            raise FileNotFoundError(f"snapshot not found: {self.snapshot_dir}")

        with session_scope() as session:
            repo = BackfillRepository(session)
            record = repo.find_resumable(self.snapshot_version) if resume else None
            if record is None:
                record = repo.create(
                    snapshot_version=self.snapshot_version,
                    filters=self.filters.to_dict(),
                    rate_limit=self.rate_limit,
                    batch_size=self.batch_size,
                    total_rows=self.count_rows(),
                )
            else:
                # Reuse the persisted filters so a resume never changes scope.
                self.filters = BackfillFilters.from_dict(record.filters)
                self.batch_size = record.batch_size or self.batch_size
            run_id = record.id
            total_rows = record.total_rows
            cursor = Cursor.from_dict(record.cursor)
            repo.mark_running(run_id)

        limiter = RateLimiter(self.rate_limit)
        logger.info(
            "backfill_started",
            backfill_id=str(run_id),
            snapshot_version=self.snapshot_version,
            total_rows=total_rows,
            resumed=cursor.last_cnpj is not None,
            rate_limit=self.rate_limit,
        )

        try:
            for batch in self.iter_batches(cursor):
                limiter.acquire(len(batch))

                rows = [
                    envelope_to_row(
                        builders.build_discovered(record_row, self.snapshot_version),
                        str(record_row["cnpj"]),
                    )
                    for record_row in batch
                ]

                with session_scope() as session:
                    OutboxService(session).enqueue_many(rows)
                    cursor.advance(str(batch[-1]["cnpj"]), len(batch), len(rows))
                    BackfillRepository(session).save_cursor(
                        run_id,
                        cursor.to_dict(),
                        cursor.processed_rows,
                        cursor.published_rows,
                        cursor.failed_rows,
                    )

                metrics.backfill_rows_total.inc(len(rows))
                if total_rows:
                    metrics.backfill_progress.set(min(1.0, cursor.processed_rows / total_rows))

                logger.info(
                    "backfill_batch",
                    backfill_id=str(run_id),
                    processed=cursor.processed_rows,
                    total=total_rows,
                )

            with session_scope() as session:
                BackfillRepository(session).finish(run_id, BackfillStatus.COMPLETED)

        except KeyboardInterrupt:
            with session_scope() as session:
                BackfillRepository(session).finish(run_id, BackfillStatus.PAUSED)
            logger.warning("backfill_paused", backfill_id=str(run_id))
            raise
        except Exception as exc:
            with session_scope() as session:
                BackfillRepository(session).finish(run_id, BackfillStatus.FAILED, str(exc))
            logger.error("backfill_failed", backfill_id=str(run_id), error=str(exc))
            raise

        result = {
            "backfill_id": str(run_id),
            "snapshot_version": self.snapshot_version,
            "total_rows": total_rows,
            **cursor.to_dict(),
        }
        logger.info("backfill_completed", **result)
        return result
