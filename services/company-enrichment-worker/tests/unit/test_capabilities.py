"""Unit tests for worker capabilities (deterministic + OSINT mapping)."""
from __future__ import annotations

import uuid

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.events.graph_contracts import GraphEntityRef
from company_enrichment.providers.bbot import BbotEvent
from company_enrichment.workers.capabilities.deterministic import (
    ContactsCapability,
    FinancialCapability,
    RegistryCapability,
)
from company_enrichment.workers.capabilities.osint import (
    BbotCapability,
    PeopleCapability,
    RelationshipsCapability,
    SocialCapability,
)


def _directive_kwargs(**overrides):
    ctx = overrides.pop("ctx", None)
    if ctx is None:
        from types import SimpleNamespace

        ctx = SimpleNamespace(firmographics=None, dns=None)
    kwargs = dict(
        directive_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        request_event_id=uuid.uuid4(),
        tenant_id=None,
        company_id=uuid.uuid4(),
        entity=GraphEntityRef(entity_type="COMPANY", entity_key="12345678000199"),
        target="12345678000199",
        hints={},
        depth=0,
        budget_max_facts=100,
        ctx=ctx,
    )
    kwargs.update(overrides)
    return kwargs


class TestRegistryCapability:
    async def test_discards_invalid_cnpj(self):
        outcome = await RegistryCapability().run(**_directive_kwargs(target="not-a-cnpj"))
        assert outcome.status == "DISCARDED"

    async def test_writes_company_fact(self):
        outcome = await RegistryCapability().run(**_directive_kwargs())
        assert outcome.status == "COMPLETED"
        assert any(f.fact_key == "cnpj" for f in outcome.facts)

    async def test_qsa_people_owners(self):
        hints = {
            "qsa": [
                {"name": "João Silva", "role": "Sócio", "share": 60},
                {"name": "Maria Souza", "role": "Diretor", "share": 40},
            ]
        }
        outcome = await RegistryCapability().run(**_directive_kwargs(hints=hints))
        people = [e for e in outcome.entities if e.entity_type == "PERSON"]
        assert len(people) == 2
        assert EdgeKind.DIRECTOR_OF in {p.relation_type for p in people}
        assert EdgeKind.OWNER_OF in {p.relation_type for p in people}


class TestContactsCapability:
    async def test_extracts_emails_and_phones(self):
        hints = {
            "domain": "acme.com.br",
            "page_text": "Contato: contato@acme.com.br e (11) 99999-0000",
        }
        outcome = await ContactsCapability().run(**_directive_kwargs(hints=hints))
        emails = [f for f in outcome.facts if f.fact_key == "email"]
        phones = [f for f in outcome.facts if f.fact_key == "phone"]
        assert any(f.value["value"] == "contato@acme.com.br" for f in emails)
        assert any(f.value["value"] == "5511999990000" for f in phones)


class TestFinancialCapability:
    async def test_indicator_fact_not_factual_revenue(self):
        hints = {"cnpj": "12345678000199", "porte": "MEI", "capital_social": 10000.0}
        outcome = await FinancialCapability().run(**_directive_kwargs(hints=hints))
        indicators = [f for f in outcome.facts if f.fact_key.startswith("indicator:")]
        assert any(i.value.get("is_estimate") is False for i in indicators)
        # Never present revenue as fact.
        assert not any("revenue" in f.fact_key and f.value.get("is_estimate") is not False
                       for f in outcome.facts)


