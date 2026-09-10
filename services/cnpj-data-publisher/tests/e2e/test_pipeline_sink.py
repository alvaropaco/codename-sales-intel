"""End-to-end test proving the pipeline populates the analytical sink.

Runs the full IngestPipeline against fixture data with SINK=POSTGRES and
asserts that the queryable ``companies`` table is created and populated, and
that the sink stats surface on the ingest result.

Requires Postgres (pgvector) + NATS:
    TEST_DATABASE_URL=... TEST_NATS_URL=... pytest tests/e2e/test_pipeline_sink.py
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, text

from cnpj_data_publisher.config import reset_settings
from cnpj_data_publisher.database.models import Base

from tests.fixtures.builder import build_snapshot_fixture

pytestmark = [pytest.mark.e2e]

DB_URL = os.environ.get("TEST_DATABASE_URL")
NATS_URL = os.environ.get("TEST_NATS_URL")

requires_stack = pytest.mark.skipif(
    not (DB_URL and NATS_URL),
    reason="TEST_DATABASE_URL and TEST_NATS_URL are required",
)

BASE_URL = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj"


def _listing(files: list[str]) -> str:
    links = "".join(f'<a href="{name}">{name}</a>' for name in files)
    return f"<html><body>{links}</body></html>"


@pytest.fixture
def fixture_root(tmp_path: Path) -> Path:
    build_snapshot_fixture(tmp_path / "source", "2026-06")
    return tmp_path / "source"


@pytest.fixture
def fake_portal(fixture_root: Path) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith(".zip"):
            version, name = path.strip("/").split("/")[-2:]
            blob = (fixture_root / version / name).read_bytes()
            if request.method == "HEAD":
                return httpx.Response(200, headers={"content-length": str(len(blob))})
            return httpx.Response(200, content=blob)
        version = path.strip("/").split("/")[-1]
        directory = fixture_root / version
        if directory.is_dir():
            return httpx.Response(
                200, text=_listing(sorted(p.name for p in directory.glob("*.zip")))
            )
        return httpx.Response(200, text='<a href="2026-06/">2026-06/</a>')

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


@pytest.fixture
def sink_stack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    table = f"companies_e2e_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("DATABASE_URL", DB_URL or "")
    monkeypatch.setenv("NATS_URL", NATS_URL or "")
    monkeypatch.setenv("NATS_STREAM", f"E2E_{uuid.uuid4().hex[:8].upper()}")
    monkeypatch.setenv("NATS_SUBJECT_PREFIX", f"e2e.{uuid.uuid4().hex[:8]}.cnpj")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "data"))
    monkeypatch.setenv("RECEITA_BASE_URL", BASE_URL)
    monkeypatch.setenv("MIN_EXPECTED_TOTAL_ROWS", "1")
    monkeypatch.setenv("MAX_REJECTED_ROW_PERCENTAGE", "0.5")
    monkeypatch.setenv("INITIAL_SNAPSHOT_MODE", "STORE_ONLY")
    # The sink under test: reuse the same DB, isolated table.
    monkeypatch.setenv("SINK", "POSTGRES")
    monkeypatch.setenv("SINK_TABLE", table)
    reset_settings()

    import cnpj_data_publisher.database.session as session_module

    session_module.dispose_engine()
    engine = create_engine(DB_URL or "")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            text("TRUNCATE event_outbox, ingest_runs, backfill_runs, source_snapshots CASCADE")
        )
    engine.dispose()

    yield table

    engine = create_engine(DB_URL or "")
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        conn.execute(
            text("TRUNCATE event_outbox, ingest_runs, backfill_runs, source_snapshots CASCADE")
        )
    engine.dispose()
    session_module.dispose_engine()
    reset_settings()


def _run_ingest(snapshot: str, portal: httpx.Client, monkeypatch: pytest.MonkeyPatch):
    from cnpj_data_publisher import pipeline as pipeline_module

    original_discovery = pipeline_module.SnapshotDiscovery
    original_downloader = pipeline_module.Downloader
    monkeypatch.setattr(
        pipeline_module,
        "SnapshotDiscovery",
        lambda *a, **kw: original_discovery(*a, **{**kw, "client": portal}),
    )
    monkeypatch.setattr(
        pipeline_module,
        "Downloader",
        lambda *a, **kw: original_downloader(*a, **{**kw, "client": portal}),
    )
    return pipeline_module.IngestPipeline(requested_snapshot=snapshot).run()


@requires_stack
def test_pipeline_populates_sink(
    sink_stack: str, fake_portal: httpx.Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    table = sink_stack
    result = _run_ingest("2026-06", fake_portal, monkeypatch)

    assert result.status == "COMPLETED"
    # The pipeline must report how many rows landed in the analytical table.
    assert result.statistics.get("sink_rows_loaded", 0) >= 1
    assert "sink_error" not in result.statistics

    engine = create_engine(DB_URL or "")
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
        assert rows == result.statistics["sink_rows_loaded"]
        # search_text is populated; embedding column exists and is NULL pre-embed.
        sample = conn.execute(
            text(
                f"SELECT search_text, embedding FROM {table} WHERE search_text IS NOT NULL LIMIT 1"
            )
        ).first()
        assert sample is not None
        assert sample[0]  # non-empty search_text
        assert sample[1] is None
        # only active headquarters landed (INCLUDE_BRANCHES defaults false)
        actives = conn.execute(text(f"SELECT bool_and(is_active) FROM {table}")).scalar_one()
        assert actives is True
    engine.dispose()
