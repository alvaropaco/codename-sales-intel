"""Graph-mode worker: drains per-worker-type directive subjects.

An independent pod for `orchestrator` runs this worker too: it consumes
company requests + entity discoveries. Pods for `bbot`, `social`, etc. consume
their type's directive subject. All messages are processed through a fresh
`GraphDirector` (with its own DB session + repository) and ACKed only after the
durable graph state is committed.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol

from pydantic import ValidationError

from company_enrichment.config.settings import Settings
from company_enrichment.db.graph_repository import GraphRepository
from company_enrichment.events.contracts import EnrichmentRequestedV1
from company_enrichment.events.graph_contracts import (
    EntityDiscoveredV1,
    IngestCollectedV1,
    WorkerDirectiveRequestedV1,
    ingest_collected_subject,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.services.graph_director import GraphDirector
from company_enrichment.worker.nats_client import NATSClient

log = get_logger("graph_worker")

#: How often each worker pod reports NATS consumer backlog to Prometheus.
PENDING_REPORT_INTERVAL_SECONDS = 30


class DirectorFactory(Protocol):
    def __call__(self, repo: GraphRepository) -> GraphDirector:
        ...


class GraphModeWorker:
    """Event loop for one or more worker types using GraphDirector.

    Subscriptions per configured type:
      - orchestrator: company.requested + entity.discovered + its directive subject
      - others:        enrichment.worker.<type>.requested.v1
    """

    def __init__(
        self,
        settings: Settings,
        nats: NATSClient,
        director_factory: DirectorFactory,
        worker_types: list[str],
        session_factory,
        concurrency: int = 10,
    ) -> None:
        self._settings = settings
        self._nats = nats
        self._director_factory = director_factory
        self._worker_types = worker_types
        self._session_factory = session_factory
        self._concurrency = concurrency
        self._sem = asyncio.Semaphore(concurrency)
        self._active: set[asyncio.Task] = set()
        self._shutdown_event = asyncio.Event()
        self._subs: list[Any] = []
        self._consumers: list[str] = []
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    async def run(self) -> None:
        await self._nats.ensure_graph_stream()
        self._subs = await self._subscribe_all()
        self._ready = True
        log.info("graph_worker_started", types=self._worker_types, consumers=len(self._subs))
        pending_task = asyncio.create_task(self._report_pending_loop())
        try:
            while not self._shutdown_event.is_set():
                await self._drain_once()
        finally:
            pending_task.cancel()
            try:
                await pending_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            await self._drain()

    async def _subscribe_all(self) -> list[Any]:
        subs: list[Any] = []
        for wt in self._worker_types:
            if wt == "orchestrator":
                ack_wait = self._settings.worker_lease_seconds * 4 + 60
                consumers = ("enrichment-orchestrator", "enrichment-orchestrator-discovered")
                self._consumers.extend(consumers)
                subs.append(
                    await self._nats.pull_subscribe_filter(
                        consumer=consumers[0],
                        filter_subject=self._settings.graph_subject_requested,
                        ack_wait=ack_wait,
                    )
                )
                subs.append(
                    await self._nats.pull_subscribe_filter(
                        consumer=consumers[1],
                        filter_subject="enrichment.entity.discovered.v1",
                        ack_wait=ack_wait,
                    )
                )
            elif wt == "persister":
                consumer = "enrichment-persister"
                self._consumers.append(consumer)
                subs.append(
                    await self._nats.pull_subscribe_filter(
                        consumer=consumer,
                        filter_subject=ingest_collected_subject(),
                        ack_wait=self._settings.worker_lease_seconds * 4 + 60,
                    )
                )
            else:
                subject = f"enrichment.worker.{wt}.requested.v1"
                consumer = f"enrichment-{wt}"
                self._consumers.append(consumer)
                subs.append(
                    await self._nats.pull_subscribe_filter(
                        consumer=consumer,
                        filter_subject=subject,
                        ack_wait=self._settings.worker_lease_seconds * 4 + 60,
                    )
                )
        return subs

    async def _report_pending_loop(self) -> None:
        """Periodically report NATS pending counts for each managed consumer."""
        while not self._shutdown_event.is_set():
            for consumer in self._consumers:
                await self._nats.pending_consumer(consumer)
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(),
                    timeout=PENDING_REPORT_INTERVAL_SECONDS,
                )
            except TimeoutError:
                pass

    async def _drain_once(self) -> None:
        batch_tasks: list[asyncio.Task] = []
        for sub in self._subs:
            msgs = await self._nats.fetch_from(sub, batch=5, timeout=2)
            for msg in msgs:
                await self._sem.acquire()
                task = asyncio.create_task(self._handle(msg))
                self._active.add(task)
                task.add_done_callback(self._on_done)
                batch_tasks.append(task)
        if batch_tasks:
            await asyncio.gather(*batch_tasks, return_exceptions=True)

    async def _handle(self, msg) -> None:
        subject = None
        try:
            subject = msg.subject
            payload = json.loads(msg.data)
            async with self._session_factory() as s:
                repo = GraphRepository(s)
                director = self._director_factory(repo)
                if subject == self._settings.graph_subject_requested:
                    req = EnrichmentRequestedV1.model_validate(payload)
                    await director.on_company_requested(req)
                    await s.commit()
                elif subject == "enrichment.entity.discovered.v1":
                    ev = EntityDiscoveredV1.model_validate(payload)
                    await director.on_entity_discovered(ev)
                    await s.commit()
                elif subject == ingest_collected_subject():
                    ev = IngestCollectedV1.model_validate(payload)
                    await director.on_ingest_collected(ev)
                    await s.commit()
                else:
                    directive = WorkerDirectiveRequestedV1.model_validate(payload)
                    await director.on_directive_requested(directive)
                    await s.commit()
            await self._ack(msg)
        except asyncio.CancelledError:
            raise
        except (json.JSONDecodeError, ValidationError) as exc:
            log.warning("graph_invalid_message", subject=subject, error=str(exc)[:300])
            await self._term(msg)
        except Exception as exc:  # noqa: BLE001
            log.exception("graph_message_error", subject=subject, error=str(exc)[:500])
            await self._nak(msg)
        finally:
            self._sem.release()

    async def _ack(self, msg) -> None:
        try:
            await msg.ack()
        except Exception:  # noqa: BLE001
            pass

    async def _nak(self, msg) -> None:
        try:
            await msg.nak(delay=3)
        except Exception:  # noqa: BLE001
            pass

    async def _term(self, msg) -> None:
        try:
            await msg.term()
        except Exception:  # noqa: BLE001
            pass

    def _on_done(self, task: asyncio.Task) -> None:
        self._active.discard(task)

    async def _drain(self) -> None:
        grace = self._settings.shutdown_grace_seconds
        _, pending = await asyncio.wait(self._active, timeout=grace)
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._ready = False
        log.info("graph_worker_drained")

    async def stop(self) -> None:
        self._shutdown_event.set()
