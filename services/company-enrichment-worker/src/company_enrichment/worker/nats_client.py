"""NATS JetStream client wrapper for the enrichment worker."""
from __future__ import annotations

import nats

from company_enrichment.config.settings import Settings
from company_enrichment.metrics.metrics import NATS_PENDING
from company_enrichment.observability.otel import get_logger

log = get_logger("nats")


class NATSClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._nc: nats.NATS | None = None
        self._js: nats.js.JetStreamContext | None = None
        self._sub: nats.aio.subscription.PullSubscription | None = None
        self._started = False

    @property
    def js(self) -> nats.js.JetStreamContext:
        if self._js is None:
            raise RuntimeError("NATS not connected")
        return self._js

    async def connect(self, *, ensure_consumer: bool = True) -> None:
        kwargs: dict = {}
        if self._settings.nats_creds:
            kwargs["user_credentials"] = self._settings.nats_creds
        self._nc = await nats.connect(
            self._settings.nats_url,
            max_reconnect_attempts=-1,
            reconnect_time_wait=2,
            **kwargs,
        )
        self._js = self._nc.jetstream()
        await self._ensure_stream()
        if ensure_consumer:
            await self._ensure_consumer()
        self._started = True
        log.info("nats_connected", url=self._settings.nats_url)

    async def ensure_graph_stream(self) -> None:
        """Widen the stream to cover all enrichment.* subjects (worker directives)."""
        await self._ensure_stream(subjects=["enrichment.>"])

    async def _ensure_stream(self, subjects: list[str] | None = None) -> None:
        if subjects is None:
            subjects = [s.strip() for s in self._settings.stream_subjects.split(",") if s.strip()]
        config = {
            "name": self._settings.nats_stream,
            "subjects": subjects,
            "max_age": 7 * 24 * 3600,  # 7 days retention
            "storage": "file",
            "num_replicas": 1,
        }
        try:
            await self._js.stream_info(self._settings.nats_stream)
            exists = True
        except Exception:  # noqa: BLE001
            exists = False
        if not exists:
            await self._js.add_stream(**config)
        else:
            # Ensure subjects match config (output subjects must be capturable too).
            await self._js.update_stream(**config)
        log.info("stream_ensured", stream=self._settings.nats_stream)

    async def _ensure_consumer(self) -> None:
        try:
            await self._js.consumer_info(
                self._settings.nats_stream, self._settings.nats_consumer_name
            )
            exists = True
        except Exception:  # noqa: BLE001
            exists = False
        if not exists:
            await self._js.add_consumer(
                stream=self._settings.nats_stream,
                durable_name=self._settings.nats_consumer_name,
                ack_policy="explicit",
                max_ack_pending=self._settings.nats_max_ack_pending,
                deliver_policy="all",
                ack_wait=120,
                filter_subject=self._settings.subject_requested,
            )
        log.info("consumer_ensured", consumer=self._settings.nats_consumer_name)

    async def subscribe(self) -> None:
        self._sub = await self._js.pull_subscribe(
            self._settings.subject_requested,
            durable=self._settings.nats_consumer_name,
            stream=self._settings.nats_stream,
        )

    async def ensure_consumer_filter(
        self, *, consumer: str, filter_subject: str, ack_wait: int = 120
    ) -> None:
        """Ensure a durable pull consumer filtering on an arbitrary subject."""
        try:
            await self._js.consumer_info(self._settings.nats_stream, consumer)
            return
        except Exception:  # noqa: BLE001
            pass
        await self._js.add_consumer(
            stream=self._settings.nats_stream,
            durable_name=consumer,
            ack_policy="explicit",
            max_ack_pending=self._settings.nats_max_ack_pending,
            deliver_policy="all",
            ack_wait=ack_wait,
            filter_subject=filter_subject,
        )
        log.info("graph_consumer_ensured", consumer=consumer, subject=filter_subject)

    async def pull_subscribe_filter(
        self, *, consumer: str, filter_subject: str, ack_wait: int = 120
    ):
        """Create (or reuse) and return a pull subscription for a filtered durable consumer."""
        await self.ensure_consumer_filter(
            consumer=consumer, filter_subject=filter_subject, ack_wait=ack_wait
        )
        return await self._js.pull_subscribe(
            filter_subject,
            durable=consumer,
            stream=self._settings.nats_stream,
        )

    async def fetch_from(self, sub, batch: int, timeout: float = 5.0) -> list:
        try:
            msgs = await sub.fetch(batch, timeout=timeout)
            return list(msgs)
        except (TimeoutError, nats.js.errors.FetchTimeoutError):
            return []

    async def fetch(self, batch: int) -> list:
        if self._sub is None:
            raise RuntimeError("not subscribed")
        try:
            msgs = await self._sub.fetch(batch, timeout=5)
            return list(msgs)
        except TimeoutError:
            return []
        except nats.js.errors.FetchTimeoutError:
            return []

    async def pending(self) -> tuple[int | None, int | None]:
        """Return (num_pending, num_ack_pending) for the consumer."""
        try:
            cinfo = await self._js.consumer_info(
                self._settings.nats_stream, self._settings.nats_consumer_name
            )
            NATS_PENDING.labels(consumer=self._settings.nats_consumer_name).set(
                cinfo.num_pending
            )
            return cinfo.num_pending, cinfo.num_ack_pending
        except Exception:  # noqa: BLE001
            return None, None

    async def pending_consumer(self, consumer: str) -> int | None:
        """Report and return ``num_pending`` for an arbitrary durable consumer."""
        try:
            cinfo = await self._js.consumer_info(self._settings.nats_stream, consumer)
            NATS_PENDING.labels(consumer=consumer).set(cinfo.num_pending)
            return cinfo.num_pending
        except Exception:  # noqa: BLE001
            return None

    async def publish(self, subject: str, payload: bytes, headers: dict | None = None) -> None:
        await self._js.publish(subject, payload, headers=headers)

    async def ack(self, msg) -> None:
        await msg.ack()

    async def nack(self, msg, delay_seconds: int = 1) -> None:
        try:
            await msg.nak(delay=delay_seconds)
        except Exception:  # noqa: BLE001
            await msg.nak() if hasattr(msg, "nak") else None

    async def term(self, msg) -> None:
        await msg.term()

    async def close(self) -> None:
        self._started = False
        if self._nc is not None:
            await self._nc.close()
        self._nc = None
        self._js = None
        self._sub = None

    @property
    def started(self) -> bool:
        return self._started
