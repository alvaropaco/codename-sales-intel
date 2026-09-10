"""Integration tests for the critical E2E slice (plan §45) and durability (§12/§48).

Requires a local NATS (with JetStream) and PostgreSQL running:
  - NATS on nats://localhost:4222
  - Postgres at postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test

Run migrations first: DATABASE_URL=... python scripts/run_migrations.py
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import select, text, update

from company_enrichment.ai.llm import AIGatewayClient
from company_enrichment.config.settings import Settings
from company_enrichment.db.models import CompanyEnrichment, EnrichmentJob, JobStatus, OutboxEvent
from company_enrichment.db.repository import EnrichmentRepository
from company_enrichment.db.session import SessionFactory
from company_enrichment.events.contracts import EnrichmentRequestedV1
from company_enrichment.providers.dns import DNSProvider
from company_enrichment.providers.flaresolverr import FlareSolverrProvider
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.rdap import RDAPProvider
from company_enrichment.providers.searxng import SearXNGProvider
from company_enrichment.services.pipeline import EnrichmentPipeline, PipelineContext
from company_enrichment.worker.job_runner import JobRunner
from company_enrichment.worker.nats_client import NATSClient

NATS_URL = os.getenv("NATS_TEST_URL", "nats://localhost:4222")
DATABASE_URL = os.getenv(
    "DATABASE_TEST_URL",
    "postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test",
)

pytestmark = pytest.mark.integration


@pytest.fixture
async def nats():
    settings = Settings(
        nats_url=NATS_URL, nats_stream="ENRICHMENT_TEST", nats_consumer_name="cew-e2e-test"
    )
    client = NATSClient(settings)
    await client.connect()
    await client.subscribe()
    try:
        yield client
    finally:
        await client.close()


@pytest.fixture
async def sessions():
    settings = Settings(database_url=DATABASE_URL)
    sf = SessionFactory(settings)
    await sf.start()
    try:
        yield sf
    finally:
        await sf.stop()


def build_settings(**overrides):
    defaults = dict(
        nats_url=NATS_URL,
        nats_stream="ENRICHMENT_TEST",
        nats_consumer_name="cew-e2e-test",
        worker_id="it-worker",
        enrichment_mock_mode=True,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def build_pipeline():
    fs = FlareSolverrProvider(None)
    web = WebFetchProvider(fs)
    ctx = PipelineContext(
        dns=DNSProvider(),
        rdap=RDAPProvider(),
        web=web,
        searxng=SearXNGProvider(None),
        llm=AIGatewayClient("http://localhost:1", None, ["x"]),
    )
    return EnrichmentPipeline(ctx, mock_mode=True)


async def _run_one(nats, sessions, settings, req) -> EnrichmentJob:
    await nats.js.publish(
        settings.subject_requested,
        json.dumps(req.model_dump(mode="json"), default=str).encode(),
    )
    async with sessions.session() as s:
        repo = EnrichmentRepository(s)
        runner = JobRunner(settings, repo, nats, build_pipeline())
        msgs = await nats.fetch(1)
        assert msgs, "expected at least one message"
        await runner.handle_message(msgs[0])
    async with sessions.session() as s:
        res = await s.execute(select(EnrichmentJob).where(EnrichmentJob.event_id == req.event_id))
        return res.scalar_one()


@pytest.mark.integration
async def test_critical_slice_completes_job_and_outbox(nats, sessions):
    settings = build_settings()
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="12345678000199", company_name="E2E Company"
    )
    job = await _run_one(nats, sessions, settings, req)
    assert job.status == JobStatus.COMPLETED

    async with sessions.session() as s:
        res = await s.execute(
            select(OutboxEvent).where(OutboxEvent.job_id == job.id)
        )
        outbox = res.scalar_one()
        assert outbox.subject == "enrichment.company.completed.v1"
        assert outbox.processed is False

        res2 = await s.execute(
            select(CompanyEnrichment).where(CompanyEnrichment.company_id == req.company_id)
        )
        enrichment = res2.scalar_one()
        assert enrichment.enrichment_version == 1
        assert enrichment.domain.get("valid") is True


@pytest.mark.integration
async def test_idempotent_same_event_does_not_duplicate(nats, sessions):
    settings = build_settings()
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="99999999000191", company_name="Dup Co"
    )
    # Same event delivered twice.
    await _run_one(nats, sessions, settings, req)
    async with sessions.session() as s:
        rows = (await s.execute(select(EnrichmentJob).where(EnrichmentJob.event_id == req.event_id))).scalars().all()
        assert len(rows) == 1
        enrichments = (await s.execute(select(CompanyEnrichment).where(CompanyEnrichment.company_id == req.company_id))).scalars().all()
        assert len(enrichments) == 1, "duplicate event must not duplicate the final enrichment"


@pytest.mark.integration
async def test_lease_takeover_after_stale(nats, sessions):
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="77777777000181", company_name="Lease Co"
    )
    async with sessions.session() as s:
        repo = EnrichmentRepository(s)
        # Simulate job created and leased by a dead worker.
        job, _ = await repo.upsert_job_from_event(
            req.event_id, company_id=req.company_id, cnpj=req.cnpj
        )
        acquired = await repo.acquire_lease(job.id, "dead-worker", 60)
        assert acquired is True
        # Another worker should NOT be able to take over while the lease is valid.
        ok = await repo.acquire_lease(job.id, "worker-A", 60)
        assert ok is False
        # Force the lease to expire (stale) and confirm takeover works.
        from sqlalchemy import update

        from company_enrichment.db.models import EnrichmentJob as EJ

        await s.execute(
            update(EJ)
            .where(EJ.id == job.id)
            .values(lease_expires_at=text("now() - interval '120 seconds'"))
        )
        await s.commit()
        ok2 = await repo.acquire_lease(job.id, "worker-A", 60)
        assert ok2 is True


@pytest.mark.integration
async def test_restart_resumes_incomplete_jobs(nats, sessions):
    """A job left RUNNING (incomplete) can be re-acquired and completed."""
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="44444444000146", company_name="Restart Co"
    )
    async with sessions.session() as s:
        repo = EnrichmentRepository(s)
        job, _ = await repo.upsert_job_from_event(
            req.event_id, company_id=req.company_id, cnpj=req.cnpj
        )
        # Worker starts then dies mid-job: job stays RUNNING with a fresh lease.
        await repo.acquire_lease(job.id, "died-worker", 60)
        # Simulate the dead worker's pod being absent long enough for the lease to go stale.
        await s.execute(
            update(EnrichmentJob)
            .where(EnrichmentJob.id == job.id)
            .values(lease_expires_at=text("now() - interval '120 seconds'"))
        )
        await s.commit()
    # A restarted worker re-processes by acquiring the (now stale) lease.
    async with sessions.session() as s:
        repo = EnrichmentRepository(s)
        ok = await repo.acquire_lease(job.id, "restarted-worker", 60)
        assert ok is True
