"""Unit tests for the collected-data ingest queue serialization.

The decoupled persistence flow serializes a `DirectiveOutcome` into an
`IngestCollectedV1` queue payload (published by collection workers) and
reconstructs it in the persister worker. These tests lock the round-trip,
including the EdgeKind <-> string mapping.
"""
from __future__ import annotations

import uuid

import pytest

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.events.graph_contracts import (
    GraphEntityRef,
    IngestCollectedV1,
    WorkerDirectiveRequestedV1,
    ingest_collected_subject,
)
from company_enrichment.services.graph_director import GraphDirector
from company_enrichment.workers.capability import (
    CapabilityContext,
    DirectiveOutcome,
    EntityWrite,
    FactWrite,
)
from company_enrichment.workers.registry import WorkerType


def _director(published: list) -> GraphDirector:
    async def publish(subject: str, payload: dict) -> None:
        published.append((subject, payload))

    class _Repo:
        pass

    return GraphDirector(
        graph_repo=_Repo(),  # type: ignore[arg-type]
        publish_fn=publish,
        ctx=CapabilityContext(),
        worker_id="unit-ingest",
    )


@pytest.mark.asyncio
async def test_outcome_round_trips_through_ingest_queue():
    published: list[tuple[str, dict]] = []
    director = _director(published)

    outcome = DirectiveOutcome(
        status="COMPLETED",
        facts=[
            FactWrite(
                entity_type="DOMAIN",
                entity_key="acme.com.br",
                fact_key="website",
                value={"value": "acme.com.br"},
                confidence=0.9,
                source={"type": "BBOT", "url": "https://acme.com.br"},
            )
        ],
        entities=[
            EntityWrite(
                entity_type="EMAIL",
                entity_key="contato@acme.com.br",
                label="Contato",
                relation_type=EdgeKind.HAS_EMAIL,
                confidence=0.8,
                meta={"provider": "BBOT"},
                emit_discovery=True,
            )
        ],
        relations=[("acme.com.br", "contato@acme.com.br", EdgeKind.HAS_EMAIL, 0.7)],
        summary={"corporate_email": True},
    )

    directive = WorkerDirectiveRequestedV1(
        event_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        request_event_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        worker_type=WorkerType.BBOT.value,
        entity=GraphEntityRef(entity_type="DOMAIN", entity_key="acme.com.br"),
        target="acme.com.br",
        depth=1,
    )

    await director._enqueue_ingest(directive, outcome)  # noqa: SLF001

    assert len(published) == 1
    subject, payload = published[0]
    assert subject == ingest_collected_subject()

    ev = IngestCollectedV1.model_validate(payload)
    assert ev.worker_type == "bbot"
    assert ev.facts[0].fact_key == "website"
    assert ev.entities[0].relation_type == EdgeKind.HAS_EMAIL.value

    rebuilt = director._outcome_from_ingest(ev)  # noqa: SLF001
    assert rebuilt.status == "COMPLETED"
    assert rebuilt.facts[0].value == {"value": "acme.com.br"}
    assert rebuilt.entities[0].relation_type is EdgeKind.HAS_EMAIL
    assert rebuilt.relations == [("acme.com.br", "contato@acme.com.br", EdgeKind.HAS_EMAIL, 0.7)]
    assert rebuilt.summary == {"corporate_email": True}
