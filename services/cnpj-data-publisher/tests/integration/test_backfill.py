"""Backfill tests: filters, rate limiting, cursor and resume."""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from cnpj_data_publisher.backfill.checkpoints import Cursor, RateLimiter
from cnpj_data_publisher.backfill.service import BackfillFilters, BackfillService
from cnpj_data_publisher.config import reset_settings
from cnpj_data_publisher.database.models import Base
from cnpj_data_publisher.processing.canonical_snapshot import CanonicalSnapshotBuilder
from cnpj_data_publisher.receita.extractor import Extractor

from tests.fixtures.builder import build_snapshot_fixture

DB_URL = os.environ.get("TEST_DATABASE_URL")
requires_db = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL is not set")


# ---------------------------------------------------------------------
# Pure units
# ---------------------------------------------------------------------
@pytest.mark.unit
class TestCursor:
    def test_roundtrip(self) -> None:
        cursor = Cursor(last_cnpj="11111111000190", processed_rows=10, published_rows=9)
        assert Cursor.from_dict(cursor.to_dict()) == cursor

    def test_empty_dict_gives_fresh_cursor(self) -> None:
        assert Cursor.from_dict(None) == Cursor()
        assert Cursor.from_dict({}) == Cursor()

    def test_advance_accumulates(self) -> None:
        cursor = Cursor()
        cursor.advance("aaa", 10, 10)
        cursor.advance("bbb", 5, 4, failed=1)

        assert cursor.last_cnpj == "bbb"
        assert cursor.processed_rows == 15
        assert cursor.published_rows == 14
        assert cursor.failed_rows == 1


@pytest.mark.unit
class TestRateLimiter:
    def test_zero_rate_is_disabled(self) -> None:
        limiter = RateLimiter(0)
        assert limiter.enabled is False
        assert limiter.acquire(1_000_000) == 0.0

    def test_limits_throughput(self) -> None:
        limiter = RateLimiter(50)
        started = time.monotonic()
        for _ in range(4):
            limiter.acquire(25)
        elapsed = time.monotonic() - started

        # 100 tokens at 50/s, minus the initial full bucket, is about 1s.
        assert elapsed >= 0.9, f"limiter did not throttle (elapsed {elapsed:.2f}s)"


@pytest.mark.unit
class TestFilters:
    def test_empty_filters_match_everything(self) -> None:
        where, params = BackfillFilters().where_clause()
        assert where == "true"
        assert params == []

    def test_filters_are_parameterized(self) -> None:
        from datetime import date

        where, params = BackfillFilters(
            state="SP",
            main_cnae="6201501",
            opening_date_from=date(2026, 1, 1),
            headquarters_only=True,
            mei_option=False,
        ).where_clause()

        assert "state = ?" in where
        assert "main_cnae = ?" in where
        assert "opening_date >= ?" in where
        assert "is_headquarters" in where
        assert params == ["SP", "6201501", date(2026, 1, 1), False]

    def test_roundtrip(self) -> None:
        from datetime import date

        original = BackfillFilters(
            state="RJ", opening_date_to=date(2026, 12, 31), simple_tax_option=True
        )
        assert BackfillFilters.from_dict(original.to_dict()) == original


# ---------------------------------------------------------------------
# Against a real snapshot and database
# ---------------------------------------------------------------------
@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    downloads = build_snapshot_fixture(tmp_path / "downloads", "2026-07")
    extracted = tmp_path / "extracted"
    Extractor(extracted).extract_all(sorted(downloads.glob("*.zip")))

    builder = CanonicalSnapshotBuilder(
        snapshot_version="2026-07",
        extracted_dir=extracted,
        output_dir=tmp_path / "building",
        rejected_dir=tmp_path / "rejected",
    )
    builder.build()
    target = tmp_path / "snapshots" / "2026-07"
    target.parent.mkdir(parents=True, exist_ok=True)
    builder.building_dir.rename(target)
    return target


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("DATABASE_URL", DB_URL or "")
    reset_settings()

    import cnpj_data_publisher.database.session as session_module

    session_module.dispose_engine()

    engine = create_engine(DB_URL or "")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE event_outbox, backfill_runs CASCADE"))
    engine.dispose()

    yield

    engine = create_engine(DB_URL or "")
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE event_outbox, backfill_runs CASCADE"))
    engine.dispose()
    session_module.dispose_engine()
    reset_settings()


