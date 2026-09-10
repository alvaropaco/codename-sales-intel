"""Snapshot diff engine (spec section 15).

Classification rules, verbatim from the spec:

- absent before, active now                       -> COMPANY_DISCOVERED
- active before, active now, fingerprint changed  -> COMPANY_UPDATED
- present but inactive before, active now         -> COMPANY_REACTIVATED
- active before, present but inactive now         -> COMPANY_INACTIVATED
- active before and now, same fingerprint         -> no event
- inactive before and now                         -> no event

Inactivation requires a *current* record whose status is not ``02``. A company
that simply vanished from the export is never treated as inactivated.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.processing._duckdb import fetch_scalar
from cnpj_data_publisher.processing.normalizer import ACTIVE_STATUS_CODE

logger = get_logger(__name__)

DIFF_MANIFEST = "manifest.json"

DISCOVERED = "discovered"
UPDATED = "updated"
REACTIVATED = "reactivated"
INACTIVATED = "inactivated"

DIFF_DATASETS: tuple[str, ...] = (DISCOVERED, UPDATED, REACTIVATED, INACTIVATED)


@dataclass(slots=True)
class DiffCounts:
    discovered: int = 0
    updated: int = 0
    reactivated: int = 0
    inactivated: int = 0
    unchanged: int = 0

    @property
    def total_events(self) -> int:
        return self.discovered + self.updated + self.reactivated + self.inactivated

    def as_dict(self) -> dict[str, int]:
        return {
            "discovered": self.discovered,
            "updated": self.updated,
            "reactivated": self.reactivated,
            "inactivated": self.inactivated,
            "unchanged": self.unchanged,
        }


@dataclass(slots=True)
class DiffResult:
    snapshot_version: str
    previous_snapshot_version: str | None
    output_dir: Path
    counts: DiffCounts = field(default_factory=DiffCounts)
    is_initial: bool = False

    def dataset_path(self, name: str) -> Path:
        return self.output_dir / f"{name}.parquet"

    def as_manifest(self) -> dict[str, Any]:
        return {
            "snapshot_version": self.snapshot_version,
            "previous_snapshot_version": self.previous_snapshot_version,
            "is_initial": self.is_initial,
            "created_at": datetime.now(UTC).isoformat(),
            **self.counts.as_dict(),
        }


class DiffEngine:
    """Compares two canonical snapshots and materializes per-event Parquet files."""

    def __init__(
        self,
        snapshot_version: str,
        current_dir: Path,
        previous_dir: Path | None,
        output_dir: Path | None = None,
        previous_snapshot_version: str | None = None,
    ) -> None:
        self.settings = get_settings()
        self.snapshot_version = snapshot_version
        self.current_dir = current_dir
        self.previous_dir = previous_dir
        self.previous_snapshot_version = previous_snapshot_version
        self.output_dir = output_dir or self.settings.diffs_dir(snapshot_version)

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _glob(directory: Path) -> str:
        return str(directory / "all" / "**" / "*.parquet")

    def _connect(self) -> duckdb.DuckDBPyConnection:
        con = duckdb.connect(":memory:")
        con.execute(f"SET memory_limit='{self.settings.duckdb_memory_limit}'")
        con.execute(f"SET threads={self.settings.duckdb_threads}")
        con.execute(f"SET temp_directory='{self.settings.temporary_dir}'")
        return con

    def _write(self, con: duckdb.DuckDBPyConnection, name: str, sql: str) -> int:
        target = self.output_dir / f"{name}.parquet"
        con.execute(
            f"COPY ({sql}) TO '{target}' "
            f"(FORMAT PARQUET, COMPRESSION '{self.settings.parquet_compression}')"
        )
        return int(fetch_scalar(con, f"SELECT count(*) FROM read_parquet('{target}')"))

    # -- main -------------------------------------------------------------
    def run(self) -> DiffResult:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        result = DiffResult(
            snapshot_version=self.snapshot_version,
            previous_snapshot_version=self.previous_snapshot_version,
            output_dir=self.output_dir,
            is_initial=self.previous_dir is None,
        )

        con = self._connect()
        try:
            if self.previous_dir is None:
                self._initial_diff(con, result)
            else:
                self._incremental_diff(con, result)
        finally:
            con.close()

        self._write_manifest(result)
        logger.info(
            "snapshot_diff_completed",
            snapshot_version=self.snapshot_version,
            previous_snapshot_version=self.previous_snapshot_version,
            **result.counts.as_dict(),
        )
        return result

    def _initial_diff(self, con: duckdb.DuckDBPyConnection, result: DiffResult) -> None:
        """First snapshot: every active company counts as discovered.

        The events are still materialized so ``PUBLISH_ALL`` or a later backfill
        can consume them, but ``STORE_ONLY`` mode will not turn them into
        outbox rows.
        """
        con.execute(
            f"CREATE VIEW current AS SELECT * FROM read_parquet('{self._glob(self.current_dir)}')"
        )
        result.counts.discovered = self._write(
            con,
            DISCOVERED,
            f"SELECT * FROM current WHERE registration_status_code = '{ACTIVE_STATUS_CODE}'",
        )
        for name in (UPDATED, REACTIVATED, INACTIVATED):
            self._write(con, name, "SELECT * FROM current WHERE false")

    def _incremental_diff(self, con: duckdb.DuckDBPyConnection, result: DiffResult) -> None:
        assert self.previous_dir is not None
        active = f"'{ACTIVE_STATUS_CODE}'"

        con.execute(
            f"CREATE VIEW current AS SELECT * FROM read_parquet('{self._glob(self.current_dir)}')"
        )
        con.execute(
            f"""
            CREATE VIEW previous AS
            SELECT cnpj, registration_status, registration_status_code, fingerprint
            FROM read_parquet('{self._glob(self.previous_dir)}')
            """
        )

        # New and active.
        result.counts.discovered = self._write(
            con,
            DISCOVERED,
            f"""
            SELECT c.*
            FROM current c
            LEFT JOIN previous p ON p.cnpj = c.cnpj
            WHERE p.cnpj IS NULL
              AND c.registration_status_code = {active}
            """,
        )

        # Active before and now, content changed.
        result.counts.updated = self._write(
            con,
            UPDATED,
            f"""
            SELECT c.*,
                   p.fingerprint AS previous_fingerprint
            FROM current c
            JOIN previous p ON p.cnpj = c.cnpj
            WHERE c.registration_status_code = {active}
              AND p.registration_status_code = {active}
              AND c.fingerprint IS DISTINCT FROM p.fingerprint
            """,
        )

        # Was present but not active, now active.
        result.counts.reactivated = self._write(
            con,
            REACTIVATED,
            f"""
            SELECT c.*,
                   p.registration_status      AS previous_registration_status,
                   p.registration_status_code AS previous_registration_status_code
            FROM current c
            JOIN previous p ON p.cnpj = c.cnpj
            WHERE c.registration_status_code = {active}
              AND p.registration_status_code IS DISTINCT FROM {active}
            """,
        )

        # Was active, current record says it is not active anymore.
        # Requires a current row: disappearance alone is never an inactivation.
        result.counts.inactivated = self._write(
            con,
            INACTIVATED,
            f"""
            SELECT c.*,
                   p.registration_status      AS previous_registration_status,
                   p.registration_status_code AS previous_registration_status_code
            FROM current c
            JOIN previous p ON p.cnpj = c.cnpj
            WHERE p.registration_status_code = {active}
              AND c.registration_status_code IS DISTINCT FROM {active}
            """,
        )

        result.counts.unchanged = int(
            fetch_scalar(
                con,
                f"""
                SELECT count(*)
                FROM current c
                JOIN previous p ON p.cnpj = c.cnpj
                WHERE c.registration_status_code = {active}
                  AND p.registration_status_code = {active}
                  AND c.fingerprint IS NOT DISTINCT FROM p.fingerprint
                """,
            )
        )

    def _write_manifest(self, result: DiffResult) -> None:
        path = self.output_dir / DIFF_MANIFEST
        path.write_text(
            json.dumps(result.as_manifest(), indent=2, ensure_ascii=False), encoding="utf-8"
        )


def read_diff_manifest(diff_dir: Path) -> dict[str, Any] | None:
    path = diff_dir / DIFF_MANIFEST
    if not path.exists():
        return None
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data


def iter_diff_rows(diff_dir: Path, dataset: str, batch_size: int = 1000) -> Any:
    """Yield rows from one diff dataset as dictionaries, in batches."""
    path = diff_dir / f"{dataset}.parquet"
    if not path.exists():
        return

    con = duckdb.connect(":memory:")
    try:
        con.execute(f"SET temp_directory='{get_settings().temporary_dir}'")
        cursor = con.execute(f"SELECT * FROM read_parquet('{path}') ORDER BY cnpj")
        columns = [d[0] for d in cursor.description]
        while True:
            rows = cursor.fetchmany(batch_size)
            if not rows:
                break
            for row in rows:
                yield dict(zip(columns, row, strict=True))
    finally:
        con.close()
