"""Async SQLAlchemy engine/session factory."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from company_enrichment.config.settings import Settings


def build_engine(settings: Settings) -> AsyncEngine:
    url = settings.database_url or "postgresql+asyncpg://localhost/postgres"
    return create_async_engine(
        url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        echo=False,
    )


def build_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class SessionFactory:
    """Holds the engine and sessionmaker; started/stopped with the app lifetime."""

    def __init__(self, settings: Settings) -> None:
        self._engine: AsyncEngine | None = None
        self._maker: async_sessionmaker[AsyncSession] | None = None
        self._settings = settings

    async def start(self) -> None:
        self._engine = build_engine(self._settings)
        self._maker = build_sessionmaker(self._engine)

    async def stop(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
        self._engine = None
        self._maker = None

    def session(self) -> AsyncSession:
        if self._maker is None:
            raise RuntimeError("SessionFactory not started")
        return self._maker()

    async def session_ctx(self) -> AsyncIterator[AsyncSession]:
        async with self.session() as s:
            yield s
