"""Unit tests for the graph aggregator (final profile composition)."""
from __future__ import annotations

from datetime import UTC, datetime

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.services.graph_aggregator import GraphAggregator


def _fact(entity_id, key, value, confidence=0.9):
    from types import SimpleNamespace

    return SimpleNamespace(
        entity_id=entity_id, fact_key=key, value=value, confidence=confidence
    )


def _rel(source, target, edge_type, confidence=0.8):
    from types import SimpleNamespace

    return SimpleNamespace(
        source_entity_id=source,
        target_entity_id=target,
        relation_type=edge_type,
        confidence=confidence,
        observed_at=datetime.now(UTC),
    )


def test_compose_produces_profile_and_summary():
    facts = [
        _fact("c1", "cnpj", {"value": "12345678000199"}),
        _fact("c1", "legal_name", {"value": "Acme Ltda"}),
        _fact("c1", "website", {"value": "acme.com.br", "https": True, "valid": True}),
        _fact("c1", "email", {"value": "contato@acme.com.br", "domain": "acme.com.br"}),
        _fact("c1", "phone", {"value": "5511999990000"}),
        _fact("c1", "indicator:porte", {"value": "EPP", "is_estimate": False}),
        _fact("c1", "tech:cloudflare", {"value": "Cloudflare", "category": "infra"}),
        _fact("c1", "social:linkedin", {"value": "https://www.linkedin.com/company/acme", "platform": "linkedin"}),
    ]
    relations = [
        _rel("p1", "c1", EdgeKind.OWNER_OF.value),
        _rel("p2", "c1", EdgeKind.DIRECTOR_OF.value),
        _rel("e1", "c1", EdgeKind.HAS_EMAIL.value),
    ]
    labels = {"c1": "Acme Ltda", "p1": "João Silva", "p2": "Maria Souza", "e1": "contato@acme.com.br"}

    agg = GraphAggregator(facts=facts, entity_labels=labels, relations=relations)
    profile, summary = agg.compose()

    assert profile["firmographics"]["cnpj"] == "12345678000199"
    assert profile["domain"] == {"value": "acme.com.br", "https": True, "valid": True}
    assert {"type": "email", "value": "contato@acme.com.br"} in [
        {k: v for k, v in c.items() if k != "confidence"} for c in profile["contact_points"]
    ]
    assert profile["financial_indicators"]["porte"]["value"] == "EPP"
    assert profile["technologies"][0]["name"] == "Cloudflare"
    assert profile["social"]["linkedin"]["url"].startswith("https")

    people = profile["people"]
    assert len(people) == 2
    roles = {p["role"] for p in people}
    assert "owner" in roles
    assert "director" in roles

    assert profile["relationships"]["edge_count"] == 3
    assert "João Silva" in profile["relationships"]["co_owners"]
    assert summary["people"] == 2
    assert summary["technologies"] == 1


def test_compose_without_relations():
    agg = GraphAggregator(facts=[], entity_labels={}, relations=[])
    profile, summary = agg.compose()
    assert profile["people"] == []
    assert profile["relationships"]["edge_count"] == 0
    assert summary["people"] == 0
