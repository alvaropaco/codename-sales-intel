"""Integration tests for the entity-graph enrichment architecture.

Requires local NATS (JetStream) + PostgreSQL, same as the critical E2E slice:
  - NATS on nats://localhost:4222
  - Postgres at postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test

Run migrations first (see tests/integration/test_e2e_critical_slice.py).
Exercises: case creation, seed fan-out, directive execution -> entities/facts/
relations persisted, entity-discovery guard scheduling, and idempotency.
"""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import select, text

from company_enrichment.config.settings import Settings
from company_enrichment.db.graph_models import (
    CaseStatus,
    WorkerDirectiveStatus,
)
from company_enrichment.db.graph_repository import GraphRepository
from company_enrichment.db.session import SessionFactory
from company_enrichment.events.contracts import EnrichmentRequestedV1
from company_enrichment.events.graph_contracts import (
    EntityDiscoveredV1,
    GraphEntityRef,
    IngestCollectedV1,
    WorkerDirectiveRequestedV1,
    ingest_collected_subject,
)
from company_enrichment.services.graph_director import GraphDirector
from company_enrichment.workers.capability import CapabilityContext

NATS_URL = os.getenv("NATS_TEST_URL", "nats://localhost:4222")
DATABASE_URL = os.getenv(
    "DATABASE_TEST_URL",
    "postgresql+asyncpg://cnpj:cnpj@localhost:5432/company_enrichment_test",
)

pytestmark = pytest.mark.integration


@pytest.fixture
async def sessions():
    settings = Settings(database_url=DATABASE_URL)
    sf = SessionFactory(settings)
    await sf.start()
    try:
        # Clean graph tables from previous runs.
        async with sf.session() as s:
            for table in (
                "enrichment_facts",
                "entity_relations",
                "entities",
                "enrichment_worker_jobs",
                "enrichment_cases",
            ):
                await s.execute(text(f"DELETE FROM company_enrichment.{table}"))
            await s.commit()
        yield sf
    finally:
        await sf.stop()


def build_director(graph_repo, published: list[tuple[str, dict]] | None = None):
    bucket = published if published is not None else []

    async def publish(subject: str, payload: dict) -> None:
        bucket.append((subject, payload))

    return GraphDirector(
        graph_repo=graph_repo,
        publish_fn=publish,
        ctx=CapabilityContext(),
        max_depth=2,
        max_directives=10,
        max_facts=50,
        worker_id="it-graph",
        lease_seconds=30,
    )


async def drain_ingest(s, director, published) -> int:
    """Simulate the dedicated persister worker consuming the collected-data queue."""
    processed = 0
    for subject, payload in list(published):
        if subject != ingest_collected_subject():
            continue
        await director.on_ingest_collected(IngestCollectedV1.model_validate(payload))
        processed += 1
    await s.commit()
    return processed


async def settle_case(s, director, repo, case, req, published, *, loops: int = 40) -> None:
    """Run collection + persistence phases until the graph settles.

    Collection workers collect directives and hand them to the ingest queue;
    the persister worker drains that queue and writes to PostgreSQL (this helper
    alternates both phases, mirroring the decoupled production topology).
    """
    for _ in range(loops):
        progressed = False
        # Collection phase: run directives that still need collecting.
        pending = [
            j for j in await repo.list_directives(case.id)
            if j.status in ("REQUESTED", "RUNNING")
        ]
        for job in pending:
            directive = WorkerDirectiveRequestedV1(
                case_id=case.id,
                request_event_id=req.event_id,
                company_id=req.company_id,
                worker_type=job.worker_type,
                entity=GraphEntityRef(
                    entity_type=job.entity_type or "COMPANY", entity_key=job.entity_key
                ),
                target=job.target,
                hints=job.hints or {
                    "cnpj": req.cnpj,
                    "company_name": "Acme Ltda",
                    "page_text": "contato@acme.com.br",
                },
                depth=job.depth,
            )
            await director.on_directive_requested(directive)
            await s.commit()
            progressed = True
        # Persistence phase: drain the collected-data queue.
        if await drain_ingest(s, director, published):
            progressed = True
        if not progressed:
            break


async def test_case_created_and_seed_fanned_out(sessions):
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="12345678000199", company_name="Acme Ltda"
    )
    async with sessions.session() as s:
        director = build_director(GraphRepository(s), published)
        await director.on_company_requested(req)
        await s.commit()

        case = await GraphRepository(s).get_case_by_request(req.event_id)
        assert case is not None
        assert case.status == CaseStatus.OPEN
        # 4 seed directives (registry, domain, contacts, tech, financial are
        # COMPANY-scope; all run at depth 0)
        jobs = await GraphRepository(s).list_directives(case.id)
        types = {j.worker_type for j in jobs}
        assert "registry" in types
        assert "domain" in types
        assert "financial" in types
        assert len(published) >= 1
        subjects = {subject for subject, _ in published}
        assert "enrichment.worker.registry.requested.v1" in subjects


