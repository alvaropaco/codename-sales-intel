"""Application assembly: wires up all components and runs the worker."""

from __future__ import annotations

import asyncio
import signal
import socket
import uuid

from company_enrichment.ai.llm import AIGatewayClient
from company_enrichment.config.settings import Settings
from company_enrichment.db.graph_repository import GraphRepository
from company_enrichment.db.repository import EnrichmentRepository
from company_enrichment.db.session import SessionFactory
from company_enrichment.observability.otel import configure_logging, get_logger, setup_tracing
from company_enrichment.providers.bbot import BbotProvider
from company_enrichment.providers.circuit_breaker import CircuitBreaker
from company_enrichment.providers.dns import DNSProvider
from company_enrichment.providers.firmographics import FirmographicsProvider, QsaProvider
from company_enrichment.providers.flaresolverr import FlareSolverrProvider
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.obscura import ObscuraProvider
from company_enrichment.providers.rdap import RDAPProvider
from company_enrichment.providers.searxng import SearXNGProvider
from company_enrichment.providers.spiderfoot import SpiderFootProvider
from company_enrichment.services.crawler import CrawlerService
from company_enrichment.services.domain_discovery import DomainDiscoveryService
from company_enrichment.services.domain_validation import DomainValidationService
from company_enrichment.services.graph_director import GraphDirector
from company_enrichment.services.pipeline import EnrichmentPipeline, PipelineContext
from company_enrichment.services.tech_detection import TechDetectionService
from company_enrichment.worker.graph_worker import GraphModeWorker
from company_enrichment.worker.http_server import HealthServer
from company_enrichment.worker.job_runner import JobRunner
from company_enrichment.worker.nats_client import NATSClient
from company_enrichment.worker.outbox_publisher import OutboxPublisher
from company_enrichment.worker.worker import Worker
from company_enrichment.workers.capability import CapabilityContext
from company_enrichment.workers.registry import resolve_worker_types

log = get_logger("app")