class TestBbotCapability:
    async def test_maps_events_to_entities(self):
        events = [
            BbotEvent(event_type="EMAIL_ADDRESS", data="contato@acme.com.br", module="emails"),
            BbotEvent(event_type="TECHNOLOGY", data="Cloudflare", module="wappalyzer"),
            BbotEvent(event_type="SOCIAL_SOCIAL", data="https://www.linkedin.com/company/acmebrasil"),
        ]

        class FakeBbot:
            enabled = True

            async def scan(self, target, hints=None):
                return events

        class FakeCtx:
            bbot = FakeBbot()

        outcome = await BbotCapability().run(
            **_directive_kwargs(
                entity=GraphEntityRef(entity_type="DOMAIN", entity_key="acme.com.br"),
                target="acme.com.br",
                ctx=FakeCtx(),
            )
        )
        kinds = {e.entity_type for e in outcome.entities}
        assert "EMAIL" in kinds
        assert "TECHNOLOGY" in kinds
        assert any(f.fact_key == "tech:cloudflare" for f in outcome.facts)


class TestSocialCapability:
    async def test_discovers_profiles(self):
        hints = {
            "page_text": "Siga-nos: https://www.instagram.com/acmebrasil "
                         "e https://www.linkedin.com/company/acmebrasil",
        }
        outcome = await SocialCapability().run(
            **_directive_kwargs(
                entity=GraphEntityRef(entity_type="COMPANY", entity_key="12345678000199"),
                hints=hints,
            )
        )
        profiles = [e for e in outcome.entities if e.entity_type == "SOCIAL_PROFILE"]
        assert len(profiles) == 2
        keys = {p.entity_key for p in profiles}
        assert "instagram:acmebrasil" in keys
        assert "linkedin:acmebrasil" in keys


class TestPeopleCapability:
    async def test_owners_from_qsa_and_emails(self):
        hints = {"qsa": [{"name": "João Silva", "role": "Sócio"}], "page_text": "joao@acme.com.br"}
        outcome = await PeopleCapability().run(
            **_directive_kwargs(
                entity=GraphEntityRef(entity_type="COMPANY", entity_key="12345678000199"),
                hints=hints,
            )
        )
        people = [e for e in outcome.entities if e.entity_type == "PERSON"]
        emails = [e for e in outcome.entities if e.entity_type == "EMAIL"]
        assert len(people) >= 1
        assert len(emails) >= 1


class TestRelationshipsCapability:
    async def test_same_owner_edges(self):
        hints = {"co_owners": ["Maria Souza", "Julia Prado"]}
        outcome = await RelationshipsCapability().run(
            **_directive_kwargs(
                entity=GraphEntityRef(entity_type="PERSON", entity_key="João Silva"),
                hints=hints,
            )
        )
        assert any(e[2] == EdgeKind.SAME_OWNER for e in outcome.relations)


class TestValidatorCapability:
    async def test_validates_and_normalizes_candidates(self):
        from company_enrichment.workers.capabilities.deterministic import ValidatorCapability

        hints = {
            "emails": ["Contato@Acme.com.br", "not-an-email"],
            "phones": ["(11) 99999-0000", "123"],
            "domains": ["WWW.Acme.com.br/", "no domain"],
        }
        outcome = await ValidatorCapability().run(
            **_directive_kwargs(
                entity=GraphEntityRef(entity_type="COMPANY", entity_key="12345678000199"),
                hints=hints,
            )
        )
        emails = [f.value["value"] for f in outcome.facts if f.fact_key == "email"]
        assert emails == ["contato@acme.com.br"]
        phones = [f.value["value"] for f in outcome.facts if f.fact_key == "phone"]
        assert phones == ["5511999990000"]
        domains = [f.value["value"] for f in outcome.facts if f.fact_key == "website"]
        assert domains == ["acme.com.br"]


def test_every_worker_type_has_a_capability():
    from company_enrichment.workers.capabilities import CAPABILITIES, capability_for
    from company_enrichment.workers.registry import WorkerType

    for wt in WorkerType:
        if wt in (WorkerType.ORCHESTRATOR, WorkerType.PERSISTER):
            # The orchestrator is the director; the persister consumes the ingest
            # queue and persists collected data. Neither is a capability.
            continue
        assert capability_for(wt) is not None, f"{wt} has no capability"
    # Every capability in the registry maps to a real WorkerType.
    assert set(CAPABILITIES) <= set(WorkerType)