async def test_directive_execution_persists_entities_and_facts(sessions):
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="12345678000199", company_name="Acme Ltda"
    )
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo, published)
        await director.on_company_requested(req)
        await s.commit()

        case = await repo.get_case_by_request(req.event_id)
        assert case is not None

        # Run the registry directive as a worker pod would (collection only).
        directive = WorkerDirectiveRequestedV1(
            case_id=case.id,
            request_event_id=req.event_id,
            company_id=req.company_id,
            worker_type="registry",
            entity=GraphEntityRef(entity_type="COMPANY", entity_key=req.cnpj),
            target=req.cnpj,
            hints={"cnpj": req.cnpj, "company_name": "Acme Ltda"},
            depth=0,
        )
        await director.on_directive_requested(directive)
        await s.commit()

        jobs = await repo.list_directives(case.id)
        registry_job = next(j for j in jobs if j.worker_type == "registry")
        assert registry_job.status == WorkerDirectiveStatus.COLLECTED

        # The persister worker consumes the ingest queue and writes to Postgres.
        assert await drain_ingest(s, director, published) == 1

        jobs = await repo.list_directives(case.id)
        registry_job = next(j for j in jobs if j.worker_type == "registry")
        assert registry_job.status == WorkerDirectiveStatus.COMPLETED

        company = await repo._get_entity("COMPANY", req.cnpj)
        assert company is not None
        facts = await repo.list_facts_for_entity_ids([str(company.id)])
        assert any(f.fact_key == "cnpj" for f in facts)


async def test_entity_discovered_schedules_followup_within_guards(sessions):
    uuid.uuid4()
    req_event = uuid.uuid4()
    company_id = uuid.uuid4()
    async with sessions.session() as s:
        repo = GraphRepository(s)
        case = await repo.create_case(
            request_event_id=req_event,
            tenant_id=None,
            company_id=company_id,
            cnpj="12345678000199",
            max_depth=2,
            max_directives=10,
            max_facts=50,
        )
        await s.commit()
        director = build_director(repo)
        ev = EntityDiscoveredV1(
            case_id=case.id,
            request_event_id=req_event,
            company_id=company_id,
            entity=GraphEntityRef(entity_type="DOMAIN", entity_key="acme.com.br"),
            depth=1,
        )
        await director.on_entity_discovered(ev)
        await s.commit()

        jobs = await repo.list_directives(case.id)
        types = {j.worker_type for j in jobs}
        assert "bbot" in types
        assert "tech" in types
        assert all(j.depth == 2 for j in jobs)


async def test_guard_rejects_depth_exhausted(sessions):
    uuid.uuid4()
    req_event = uuid.uuid4()
    company_id = uuid.uuid4()
    async with sessions.session() as s:
        repo = GraphRepository(s)
        case = await repo.create_case(
            request_event_id=req_event, tenant_id=None, company_id=company_id,
            cnpj="12345678000199", max_depth=1, max_directives=5, max_facts=50,
        )
        await s.commit()
        director = build_director(repo)
        ev = EntityDiscoveredV1(
            case_id=case.id, request_event_id=req_event, company_id=company_id,
            entity=GraphEntityRef(entity_type="DOMAIN", entity_key="acme.com.br"),
            depth=1,  # max_depth is 1 -> no follow-up
        )
        await director.on_entity_discovered(ev)
        await s.commit()
        jobs = await repo.list_directives(case.id)
        assert jobs == []


async def test_duplicate_directive_is_idempotent(sessions):
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199")
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo)
        await director.on_company_requested(req)
        await s.commit()
        case = await repo.get_case_by_request(req.event_id)
        jobs1 = await repo.list_directives(case.id)

        # Second delivery of the same company request must not duplicate directives.
        await director.on_company_requested(req)
        await s.commit()
        jobs2 = await repo.list_directives(case.id)
        assert len(jobs1) == len(jobs2)
        # And the case pending count reflects only the first fan-out.
        assert case.pending == len(jobs1)