@pytest.mark.integration
@requires_db
def test_backfill_publishes_active_companies(snapshot: Path, db: None) -> None:
    service = BackfillService("2026-07", snapshot_dir=snapshot, batch_size=2)
    result = service.run()

    assert result["published_rows"] > 0
    assert result["processed_rows"] == result["published_rows"]

    engine = create_engine(DB_URL or "")
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE event_type = 'COMPANY_DISCOVERED'")
        ).scalar_one()
        statuses = conn.execute(text("SELECT status FROM backfill_runs")).scalars().all()
    engine.dispose()

    assert rows == result["published_rows"]
    assert statuses == ["COMPLETED"]


@pytest.mark.integration
@requires_db
def test_state_filter_narrows_results(snapshot: Path, db: None) -> None:
    unfiltered = BackfillService("2026-07", snapshot_dir=snapshot).count_rows()
    filtered = BackfillService(
        "2026-07", snapshot_dir=snapshot, filters=BackfillFilters(state="RJ")
    ).count_rows()

    assert 0 < filtered < unfiltered


@pytest.mark.integration
@requires_db
def test_cnae_filter(snapshot: Path, db: None) -> None:
    service = BackfillService(
        "2026-07", snapshot_dir=snapshot, filters=BackfillFilters(main_cnae="4711302")
    )
    assert service.count_rows() >= 1


@pytest.mark.integration
@requires_db
def test_backfill_resumes_from_cursor(snapshot: Path, db: None) -> None:
    """A restarted backfill must continue instead of republishing."""
    engine = create_engine(DB_URL or "")

    # First pass: stop after the first batch by limiting the iteration.
    service = BackfillService("2026-07", snapshot_dir=snapshot, batch_size=1)
    total = service.count_rows()
    assert total > 1

    original = BackfillService.iter_batches
    calls = {"n": 0}

    def one_batch_only(self, cursor):  # type: ignore[no-untyped-def]
        for batch in original(self, cursor):
            calls["n"] += 1
            yield batch
            if calls["n"] >= 1:
                raise KeyboardInterrupt

    BackfillService.iter_batches = one_batch_only  # type: ignore[method-assign]
    try:
        with pytest.raises(KeyboardInterrupt):
            service.run()
    finally:
        BackfillService.iter_batches = original  # type: ignore[method-assign]

    with engine.connect() as conn:
        after_first = conn.execute(text("SELECT count(*) FROM event_outbox")).scalar_one()
        status, cursor = conn.execute(text("SELECT status, cursor FROM backfill_runs")).one()

    assert after_first == 1
    assert status == "PAUSED"
    assert cursor["last_cnpj"] is not None

    # Second pass resumes and finishes the remaining rows.
    resumed = BackfillService("2026-07", snapshot_dir=snapshot, batch_size=10).run()

    with engine.connect() as conn:
        final = conn.execute(text("SELECT count(*) FROM event_outbox")).scalar_one()
        runs = conn.execute(text("SELECT count(*) FROM backfill_runs")).scalar_one()
    engine.dispose()

    assert final == total, "resume must publish each company exactly once"
    assert runs == 1, "resume must reuse the existing run"
    assert resumed["processed_rows"] == total


@pytest.mark.integration
@requires_db
def test_missing_snapshot_raises(tmp_path: Path, db: None) -> None:
    service = BackfillService("2099-01", snapshot_dir=tmp_path / "nope")
    with pytest.raises(FileNotFoundError):
        service.run()
