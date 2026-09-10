"""End-to-end test (spec section 39).

Fixtures -> download -> extract -> normalize -> Parquet -> diff -> outbox
-> NATS JetStream -> test consumer -> JSON Schema validation.

Requires:
    docker compose up -d postgres nats
    TEST_DATABASE_URL=... TEST_NATS_URL=... pytest tests/e2e
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, text

from cnpj_data_publisher.config import reset_settings
from cnpj_data_publisher.database.models import Base
from cnpj_data_publisher.events.schemas import validate_event
from cnpj_data_publisher.outbox.publisher import JetStreamPublisher, OutboxPublisher

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
    """Build both snapshot fixtures on disk."""
    build_snapshot_fixture(tmp_path / "source", "2026-06")
    build_snapshot_fixture(tmp_path / "source", "2026-07")
    return tmp_path / "source"


@pytest.fixture
def fake_portal(fixture_root: Path) -> httpx.Client:
    """Serves the fixture ZIPs as if they were the Receita Federal portal."""

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
        return httpx.Response(
            200, text='<a href="2026-06/">2026-06/</a><a href="2026-07/">2026-07/</a>'
        )

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


@pytest.fixture
def stack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Point every backend at the throwaway test resources."""
    subject_prefix = f"e2e.{uuid.uuid4().hex[:8]}.cnpj"
    monkeypatch.setenv("DATABASE_URL", DB_URL or "")
    monkeypatch.setenv("NATS_URL", NATS_URL or "")
    monkeypatch.setenv("NATS_STREAM", f"E2E_{uuid.uuid4().hex[:8].upper()}")
    monkeypatch.setenv("NATS_SUBJECT_PREFIX", subject_prefix)
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "data"))
    monkeypatch.setenv("RECEITA_BASE_URL", BASE_URL)
    monkeypatch.setenv("MIN_EXPECTED_TOTAL_ROWS", "1")
    # The fixture deliberately contains one malformed row out of a handful,
    # so the production 1% threshold cannot apply at this scale.
    monkeypatch.setenv("MAX_REJECTED_ROW_PERCENTAGE", "0.5")
    monkeypatch.setenv("INITIAL_SNAPSHOT_MODE", "STORE_ONLY")
    monkeypatch.setenv("OUTBOX_BATCH_SIZE", "100")
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

    yield subject_prefix

    engine = create_engine(DB_URL or "")
    with engine.begin() as conn:
        conn.execute(
            text("TRUNCATE event_outbox, ingest_runs, backfill_runs, source_snapshots CASCADE")
        )
    engine.dispose()
    session_module.dispose_engine()
    reset_settings()


def _run_ingest(snapshot: str, portal: httpx.Client, monkeypatch: pytest.MonkeyPatch):
    """Run the pipeline with discovery and download pinned to the fake portal."""
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


def _consume(subject_prefix: str, leaf: str, expected: int) -> list[dict]:
    async def scenario() -> list[dict]:
        consumer = JetStreamPublisher()
        await consumer.connect()
        try:
            assert consumer._js is not None
            sub = await consumer._js.pull_subscribe(
                f"{subject_prefix}.{leaf}", durable=f"c{uuid.uuid4().hex[:8]}"
            )
            msgs = await sub.fetch(expected, timeout=10)
            payloads = [json.loads(m.data) for m in msgs]
            for m in msgs:
                await m.ack()
            return payloads
        finally:
            await consumer.close()

    return asyncio.run(scenario())


# ---------------------------------------------------------------------
@requires_stack
def test_full_pipeline_two_snapshots(
    stack: str, fake_portal: httpx.Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The complete acceptance scenario from spec section 45."""
    subject_prefix = stack

    # --- first snapshot: STORE_ONLY -----------------------------------
    first = _run_ingest("2026-06", fake_portal, monkeypatch)
    assert first.status == "COMPLETED"
    assert first.statistics["store_only"] is True, "first run must not flood consumers"

    engine = create_engine(DB_URL or "")
    with engine.connect() as conn:
        discovered = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE event_type = 'COMPANY_DISCOVERED'")
        ).scalar_one()
        ready = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE event_type = 'CNPJ_SNAPSHOT_READY'")
        ).scalar_one()
    assert discovered == 0, "STORE_ONLY must suppress discovered events"
    assert ready == 1, "SNAPSHOT_READY is always published"

    # --- second snapshot: real diff -------------------------------------
    second = _run_ingest("2026-07", fake_portal, monkeypatch)
    assert second.status == "COMPLETED"

    stats = second.statistics
    assert stats["discovered"] == 1
    assert stats["updated"] == 1
    assert stats["reactivated"] == 1
    assert stats["inactivated"] == 1
    assert stats["unchanged"] >= 1

    # --- publish everything ------------------------------------------------
    publisher = OutboxPublisher()
    published = asyncio.run(publisher.run_once())
    assert published.failed == 0
    assert published.published > 0

    with engine.connect() as conn:
        remaining = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE status <> 'PUBLISHED'")
        ).scalar_one()
    engine.dispose()
    assert remaining == 0

    # --- consume and validate against JSON Schema ---------------------------
    for leaf, expected_cnpj in (
        ("discovered.v1", "55555555000190"),
        ("updated.v1", "11111111000190"),
        ("reactivated.v1", "33333333000190"),
        ("inactivated.v1", "44444444000190"),
    ):
        payloads = _consume(subject_prefix, leaf, 1)
        assert len(payloads) == 1, f"expected exactly one {leaf} event"

        event = payloads[0]
        assert validate_event(event) == [], f"{leaf} failed schema validation"
        cnpj = event["data"].get("cnpj")
        assert cnpj == expected_cnpj

    # An unchanged company must never appear in any published event.
    engine = create_engine(DB_URL or "")
    with engine.connect() as conn:
        leaked = conn.execute(
            text(
                "SELECT count(*) FROM event_outbox "
                "WHERE aggregate_id = '22222222000190' "
                "AND event_type LIKE 'COMPANY_%'"
            )
        ).scalar_one()
    engine.dispose()
    assert leaked == 0, "an unchanged company must not generate any event"


@requires_stack
def test_reingesting_same_snapshot_is_skipped(
    stack: str, fake_portal: httpx.Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert _run_ingest("2026-06", fake_portal, monkeypatch).status == "COMPLETED"
    second = _run_ingest("2026-06", fake_portal, monkeypatch)

    assert second.status == "SKIPPED"
    assert "already processed" in (second.skipped_reason or "")


@requires_stack
def test_publisher_restart_does_not_lose_events(
    stack: str, fake_portal: httpx.Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spec: restarting the publisher must never drop pending events."""
    _run_ingest("2026-06", fake_portal, monkeypatch)

    engine = create_engine(DB_URL or "")
    with engine.connect() as conn:
        before = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE status = 'PENDING'")
        ).scalar_one()

    # First publisher instance dies immediately after claiming.
    async def crash() -> None:
        publisher = OutboxPublisher()
        await publisher.publisher.connect()
        await publisher.publisher.ensure_stream()
        await publisher.publisher.close()  # simulate a crash before publishing

    asyncio.run(crash())

    # A fresh instance picks the work back up.
    stats = asyncio.run(OutboxPublisher().run_once())
    assert stats.published == before

    with engine.connect() as conn:
        remaining = conn.execute(
            text("SELECT count(*) FROM event_outbox WHERE status <> 'PUBLISHED'")
        ).scalar_one()
    engine.dispose()
    assert remaining == 0