async def test_full_case_finalizes_when_all_directives_complete(sessions):
    """Drain directives (incl. follow-ups) until pending reaches 0 -> COMPLETED."""
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199", company_name="Acme Ltda")
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo, published)
        await director.on_company_requested(req)
        await s.commit()
        case = await repo.get_case_by_request(req.event_id)
        assert case is not None

        # Alternate collection and persistence phases until the graph settles
        # (seed directives may discover entities that enqueue follow-ups).
        await settle_case(s, director, repo, case, req, published)

        case = await repo.get_case_by_request(req.event_id)
        assert case.status == CaseStatus.COMPLETED
        subjects = {subject for subject, _ in published}
        assert "enrichment.company.completed.v1" in subjects
        # The completion event carries the aggregated summary.
        completed = [p for subj, p in published if subj == "enrichment.company.completed.v1"]
        assert completed
        assert completed[0]["summary"] is not None
        # Entities/facts persisted.
        company = await repo._get_entity("COMPANY", req.cnpj)
        assert company is not None
        facts = await repo.list_facts_for_entity_ids([str(company.id)])
        assert any(f.fact_key == "cnpj" for f in facts)

        # A versioned company_enrichments row is persisted (durable profile).
        from company_enrichment.db.models import CompanyEnrichment

        enrichments = (
            await s.execute(
                select(CompanyEnrichment).where(CompanyEnrichment.company_id == req.company_id)
            )
        ).scalars().all()
        assert len(enrichments) == 1
        assert enrichments[0].enrichment_version == 1
        assert enrichments[0].summary is not None
        assert enrichments[0].result.get("firmographics") is not None


async def test_full_case_with_formatted_cnpj_finalizes(sessions):
    """A formatted CNPJ input normalizes to the same COMPANY entity key.

    Regression test for the NO_COMPANY_ENTITY finalization bug: the case stores
    the raw request CNPJ ("12.345.678/0001-99") while the registry capability
    keys the COMPANY entity by the digits-only form ("12345678000199").
    """
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(
        company_id=uuid.uuid4(), cnpj="12.345.678/0001-99", company_name="Acme Ltda"
    )
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo, published)
        await director.on_company_requested(req)
        await s.commit()
        case = await repo.get_case_by_request(req.event_id)
        assert case is not None

        await settle_case(s, director, repo, case, req, published)

        case = await repo.get_case_by_request(req.event_id)
        assert case.status == CaseStatus.COMPLETED
        company = await repo._get_entity("COMPANY", "12345678000199")
        assert company is not None


async def test_discovered_entity_schedules_followup_within_directive_run(sessions):
    """The graph chain advances synchronously: a directive discovering a DOMAIN
    enqueues follow-up directives before the case finalizes (no race)."""
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199", company_name="Acme Ltda")
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo, published)
        await director.on_company_requested(req)
        await s.commit()
        case = await repo.get_case_by_request(req.event_id)

        # Run the domain seed directive with a fake domain service that
        # discovers + validates a real domain, forcing a DOMAIN entity discovery.

        class FakeDiscovery:
            async def discover(self, fg, evidence):
                return ["acme.com.br"], evidence

        class FakeValidation:
            async def validate(self, domain, evidence, fg):
                from company_enrichment.models.outputs.results import DomainInfo
                return DomainInfo(domain=domain, valid=True, dns_a=True, https=True), domain, evidence

        class FakeCrawler:
            async def crawl(self, domain):
                from company_enrichment.services.crawler import CrawlPage
                page = CrawlPage()
                page.url = f"https://{domain}/contato"
                page.title = "Acme Contato"
                page.text = "Entre em contato: contato@acme.com.br (11) 99999-0000"
                page.scripts = ["gtag.js"]
                return [page], page.text

        director._ctx.domain_discovery = FakeDiscovery()
        director._ctx.domain_validation = FakeValidation()
        director._ctx.crawler = FakeCrawler()

        # Collect the seed directives (company scope). The domain directive
        # discovers acme.com.br and hands its data to the ingest queue.
        pending = [j for j in await repo.list_directives(case.id)
                   if j.status in ("REQUESTED", "RUNNING")]
        for job in pending:
            directive = WorkerDirectiveRequestedV1(
                case_id=case.id, request_event_id=req.event_id,
                company_id=req.company_id, worker_type=job.worker_type,
                entity=GraphEntityRef(entity_type=job.entity_type or "COMPANY", entity_key=job.entity_key),
                target=job.target,
                hints=job.hints or {"cnpj": req.cnpj, "company_name": "Acme Ltda"},
                depth=job.depth,
            )
            await director.on_directive_requested(directive)
            await s.commit()
        # The persister writes the domain + its facts and enqueues follow-ups.
        await drain_ingest(s, director, published)

        # The DOMAIN discovery must have enqueued follow-ups (bbot/tech/social/contacts)
        # at depth 2 (company=0 -> domain=1 -> follow-up=2), keyed on the domain.
        jobs = await repo.list_directives(case.id)
        domain_followups = [j for j in jobs if j.entity_key == "acme.com.br"]
        assert {j.worker_type for j in domain_followups} >= {"bbot", "tech", "social", "contacts"}
        assert all(j.depth == 2 for j in domain_followups)
        # The domain entity and its facts are persisted.
        domain = await repo._get_entity("DOMAIN", "acme.com.br")
        assert domain is not None
        domain_facts = await repo.list_facts_for_entity_ids([str(domain.id)])
        fact_keys = {f.fact_key for f in domain_facts}
        assert "page_text" in fact_keys, "domain crawl must persist page_text"
        page_text = next(f.value.get("value") for f in domain_facts if f.fact_key == "page_text")
        assert "contato@acme.com.br" in page_text
        # The contacts follow-up directive must carry the crawled page_text hint.
        contacts_followup = next(j for j in domain_followups if j.worker_type == "contacts")
        assert contacts_followup.hints.get("page_text") == page_text

        # Run the contacts follow-up (collection) and persist it: it must extract
        # the email from the page text and create an EMAIL entity (chain e2e).
        contacts_directive = WorkerDirectiveRequestedV1(
            case_id=case.id, request_event_id=req.event_id,
            company_id=req.company_id, worker_type="contacts",
            entity=GraphEntityRef(entity_type="DOMAIN", entity_key="acme.com.br"),
            target="acme.com.br", hints=contacts_followup.hints, depth=2,
        )
        await director.on_directive_requested(contacts_directive)
        await s.commit()
        await drain_ingest(s, director, published)
        email = await repo._get_entity("EMAIL", "contato@acme.com.br")
        assert email is not None, "contacts follow-up must extract the crawled email"


