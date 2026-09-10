"""Synchronous SQLAlchemy session management.

The spec pins ``postgresql+psycopg`` (psycopg3). The pipeline is batch-oriented
and DuckDB-bound, so a synchronous session keeps the code far simpler than
async while remaining fully compatible with ``FOR UPDATE SKIP LOCKED``.
"""

from __future__ import annotations

import contextlib
import os
import socket
from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from cnpj_data_publisher.config import get_settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None

# Deterministic advisory-lock key for "only one ingest at a time" (spec 35).
INGEST_LOCK_KEY = 0x0C4A_5150  # arbitrary but stable 32-bit constant


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=3600,
            future=True,
        )
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _session_factory


@contextlib.contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope. Commits on success, rolls back on error."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def owner_id() -> str:
    """Stable identifier for the current process, used for lock ownership."""
    return f"{socket.gethostname()}:{os.getpid()}"


@contextlib.contextmanager
def advisory_lock(session: Session, key: int = INGEST_LOCK_KEY) -> Iterator[bool]:
    """PostgreSQL session-level advisory lock (spec section 35).

    Yields True when the lock was acquired, False when another process holds it.
    """
    acquired = bool(session.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar())
    try:
        yield acquired
    finally:
        if acquired:
            session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})


def ping(session: Session) -> bool:
    """Readiness probe helper."""
    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
