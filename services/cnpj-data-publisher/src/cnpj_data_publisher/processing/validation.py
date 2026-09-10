"""Snapshot validation gate (spec section 13).

A snapshot is only promoted when every check passes. On failure the previous
snapshot stays untouched, no diff runs and no events are created.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.processing._duckdb import fetch_one
from cnpj_data_publisher.processing.canonical_snapshot import read_snapshot_manifest

logger = get_logger(__name__)


@dataclass(slots=True)
class ValidationIssue:
    check: str
    message: str
    fatal: bool = True


@dataclass(slots=True)
class ValidationReport:
    snapshot_version: str
    issues: list[ValidationIssue] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not any(issue.fatal for issue in self.issues)

    @property
    def errors(self) -> list[str]:
        return [f"{i.check}: {i.message}" for i in self.issues if i.fatal]

    @property
    def warnings(self) -> list[str]:
        return [f"{i.check}: {i.message}" for i in self.issues if not i.fatal]

    def add(self, check: str, message: str, fatal: bool = True) -> None:
        self.issues.append(ValidationIssue(check=check, message=message, fatal=fatal))

    def as_dict(self) -> dict[str, Any]:
        return {
            "snapshot_version": self.snapshot_version,
            "ok": self.ok,
            "errors": self.errors,
            "warnings": self.warnings,
            "stats": self.stats,
        }


class SnapshotValidator:
    """Runs every pre-promotion check against a built snapshot directory."""

    def __init__(self, snapshot_version: str, snapshot_dir: Path) -> None:
        self.settings = get_settings()
        self.snapshot_version = snapshot_version
        self.snapshot_dir = snapshot_dir

    def validate(self) -> ValidationReport:
        report = ValidationReport(snapshot_version=self.snapshot_version)

        manifest = read_snapshot_manifest(self.snapshot_dir)
        if manifest is None:
            report.add("manifest", f"manifest.json missing in {self.snapshot_dir}")
            return report

        report.stats = {
            k: manifest.get(k)
            for k in (
                "total_rows",
                "active_rows",
                "headquarters_rows",
                "branches_rows",
                "rejected_rows",
                "partitions",
            )
        }

        self._check_manifest_fields(manifest, report)
        self._check_directories(report)
        if not report.ok:
            return report

        self._check_parquet(report)
        self._check_rejection_rate(manifest, report)
        self._check_row_counts(manifest, report)

        if report.ok:
            logger.info(
                "snapshot_validated", snapshot_version=self.snapshot_version, **report.stats
            )
        else:
            logger.error(
                "snapshot_validation_failed",
                snapshot_version=self.snapshot_version,
                errors=report.errors,
            )
        return report

    # -- individual checks -------------------------------------------------
    def _check_manifest_fields(self, manifest: dict[str, Any], report: ValidationReport) -> None:
        required = (
            "snapshot_version",
            "schema_version",
            "created_at",
            "total_rows",
            "active_rows",
            "partitions",
        )
        missing = [key for key in required if key not in manifest]
        if missing:
            report.add("manifest", f"missing keys: {', '.join(missing)}")
        if manifest.get("snapshot_version") != self.snapshot_version:
            report.add(
                "manifest",
                f"version mismatch: manifest says {manifest.get('snapshot_version')!r}",
            )

    def _check_directories(self, report: ValidationReport) -> None:
        for dataset in ("all", "active"):
            path = self.snapshot_dir / dataset
            if not path.is_dir():
                report.add("layout", f"missing dataset directory {dataset}/")
                continue
            partitions = [p for p in path.iterdir() if p.is_dir()]
            if not partitions:
                report.add("layout", f"{dataset}/ has no partitions")
                continue
            empty = [p.name for p in partitions if not any(p.glob("*.parquet"))]
            if empty:
                report.add("layout", f"{dataset}/ empty partitions: {', '.join(sorted(empty))}")

    def _check_parquet(self, report: ValidationReport) -> None:
        """Read the dataset back and assert the core data invariants."""
        pattern = self.snapshot_dir / "all" / "**" / "*.parquet"
        con = duckdb.connect(":memory:")
        try:
            con.execute(f"SET temp_directory='{self.settings.temporary_dir}'")
            source = f"read_parquet('{pattern}')"
            row = fetch_one(
                con,
                f"""
                SELECT
                    count(*),
                    count(*) FILTER (WHERE cnpj IS NULL OR length(cnpj) <> 14),
                    count(*) FILTER (WHERE registration_status = 'UNKNOWN'),
                    count(*) FILTER (WHERE fingerprint IS NULL),
                    count(DISTINCT cnpj)
                FROM {source}
                """,
            )
        except duckdb.Error as exc:
            report.add("parquet", f"dataset is not readable: {exc}")
            return
        finally:
            con.close()

        total, bad_cnpj, unknown_status, null_fp, distinct_cnpj = (int(v) for v in row)

        if total == 0:
            report.add("parquet", "dataset has no rows")
            return
        if bad_cnpj:
            report.add("cnpj", f"{bad_cnpj} rows have an invalid CNPJ")
        if distinct_cnpj != total:
            report.add("cnpj", f"CNPJ is not unique: {total} rows, {distinct_cnpj} distinct")
        if null_fp:
            report.add("fingerprint", f"{null_fp} rows have a NULL fingerprint")
        if unknown_status:
            report.add(
                "status",
                f"{unknown_status} rows have an unmapped registration status",
                fatal=False,
            )

    def _check_rejection_rate(self, manifest: dict[str, Any], report: ValidationReport) -> None:
        total = int(manifest.get("total_rows") or 0)
        rejected = int(manifest.get("rejected_rows") or 0)
        if total + rejected == 0:
            return
        rate = Decimal(rejected) / Decimal(total + rejected)
        limit = self.settings.max_rejected_row_percentage
        report.stats["rejection_rate"] = float(rate)
        if rate > limit:
            report.add(
                "rejection_rate",
                f"{rate:.4%} rejected exceeds limit of {limit:.4%}",
            )

    def _check_row_counts(self, manifest: dict[str, Any], report: ValidationReport) -> None:
        total = int(manifest.get("total_rows") or 0)
        minimum = self.settings.min_expected_total_rows
        if total < minimum:
            report.add(
                "row_count",
                f"{total} rows is below MIN_EXPECTED_TOTAL_ROWS ({minimum})",
            )
        if int(manifest.get("active_rows") or 0) == 0:
            report.add("row_count", "snapshot contains no active companies")