class App:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._worker_id = settings.worker_id or f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        self._worker_types = resolve_worker_types(settings.worker_types)
        configure_logging(settings.log_level)
        setup_tracing(settings.otel_exporter_otlp_endpoint, settings.otel_service_name)

        self._sessions = SessionFactory(settings)
        self._nats = NATSClient(settings)

        # Providers (all reuse existing infra).
        self._flaresolverr = FlareSolverrProvider(
            settings.flaresolverr_url,
            max_concurrency=settings.flaresolverr_max_concurrency,
            timeout_seconds=settings.flaresolverr_timeout_seconds,
            circuit=CircuitBreaker("flaresolverr"),
        )
        self._obscura = ObscuraProvider(
            binary=settings.obscura_bin,
            enabled=settings.obscura_enabled,
            timeout_seconds=settings.obscura_timeout_seconds,
            max_concurrency=settings.obscura_max_concurrency,
            dump=settings.obscura_dump,
            stealth=settings.obscura_stealth,
            circuit=CircuitBreaker("obscura"),
        )
        self._web = WebFetchProvider(
            self._flaresolverr,
            obscura=self._obscura,
            default_timeout_seconds=settings.crawler_timeout_seconds,
            max_response_bytes=settings.crawler_max_response_bytes,
        )
        self._dns = DNSProvider(circuit=CircuitBreaker("dns"))
        self._rdap = RDAPProvider(circuit=CircuitBreaker("rdap"))
        self._searxng = SearXNGProvider(settings.searxng_url, circuit=CircuitBreaker("searxng"))
        self._firmographics = FirmographicsProvider(
            settings.cnpj_database_url,
            timeout_seconds=settings.cnpj_query_timeout_seconds,
        )
        self._qsa = QsaProvider(
            settings.cnpj_database_url,
            table=settings.cnpj_qsa_table,
            timeout_seconds=settings.cnpj_query_timeout_seconds,
        )
        self._llm = AIGatewayClient(
            settings.ai_gateway_url,
            settings.ai_gateway_api_key,
            settings.model_chain,
            circuit=CircuitBreaker("ai_gateway"),
        )
        self._bbot = BbotProvider(
            binary=settings.bbot_bin,
            timeout_seconds=settings.bbot_timeout_seconds,
            max_events=settings.bbot_max_events,
            circuit=CircuitBreaker("bbot"),
        )
        self._spiderfoot = SpiderFootProvider(
            enabled=settings.spiderfoot_enabled,
            binary=settings.spiderfoot_bin,
            timeout_seconds=settings.spiderfoot_timeout_seconds,
            modules={m.strip() for m in settings.spiderfoot_modules.split(",") if m.strip()}
            or None,
            circuit=CircuitBreaker("spiderfoot"),
        )

        self._pipeline = EnrichmentPipeline(
            PipelineContext(
                dns=self._dns,
                rdap=self._rdap,
                web=self._web,
                searxng=self._searxng,
                llm=self._llm,
                crawler_max_pages=settings.crawler_max_pages,
                crawler_max_depth=settings.crawler_max_depth,
                llm_max_input_chars=settings.llm_max_input_chars,
            ),
            mock_mode=settings.enrichment_mock_mode,
        )

        self._runner: JobRunner | None = None
        self._worker: Worker | None = None
        self._graph_worker: GraphModeWorker | None = None
        self._outbox: OutboxPublisher | None = None
        self._health: HealthServer | None = None
        self._capability_ctx: CapabilityContext | None = None

    def _build_capability_ctx(self) -> CapabilityContext:
        return CapabilityContext(
            bbot=self._bbot,
            spiderfoot=self._spiderfoot,
            web=self._web,
            searxng=self._searxng,
            dns=self._dns,
            rdap=self._rdap,
            crawler=CrawlerService(
                self._web,
                max_pages=self._settings.crawler_max_pages,
                max_depth=self._settings.crawler_max_depth,
                max_response_bytes=self._settings.crawler_max_response_bytes,
            ),
            firmographics=self._firmographics,
            qsa=self._qsa,
            tech_detection=TechDetectionService(),
            domain_discovery=DomainDiscoveryService(self._searxng, self._rdap),
            domain_validation=DomainValidationService(self._dns, self._web, self._rdap),
        )

    @property
    def is_graph_mode(self) -> bool:
        """Graph mode when the configured worker types are not the legacy core alias."""
        # core runs the classic pipeline; anything else uses the graph architecture.
        return self._settings.worker_types.strip().lower() != "core"

    async def start(self) -> None:
        await self._sessions.start()
        await self._nats.connect(ensure_consumer=not self.is_graph_mode)

        if self.is_graph_mode:
            await self._nats.ensure_graph_stream()
            self._capability_ctx = self._build_capability_ctx()

            async def publish(subject: str, payload: dict) -> None:
                import json as _json

                await self._nats.publish(subject, _json.dumps(payload, default=str).encode())

            def director_factory(repo: GraphRepository) -> GraphDirector:
                return GraphDirector(
                    graph_repo=repo,
                    publish_fn=publish,
                    ctx=self._capability_ctx,
                    max_depth=self._settings.graph_max_depth,
                    max_directives=self._settings.graph_max_directives,
                    max_facts=self._settings.graph_max_facts,
                    worker_id=self._worker_id,
                    lease_seconds=self._settings.graph_lease_seconds,
                    subject_completed=self._settings.graph_subject_completed,
                    subject_partial=self._settings.graph_subject_partial,
                    directive_hard_timeout_seconds=self._settings.directive_hard_timeout_seconds,
                )

            self._graph_worker = GraphModeWorker(
                self._settings,
                self._nats,
                director_factory=director_factory,
                worker_types=[wt.value for wt in self._worker_types],
                session_factory=self._sessions.session,
                concurrency=self._settings.worker_concurrency,
            )
        else:

            async def repo_factory() -> EnrichmentRepository:
                return EnrichmentRepository(self._sessions.session())

            self._outbox = OutboxPublisher(
                self._nats,
                list_fn=lambda limit: self._with_session(
                    lambda r: r.list_unpublished_outbox(limit)
                ),
                mark_fn=lambda event_id: self._with_session(
                    lambda r: r.mark_outbox_published(event_id)
                ),
            )
            self._runner = JobRunner(
                self._settings,
                await repo_factory(),
                self._nats,
                self._pipeline,
                firmographics_provider=self._firmographics,
            )

        self._health = HealthServer("0.0.0.0", self._settings.http_port, ready_fn=self._ready)
        await self._health.start()
        log.info(
            "components_started",
            worker_id=self._worker_id,
            worker_types=[wt.value for wt in self._worker_types],
            graph_mode=self.is_graph_mode,
        )

    def _ready(self) -> bool:
        if self.is_graph_mode:
            return bool(self._graph_worker and self._graph_worker.ready)
        return bool(self._worker and self._worker.ready)

    async def _with_session(self, fn):
        async with self._sessions.session() as s:
            r = EnrichmentRepository(s)
            return await fn(r)

    async def run(self) -> None:
        await self.start()
        loop = asyncio.get_running_loop()
        stop = asyncio.Event()

        def _sig(*_a) -> None:
            loop.call_soon_threadsafe(stop.set)

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _sig)
            except NotImplementedError:  # pragma: no cover
                pass

        if self.is_graph_mode and self._graph_worker is not None:
            worker_task = asyncio.create_task(self._graph_worker.run())
            try:
                await stop.wait()
            finally:
                log.info("shutdown_requested")
                await self._graph_worker.stop()
                await worker_task
                await self._shutdown()
            return

        await self._nats.subscribe()
        self._worker = Worker(self._settings, self._nats, self._runner, self._outbox)  # type: ignore[arg-type]
        worker_task = asyncio.create_task(self._worker.run())
        try:
            await stop.wait()
        finally:
            log.info("shutdown_requested")
            await self._worker.stop()
            await worker_task
            await self._shutdown()

    async def _shutdown(self) -> None:
        if self._health:
            await self._health.stop()
        await self._nats.close()
        for p in (
            self._llm,
            self._searxng,
            self._rdap,
            self._web,
            self._flaresolverr,
            self._firmographics,
            self._qsa,
            self._bbot,
            self._spiderfoot,
        ):
            try:
                await p.close()
            except Exception:  # noqa: BLE001
                pass
        await self._sessions.stop()
        log.info("shutdown_complete")


def main() -> None:
    settings = Settings()
    asyncio.run(App(settings).run())


if __name__ == "__main__":
    main()
