"""Transactional outbox publisher: publishes committed outbox events to NATS."""
from __future__ import annotations

import asyncio
import json
from collections.abc import Callable

from company_enrichment.observability.otel import get_logger
from company_enrichment.worker.nats_client import NATSClient

log = get_logger("outbox")


class OutboxPublisher:
    """Periodically drains unprocessed outbox rows and publishes to NATS JetStream.

    Publishing happens only after the DB transaction commits (see repository).
    If publishing fails, the row stays unprocessed and is retried.
    """

    def __init__(
        self,
        nats: NATSClient,
        list_fn: Callable,
        mark_fn: Callable,
        poll_interval_seconds: float = 5.0,
    ) -> None:
        self._nats = nats
        self._list = list_fn
        self._mark = mark_fn
        self._interval = poll_interval_seconds
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while True:
            try:
                await self.publish_pending()
            except Exception as exc:  # noqa: BLE001
                log.exception("outbox_poll_failed", error=str(exc))
            await asyncio.sleep(self._interval)

    async def publish_pending(self) -> int:
        events = await self._list(limit=100)
        published = 0
        for ev in events:
            try:
                payload = json.dumps(ev.payload, default=str).encode("utf-8")
                headers = {k: str(v) for k, v in (ev.headers or {}).items()}
                await self._nats.publish(ev.subject, payload, headers=headers or None)
                await self._mark(ev.id)
                published += 1
            except Exception as exc:  # noqa: BLE001
                log.warning("outbox_publish_failed", event_id=str(ev.id), error=str(exc))
        if published:
            log.info("outbox_published", count=published)
        return published