async def test_malformed_message_is_terminated_not_redelivered(sessions):
    """A non-JSON directive message is terminated (no infinite redelivery loop)."""

    from company_enrichment.worker.graph_worker import GraphModeWorker

    class FakeMsg:
        subject = "enrichment.worker.registry.requested.v1"
        data = b"this is not json"
        def __init__(self):
            self.terminated = False
            self.nacked = False
            self.acked = False
        async def term(self): self.terminated = True
        async def nak(self, delay=0): self.nacked = True
        async def ack(self): self.acked = True

    msg = FakeMsg()
    worker = GraphModeWorker(
        settings=Settings(database_url=DATABASE_URL),
        nats=None,
        director_factory=None,
        worker_types=["registry"],
        session_factory=sessions.session,
        concurrency=1,
    )
    # Bypass NATS; exercise the message-handling failure path directly.
    await worker._handle(msg)
    assert msg.terminated is True, "malformed message must be terminated (DLQ path)"
    assert msg.acked is False and msg.nacked is False


async def test_case_finalizes_partial_when_last_directive_fails(sessions):
    """If the last pending directive fails, the case still finalizes as PARTIAL."""
    published: list[tuple[str, dict]] = []
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199", company_name="Acme Ltda")
    async with sessions.session() as s:
        repo = GraphRepository(s)
        director = build_director(repo, published)
        await director.on_company_requested(req)
        await s.commit()
        case = await repo.get_case_by_request(req.event_id)

        # Run every directive; force the LAST one to fail (CAPABILITY_ERROR).
        pending = [j for j in await repo.list_directives(case.id) if j.status in ("REQUESTED", "RUNNING")]
        for idx, job in enumerate(pending):
            directive = WorkerDirectiveRequestedV1(
                case_id=case.id, request_event_id=req.event_id,
                company_id=req.company_id, worker_type=job.worker_type,
                entity=GraphEntityRef(entity_type=job.entity_type or "COMPANY", entity_key=job.entity_key),
                target=job.target,
                hints=job.hints or {"cnpj": req.cnpj, "company_name": "Acme Ltda"},
                depth=job.depth,
            )
            if idx == len(pending) - 1:
                # Force the final directive to fail: point at a capability that
                # raises by using a fake capability factory.
                async def failing(*a, **k):
                    raise RuntimeError("boom")
                director._execute_capability = failing
            await director.on_directive_requested(directive)
            await s.commit()

        # Persist the collected (non-failing) directives via the ingest queue.
        await drain_ingest(s, director, published)

        case = await repo.get_case_by_request(req.event_id)
        assert case.status == CaseStatus.PARTIAL, f"case should be PARTIAL, got {case.status}"
        # The partial result event was emitted.
        assert any(subj == "enrichment.company.partial.v1" for subj, _ in published)
        # A versioned profile is persisted (durable, even for partial).
        from company_enrichment.db.models import CompanyEnrichment
        enrichments = (
            await s.execute(select(CompanyEnrichment).where(CompanyEnrichment.company_id == req.company_id))
        ).scalars().all()
        assert len(enrichments) == 1
