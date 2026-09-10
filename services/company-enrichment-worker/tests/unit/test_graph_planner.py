"""Unit tests for the graph planner guardrails and worker registry."""
from __future__ import annotations

import pytest

from company_enrichment.services.graph_planner import (
    CompanySeedPlanner,
    EnrichmentGraphPlanner,
    GuardrailReason,
)
from company_enrichment.workers.registry import (
    COMPANY_SCOPE_WORKERS,
    CORE_ALIAS,
    WorkerType,
    resolve_worker_types,
    worker_request_subject,
)


class TestEnrichmentGraphPlanner:
    def setup_method(self):
        self.planner = EnrichmentGraphPlanner(max_depth=2, max_directives=5)

    def test_domain_followup_allowed(self):
        decision = self.planner.decide(
            entity_type="DOMAIN", entity_key="acme.com", depth=1, directives_so_far=2
        )
        assert decision.allowed is True
        types = {d.worker_type for d in decision.directives}
        assert WorkerType.BBOT in types
        assert WorkerType.TECH in types
        assert WorkerType.SOCIAL in types

    def test_leaf_kind_never_fans_out(self):
        for kind in ("PHONE", "ADDRESS", "TECHNOLOGY", "URL"):
            decision = self.planner.decide(entity_type=kind, entity_key="x", depth=0)
            assert decision.allowed is False
            assert decision.reason == GuardrailReason.NO_FOLLOWUP

    def test_depth_guard(self):
        decision = self.planner.decide(entity_type="DOMAIN", entity_key="x.com", depth=2)
        assert decision.allowed is False
        assert decision.reason == GuardrailReason.DEPTH

    def test_budget_guard(self):
        decision = self.planner.decide(
            entity_type="DOMAIN", entity_key="x.com", depth=0, directives_so_far=5
        )
        assert decision.allowed is False
        assert decision.reason == GuardrailReason.BUDGET

    def test_unknown_kind_guard(self):
        decision = self.planner.decide(entity_type="ALIEN", entity_key="x", depth=0)
        assert decision.allowed is False
        assert decision.reason == GuardrailReason.UNKNOWN_KIND

    def test_followup_depth_increments(self):
        decision = self.planner.decide(entity_type="EMAIL", entity_key="a@b.com", depth=1)
        assert all(d.depth == 2 for d in decision.directives)

    def test_recursion_stops(self):
        """A discovered entity at max depth never schedules more work (no loop)."""
        decision = self.planner.decide(entity_type="EMAIL", entity_key="a@b.com", depth=1)
        assert decision.allowed is True
        # The new directives are at depth 2 == max_depth; discovering more at that
        # depth from those directives would be rejected.
        for d in decision.directives:
            again = self.planner.decide(
                entity_type="PERSON", entity_key="p", depth=d.depth
            )
            assert again.allowed is False
            assert again.reason == GuardrailReason.DEPTH


class TestCompanySeedPlanner:
    def test_seed_workers(self):
        directives = CompanySeedPlanner().plan_seed(cnpj="12345678000199", company_id="c")
        types = {d.worker_type for d in directives}
        assert WorkerType.REGISTRY in types
        assert WorkerType.DOMAIN in types
        assert WorkerType.TECH in types
        assert WorkerType.FINANCIAL in types
        assert all(d.depth == 0 for d in directives)

    def test_seed_workers_are_company_scope(self):
        """Every seeded worker must be in COMPANY_SCOPE_WORKERS or the
        orchestrator silently drops it (regression from the real E2E run)."""
        directives = CompanySeedPlanner().plan_seed(cnpj="12345678000199", company_id="c")
        for d in directives:
            assert d.worker_type in COMPANY_SCOPE_WORKERS, f"{d.worker_type} not company-scope"


class TestWorkerRegistry:
    def test_core_alias(self):
        assert resolve_worker_types("core") == sorted(CORE_ALIAS, key=lambda wt: wt.value)

    def test_empty_defaults_to_core(self):
        assert resolve_worker_types("") == sorted(CORE_ALIAS, key=lambda wt: wt.value)

    def test_single_type(self):
        assert resolve_worker_types("bbot") == [WorkerType.BBOT]

    def test_multiple_types(self):
        types = resolve_worker_types("registry,domain")
        assert types == [WorkerType.REGISTRY, WorkerType.DOMAIN]

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError):
            resolve_worker_types("nope")

    def test_request_subject(self):
        assert worker_request_subject(WorkerType.BBOT) == "enrichment.worker.bbot.requested.v1"
