"""Outbox publisher: drains event_outbox into NATS JetStream (spec sections 19-20).

Delivery guarantee is at-least-once. ``Nats-Msg-Id`` plus the stream's
``duplicate_window`` collapse retries; consumers must still be idempotent.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import signal
import time
import uuid
from dataclasses import dataclass
from typing import Any

import nats
from nats.aio.client import Client as NatsClient
from nats.js import JetStreamContext
from nats.js.api import DiscardPolicy, RetentionPolicy, StorageType, StreamConfig
from nats.js.errors import NotFoundError

from cnpj_data_publisher import metrics
from cnpj_data_publisher.config import Settings, get_settings
from cnpj_data_publisher.database.repositories import OutboxRepository
from cnpj_data_publisher.database.session import session_scope
from cnpj_data_publisher.events.subjects import stream_subject_filter
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class PublishStats:
    published: int = 0
    failed: int = 0

    def __add__(self, other: PublishStats) -> PublishStats:
        return PublishStats(self.published + other.published, self.failed + other.failed)


def retry_delay(attempts: int, settings: Settings | None = None) -> int:
    """Exponential backoff bounded by OUTBOX_RETRY_MAX_SECONDS."""
    cfg = settings or get_settings()
    delay = cfg.outbox_retry_base_seconds * (2 ** max(0, attempts))
    return int(min(delay, cfg.outbox_retry_max_seconds))


class JetStreamPublisher:
    """Thin wrapper around nats-py handling connection and stream setup."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._nc: NatsClient | None = None
        self._js: JetStreamContext | None = None

    async def connect(self) -> None:
        options: dict[str, Any] = {
            "servers": [self.settings.nats_url],
            "connect_timeout": self.settings.nats_connect_timeout_seconds,
            "max_reconnect_attempts": -1,  # reconnect forever
            "reconnect_time_wait": 2,
            "name": self.settings.service_name,
        }
        if self.settings.nats_creds_file:
            options["user_credentials"] = self.settings.nats_creds_file

        self._nc = await nats.connect(**options)
        self._js = self._nc.jetstream()
        logger.info("nats_connected", url=self.settings.nats_url)

    async def ensure_stream(self) -> None:
        """Create the stream if it does not exist yet (spec section 20.1)."""
        if self._js is None:
            raise RuntimeError("connect() must be called first")

        config = StreamConfig(
            name=self.settings.nats_stream,
            subjects=[stream_subject_filter()],
            storage=StorageType.FILE,
            retention=RetentionPolicy.LIMITS,
            discard=DiscardPolicy.OLD,
            duplicate_window=self.settings.nats_stream_duplicate_window_hours * 3600,
            max_age=self.settings.nats_stream_max_age_days * 24 * 3600,
            num_replicas=self.settings.nats_stream_replicas,
        )

        try:
            await self._js.stream_info(self.settings.nats_stream)
            await self._js.update_stream(config)
            logger.info("nats_stream_updated", stream=self.settings.nats_stream)
        except NotFoundError:
            await self._js.add_stream(config)
            logger.info("nats_stream_created", stream=self.settings.nats_stream)

    async def publish(self, subject: str, payload: dict[str, Any], headers: dict[str, str]) -> str:
        """Publish and wait for the PubAck. Returns ``stream:sequence``."""
        if self._js is None:
            raise RuntimeError("connect() must be called first")

        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        started = time.perf_counter()
        ack = await self._js.publish(subject, body, headers=headers)
        metrics.nats_publish_duration_seconds.observe(time.perf_counter() - started)
        return f"{ack.stream}:{ack.seq}"

    async def is_healthy(self) -> bool:
        if self._nc is None or not self._nc.is_connected or self._js is None:
            return False
        try:
            await self._js.stream_info(self.settings.nats_stream)
        except Exception:  # noqa: BLE001 - readiness must never raise
            return False
        return True

    async def close(self) -> None:
        if self._nc is not None:
            await self._nc.drain()
            self._nc = None
            self._js = None


class OutboxPublisher:
    """Continuously claims pending events and publishes them."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.publisher = JetStreamPublisher(self.settings)
        self._stop = asyncio.Event()

    def request_stop(self) -> None:
        self._stop.set()

    # -- one batch --------------------------------------------------------
    async def publish_batch(self) -> PublishStats:
        stats = PublishStats()

        with session_scope() as session:
            repo = OutboxRepository(session)
            events = repo.claim_batch(self.settings.outbox_batch_size)
            if not events:
                metrics.outbox_pending_total.set(repo.count_pending())
                return stats

            semaphore = asyncio.Semaphore(self.settings.outbox_concurrency)
            published_ids: list[uuid.UUID] = []
            failures: list[tuple[uuid.UUID, str, int, str]] = []

            async def send(event: Any) -> None:
                async with semaphore:
                    try:
                        await self.publisher.publish(
                            event.subject, event.payload, event.headers or {}
                        )
                        published_ids.append(event.id)
                        metrics.outbox_published_total.labels(event_type=event.event_type).inc()
                    except Exception as exc:  # noqa: BLE001 - recorded per event
                        failures.append((event.id, str(exc), event.attempts, event.event_type))
                        metrics.outbox_failed_total.labels(event_type=event.event_type).inc()

            await asyncio.gather(*(send(event) for event in events))

            repo.mark_published(published_ids)
            for event_id, error, attempts, _event_type in failures:
                repo.mark_failed(
                    event_id,
                    error,
                    retry_delay(attempts, self.settings),
                    self.settings.outbox_max_attempts,
                )

            stats.published = len(published_ids)
            stats.failed = len(failures)

        if stats.failed:
            logger.warning("outbox_batch_partial", published=stats.published, failed=stats.failed)
        elif stats.published:
            logger.info("outbox_batch_published", published=stats.published)

        return stats

    # -- loop --------------------------------------------------------------
    async def run_forever(self) -> None:
        await self.publisher.connect()
        await self.publisher.ensure_stream()

        interval = self.settings.outbox_poll_interval_ms / 1000
        logger.info("outbox_publisher_started", batch_size=self.settings.outbox_batch_size)

        try:
            while not self._stop.is_set():
                try:
                    stats = await self.publish_batch()
                except Exception as exc:  # noqa: BLE001 - keep the loop alive
                    logger.error("outbox_batch_failed", error=str(exc))
                    stats = PublishStats()

                # Back off only when there was nothing to do.
                if stats.published == 0:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(self._stop.wait(), timeout=interval)
        finally:
            await self.publisher.close()
            logger.info("outbox_publisher_stopped")

    async def run_once(self) -> PublishStats:
        """Drain the outbox once, then return. Used by tests and one-shot jobs."""
        await self.publisher.connect()
        await self.publisher.ensure_stream()
        total = PublishStats()
        try:
            while True:
                stats = await self.publish_batch()
                total = total + stats
                if stats.published == 0:
                    return total
        finally:
            await self.publisher.close()


def install_signal_handlers(publisher: OutboxPublisher) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        # Windows event loops do not implement add_signal_handler.
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, publisher.request_stop)
