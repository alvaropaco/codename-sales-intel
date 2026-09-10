"""Diff engine tests against the two-snapshot fixture."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from cnpj_data_publisher.processing.canonical_snapshot import CanonicalSnapshotBuilder
from cnpj_data_publisher.processing.diff import (
    DISCOVERED,
    INACTIVATED,
    REACTIVATED,
    UPDATED,
    DiffEngine,
    iter_diff_rows,
    read_diff_manifest,
)
from cnpj_data_publisher.receita.extractor import Extractor

from tests.fixtures.builder import EXPECTED_DIFF, build_snapshot_fixture

pytestmark = pytest.mark.unit


def _snapshot(tmp_path: Path, version: str) -> Path:
    """Build and promote a snapshot, returning its directory."""
    downloads = build_snapshot_fixture(tmp_path / "downloads", version)
    extracted = tmp_path / "extracted" / version
    Extractor(extracted).extract_all(sorted(downloads.glob("*.zip")))

    builder = CanonicalSnapshotBuilder(
        snapshot_version=version,
        extracted_dir=extracted,
        output_dir=tmp_path / "building" / version,
        rejected_dir=tmp_path / "rejected" / version,
    )
    builder.build()
    target = tmp_path / "snapshots" / version
    target.parent.mkdir(parents=True, exist_ok=True)
    builder.building_dir.rename(target)
    return target


def _cnpjs(diff_dir: Path, dataset: str) -> set[str]:
    path = diff_dir / f"{dataset}.parquet"
    con = duckdb.connect(":memory:")
    try:
        return {r[0] for r in con.execute(f"SELECT cnpj FROM read_parquet('{path}')").fetchall()}
    finally:
        con.close()


@pytest.fixture
def diff_dir(tmp_path: Path) -> Path:
    june = _snapshot(tmp_path, "2026-06")
    july = _snapshot(tmp_path, "2026-07")
    engine = DiffEngine(
        snapshot_version="2026-07",
        current_dir=july,
        previous_dir=june,
        output_dir=tmp_path / "diffs" / "2026-07",
        previous_snapshot_version="2026-06",
    )
    engine.run()
    return tmp_path / "diffs" / "2026-07"


def test_new_active_company_is_discovered(diff_dir: Path) -> None:
    assert _cnpjs(diff_dir, DISCOVERED) == EXPECTED_DIFF["discovered"]


def test_changed_company_is_updated(diff_dir: Path) -> None:
    assert _cnpjs(diff_dir, UPDATED) == EXPECTED_DIFF["updated"]


def test_reactivated_company_detected(diff_dir: Path) -> None:
    assert _cnpjs(diff_dir, REACTIVATED) == EXPECTED_DIFF["reactivated"]


def test_inactivated_company_detected(diff_dir: Path) -> None:
    assert _cnpjs(diff_dir, INACTIVATED) == EXPECTED_DIFF["inactivated"]


def test_unchanged_company_generates_no_event(diff_dir: Path) -> None:
    """The core acceptance criterion from spec section 45."""
    stable = "22222222000190"
    for dataset in (DISCOVERED, UPDATED, REACTIVATED, INACTIVATED):
        assert stable not in _cnpjs(diff_dir, dataset)


def test_new_inactive_company_generates_no_event(diff_dir: Path) -> None:
    new_inactive = "66666666000190"
    for dataset in (DISCOVERED, UPDATED, REACTIVATED, INACTIVATED):
        assert new_inactive not in _cnpjs(diff_dir, dataset)


def test_manifest_counts(diff_dir: Path) -> None:
    manifest = read_diff_manifest(diff_dir)

    assert manifest is not None
    assert manifest["snapshot_version"] == "2026-07"
    assert manifest["previous_snapshot_version"] == "2026-06"
    assert manifest["discovered"] == 1
    assert manifest["updated"] == 1
    assert manifest["reactivated"] == 1
    assert manifest["inactivated"] == 1
    assert manifest["unchanged"] >= 1
    assert manifest["is_initial"] is False


def test_updated_carries_previous_fingerprint(diff_dir: Path) -> None:
    rows = list(iter_diff_rows(diff_dir, UPDATED))

    assert len(rows) == 1
    row = rows[0]
    assert row["cnpj"] == "11111111000190"
    assert row["previous_fingerprint"]
    assert row["previous_fingerprint"] != row["fingerprint"]


def test_reactivated_carries_previous_status(diff_dir: Path) -> None:
    rows = list(iter_diff_rows(diff_dir, REACTIVATED))

    assert rows[0]["previous_registration_status"] == "SUSPENDED"
    assert rows[0]["previous_registration_status_code"] == "03"
    assert rows[0]["registration_status"] == "ACTIVE"


def test_inactivated_carries_previous_status(diff_dir: Path) -> None:
    rows = list(iter_diff_rows(diff_dir, INACTIVATED))

    assert rows[0]["previous_registration_status"] == "ACTIVE"
    assert rows[0]["registration_status"] == "CLOSED"
    assert rows[0]["registration_status_code"] == "08"


def test_initial_snapshot_marks_all_active_as_discovered(tmp_path: Path) -> None:
    july = _snapshot(tmp_path, "2026-07")
    engine = DiffEngine(
        snapshot_version="2026-07",
        current_dir=july,
        previous_dir=None,
        output_dir=tmp_path / "diffs" / "initial",
    )
    result = engine.run()

    assert result.is_initial is True
    assert result.counts.discovered > 0
    assert result.counts.updated == 0
    assert result.counts.reactivated == 0
    assert result.counts.inactivated == 0

    # Only active companies are included.
    discovered = _cnpjs(tmp_path / "diffs" / "initial", DISCOVERED)
    assert "44444444000190" not in discovered  # closed
    assert "66666666000190" not in discovered  # unfit


def test_disappearance_is_not_inactivation(tmp_path: Path) -> None:
    """Spec: absence alone must never produce COMPANY_INACTIVATED."""
    june = _snapshot(tmp_path, "2026-06")
    july = _snapshot(tmp_path, "2026-07")

    # Remove a company from the current snapshot entirely.
    con = duckdb.connect(":memory:")
    filtered = tmp_path / "filtered" / "all" / "state=SP"
    filtered.mkdir(parents=True)
    try:
        con.execute(
            f"""
            COPY (
                SELECT * FROM read_parquet('{july}/all/**/*.parquet')
                WHERE cnpj <> '22222222000190'
            ) TO '{filtered / "data.parquet"}' (FORMAT PARQUET)
            """
        )
    finally:
        con.close()

    engine = DiffEngine(
        snapshot_version="2026-07",
        current_dir=tmp_path / "filtered",
        previous_dir=june,
        output_dir=tmp_path / "diffs" / "vanished",
        previous_snapshot_version="2026-06",
    )
    engine.run()

    assert "22222222000190" not in _cnpjs(tmp_path / "diffs" / "vanished", INACTIVATED)


def test_rerun_is_idempotent(tmp_path: Path) -> None:
    june = _snapshot(tmp_path, "2026-06")
    july = _snapshot(tmp_path, "2026-07")
    out = tmp_path / "diffs" / "2026-07"

    def run() -> dict[str, int]:
        return (
            DiffEngine(
                snapshot_version="2026-07",
                current_dir=july,
                previous_dir=june,
                output_dir=out,
                previous_snapshot_version="2026-06",
            )
            .run()
            .counts.as_dict()
        )

    assert run() == run()
