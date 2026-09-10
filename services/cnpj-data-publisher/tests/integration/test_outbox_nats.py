"""Integration tests: outbox -> PostgreSQL -> NATS JetStream.

Requires the docker compose stack:
    docker compose up -d postgres nats
    TEST_DATABASE_URL=... TEST_NATS_URL=... pytest tests/integration
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from cnpj_data_publisher.config import get_settings, reset_settings
from cnpj_data_publisher.database.models import Base, EventOutbox, OutboxStatus
from cnpj_data_publisher.database.repositories import OutboxRepository
from cnpj_data_publisher.events.envelope import build_envelope
from cnpj_data_publisher.events.subjects import EventType
from cnpj_data_publisher.outbox.publisher import (
    JetStreamPublisher,
    OutboxPublisher,
    retry_delay,
)
from cnpj_data_publisher.outbox.service import envelope_to_row

pytestmark = [pytest.mark.integration]

DB_URL = os.environ.get("TEST_DATABASE_URL")
NATS_URL = os.environ.get("TEST_NATS_URL")

requires_db = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL is not set")
requires_nats = pytest.mark.skipif(not NATS_URL, reason="TEST_NATS_URL is not set")


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    if DB_URL:
        monkeypatch.setenv("DATABASE_URL", DB_URL)
    if NATS_URL:
        monkeypatch.setenv("NATS_URL", NATS_URL)
    monkeypatch.setenv("NATS_STREAM", f"TEST_CNPJ_{uuid.uuid4().hex[:8].upper()}")
    monkeypatch.setenv("NATS_SUBJECT_PREFIX", f"test.{uuid.uuid4().hex[:8]}.cnpj")
    monkeypatch.setenv("OUTBOX_BATCH_SIZE", "50")
    monkeypatch.setenv("OUTBOX_POLL_INTERVAL_MS", "50")
    reset_settings()

    import cnpj_data_publisher.database.session as session_module

    session_module.dispose_engine()
    yield
    session_module.dispose_engine()
    reset_settings()


@pytest.fixture
def db_session(env: None) -> Iterator[Session]:
    engine = create_engine(DB_URL)  # type: ignore[arg-type]
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    session.execute(text("TRUNCATE event_outbox"))
    session.commit()
    try:
        yield session
    finally:
        session.execute(text("TRUNCATE event_outbox"))
        session.commit()
        session.close()
        engine.dispose()


def _make_event(index: int = 0) -> dict:
    envelope = build_envelope(
        EventType.COMPANY_DISCOVERED,
        data={"cnpj": f"{index:014d}"},
        metadata={"snapshot_version": "2026-07"},
    )
    return envelope_to_row(envelope, f"{index:014d}")


# ---------------------------------------------------------------------
@requires_db
def test_claim_batch_marks_publishing(db_session: Session) -> None:
    db_session.execute(EventOutbox.__table__.insert(), [_make_event(i) for i in range(5)])
    db_session.commit()

    repo = OutboxRepository(db_session)
    claimed = repo.claim_batch(3)
    db_session.commit()

    assert len(claimed) == 3
    statuses = db_session.execute(
        text("SELECT status, count(*) FROM event_outbox GROUP BY status ORDER BY 1")
    ).all()
    assert dict(statuses) == {"PENDING": 2, "PUBLISHING": 3}


@requires_db
def test_skip_locked_prevents_double_claim(db_session: Session) -> None:
    """Two concurrent publishers must never claim the same row."""
    db_session.execute(EventOutbox.__table__.insert(), [_make_event(i) for i in range(10)])
    db_session.commit()

    engine = create_engine(DB_URL)  # type: ignore[arg-type]
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    first, second = factory(), factory()
    try:
        first.begin()
        second.begin()
        claimed_a = {e.id for e in OutboxRepository(first).claim_batch(10)}
        claimed_b = {e.id for e in OutboxRepository(second).claim_batch(10)}

        assert claimed_a
        assert not (claimed_a & claimed_b), "rows were claimed twice"
    finally:
        first.rollback()
        second.rollback()
        first.close()
        second.close()
        engine.dispose()


@requires_db
def test_mark_failed_applies_backoff(db_session: Session) -> None:
    row = _make_event(1)
    db_session.execute(EventOutbox.__table__.insert(), [row])
    db_session.commit()

    repo = OutboxRepository(db_session)
    repo.mark_failed(row["id"], "connection refused", retry_delay(0), 20)
    db_session.commit()

    stored = db_session.get(EventOutbox, row["id"])
    assert stored is not None
    assert stored.status == OutboxStatus.FAILED
    assert stored.attempts == 1
    assert "connection refused" in (stored.last_error or "")


# ---------------------------------------------------------------------
@requires_db
@requires_nats
def test_events_reach_jetstream(db_session: Session) -> None:
    """Full path: outbox row -> publisher -> JetStream -> consumer."""
    settings = get_settings()
    rows = [_make_event(i) for i in range(5)]
    db_session.execute(EventOutbox.__table__.insert(), rows)
    db_session.commit()

    async def scenario() -> list[dict]:
        publisher = OutboxPublisher()
        stats = await publisher.run_once()
        assert stats.published == 5

        # Consume everything back off the stream.
        consumer = JetStreamPublisher()
        await consumer.connect()
        try:
            assert consumer._js is not None
            sub = await consumer._js.pull_subscribe(
                f"{settings.nats_subject_prefix}.discovered.v1",
                durable=f"test{uuid.uuid4().hex[:8]}",
            )
            msgs = await sub.fetch(5, timeout=5)
            payloads = [json.loads(m.data) for m in msgs]
            for m in msgs:
                await m.ack()
            return payloads
        finally:
            await consumer.close()

    payloads = asyncio.run(scenario())

    assert len(payloads) == 5
    assert {p["event_type"] for p in payloads} == {"COMPANY_DISCOVERED"}

    statuses = db_session.execute(text("SELECT DISTINCT status FROM event_outbox")).scalars().all()
    assert statuses == ["PUBLISHED"]


@requires_db
@requires_nats
def test_nats_outage_keeps_events(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec: a NATS failure must never lose events."""
    rows = [_make_event(i) for i in range(3)]
    db_session.execute(EventOutbox.__table__.insert(), rows)
    db_session.commit()

    async def scenario() -> None:
        publisher = OutboxPublisher()
        await publisher.publisher.connect()
        await publisher.publisher.ensure_stream()

        async def boom(*_args, **_kwargs):
            raise ConnectionError("nats is down")

        monkeypatch.setattr(publisher.publisher, "publish", boom)
        try:
            stats = await publisher.publish_batch()
            assert stats.published == 0
            assert stats.failed == 3
        finally:
            await publisher.publisher.close()

    asyncio.run(scenario())

    remaining = db_session.execute(
        text("SELECT count(*) FROM event_outbox WHERE status <> 'PUBLISHED'")
    ).scalar_one()
    assert remaining == 3, "events must survive a NATS outage"


@requires_db
@requires_nats
def test_duplicate_msg_id_is_deduplicated(db_session: Session) -> None:
    """Publishing the same event_id twice must not duplicate it in the stream."""
    row = _make_event(42)
    db_session.execute(EventOutbox.__table__.insert(), [row])
    db_session.commit()

    async def scenario() -> tuple[str, str]:
        publisher = JetStreamPublisher()
        await publisher.connect()
        await publisher.ensure_stream()
        try:
            first = await publisher.publish(row["subject"], row["payload"], row["headers"])
            second = await publisher.publish(row["subject"], row["payload"], row["headers"])
            return first, second
        finally:
            await publisher.close()

    first, second = asyncio.run(scenario())
    assert first == second, "duplicate Nats-Msg-Id must map to the same sequence"
