"""Main worker: bounded-concurrency NATS drain loop with heartbeats and graceful shutdown."""
from __future__ import annotations

import asyncio

from company_enrichment.config.settings import Settings
from company_enrichment.metrics.metrics import (
    ENRICHMENT_ACTIVE_JOBS,
    ENRICHMENT_AVAILABLE_SLOTS,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.worker.job_runner import JobRunner
from company_enrichment.worker.nats_client import NATSClient
from company_enrichment.worker.outbox_publisher import OutboxPublisher

log = get_logger("worker")


class Worker:
    def __init__(
        self,
        settings: Settings,
        nats: NATSClient,
        runner: JobRunner,
        outbox: OutboxPublisher,
    ) -> None:
        self._settings = settings
        self._nats = nats
        self._runner = runner
        self._outbox = outbox
        self._sem = asyncio.Semaphore(settings.worker_concurrency)
        self._active: set[asyncio.Task] = set()
        self._shutdown_event = asyncio.Event()
        self._running = False
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    async def run(self) -> None:
        self._running = True
        await self._nats.subscribe()
        await self._outbox.start()
        self._ready = True
        log.info("worker_started", concurrency=self._settings.worker_concurrency)
        try:
            while not self._shutdown_event.is_set():
                ENRICHMENT_AVAILABLE_SLOTS.set(self._sem._value)  # noqa: SLF001
                try:
                    msgs = await self._nats.fetch(self._settings.nats_fetch_batch_size)
                except Exception as exc:  # noqa: BLE001
                    log.exception("fetch_error", error=str(exc))
                    await asyncio.sleep(1)
                    continue
                for msg in msgs:
                    await self._sem.acquire()
                    ENRICHMENT_ACTIVE_JOBS.inc()
                    task = asyncio.create_task(self._consume(msg))
                    self._active.add(task)
                    task.add_done_callback(self._on_done)
        finally:
            await self._drain()

    async def _consume(self, msg) -> None:
        try:
            await self._runner.handle_message(msg)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("unhandled_message_error", error=str(exc))
            try:
                await self._nats.nack(msg, delay_seconds=2)
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._sem.release()
            ENRICHMENT_ACTIVE_JOBS.dec()

    def _on_done(self, task: asyncio.Task) -> None:
        self._active.discard(task)
        try:
            task.result()  # surface exceptions
        except asyncio.CancelledError:
            pass

    async def _drain(self) -> None:
        """Finishing jobs within the shutdown grace period; leave incomplete unacked."""
        grace = self._settings.shutdown_grace_seconds
        log.info("draining", in_flight=len(self._active), grace=grace)
        done, pending = await asyncio.wait(self._active, timeout=grace)
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        await self._outbox.stop()
        self._running = False
        self._ready = False
        ENRICHMENT_AVAILABLE_SLOTS.set(0)
        log.info("drain_complete")

    async def stop(self) -> None:
        self._shutdown_event.set()
