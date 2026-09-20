"""Unit tests: sweeper de diretivas órfãs COLLECTED (feature 006 follow-up).

Premissa: diretiva COLLECTED cujo ingest se perdeu NUNCA fica órfã para
sempre — o sweep re-dirige (reset para REQUESTED + re-publicação do evento
requested) e o worker re-executa de forma idempotente (unique por
case/worker/entity).
"""
from __future__ import annotations

import asyncio
import uuid

import pytest

from company_enrichment.services.graph_director import GraphDirector
from company_enrichment.workers.capability import CapabilityContext


class FakeRepo:
    def __init__(self, orphans):
        self._orphans = orphans
        self.resets: list[str] = []

    async def list_collected_orphans(self, *, min_age_s: int, limit: int = 200):
        return self._orphans[:limit]

    async def reset_directive_to_requested(self, job_id) -> None:
        self.resets.append(str(job_id))


class FakeJob:
    def __init__(self, worker_type: str, target: str = "acme.com.br"):
        self.id = uuid.uuid4()
        self.case_id = uuid.uuid4()
        self.request_event_id = uuid.uuid4()
        self.tenant_id = None
        self.company_id = uuid.uuid4()
        self.worker_type = worker_type
        self.target = target
        self.entity_type = "DOMAIN"
        self.entity_key = target
        self.target_company_id = uuid.uuid4()
        self.depth = 0
        self.park_cycles = 0


def make_director(repo, published):
    async def publish_fn(subject, payload):
        published.append((subject, payload))

    return GraphDirector(
        graph_repo=repo,
        publish_fn=publish_fn,
        ctx=CapabilityContext(),
    )


@pytest.mark.asyncio
async def test_sweep_redireciona_orfas_e_reseta_para_requested():
    orphans = [FakeJob("tech"), FakeJob("contacts")]
    repo = FakeRepo(orphans)
    published = []
    director = make_director(repo, published)

    count = await director.sweep_orphan_collected(min_age_s=7200, limit=200)

    assert count == 2
    assert len(published) == 2
    subjects = [s for s, _ in published]
    assert "enrichment.worker.tech.requested.v1" in subjects
    assert "enrichment.worker.contacts.requested.v1" in subjects
    # payload carrega a diretiva original
    _, payload = published[0]
    assert payload["target"] == orphans[0].target
    assert payload["entity"]["entity_key"] == orphans[0].entity_key
    # reset para REQUESTED antes da re-publicação
    assert repo.resets == [str(j.id) for j in orphans]


@pytest.mark.asyncio
async def test_sweep_respeita_limit():
    orphans = [FakeJob("tech") for _ in range(5)]
    repo = FakeRepo(orphans)
    published = []
    director = make_director(repo, published)

    count = await director.sweep_orphan_collected(min_age_s=7200, limit=3)

    assert count == 3
    assert len(published) == 3
    assert len(repo.resets) == 3


@pytest.mark.asyncio
async def test_sweep_sem_orfas_não_publica_nada():
    repo = FakeRepo([])
    published = []
    director = make_director(repo, published)

    count = await director.sweep_orphan_collected(min_age_s=7200, limit=200)

    assert count == 0
    assert published == []
    assert repo.resets == []
