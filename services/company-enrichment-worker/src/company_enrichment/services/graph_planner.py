"""Enrichment graph planner and guardrails.

Pure logic that decides, for a discovered entity, whether follow-on directives
are legal and how to fan them out. Kept free of I/O so the guardrail rules can
be unit-tested deterministically.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from company_enrichment.workers.registry import (
    FOLLOWUP_ALLOWED,
    FOLLOWUP_WORKERS_BY_KIND,
    LEAF_ENTITY_KINDS,
    WorkerType,
)


@dataclass(frozen=True)
class PlannedDirective:
    worker_type: WorkerType
    entity_type: str
    entity_key: str
    target: str
    depth: int
    target_company_id: str | None = None


@dataclass(frozen=True)
class GuardDecision:
    """Result of evaluating a discovered entity for follow-up scheduling."""

    allowed: bool
    directives: list[PlannedDirective] = field(default_factory=list)
    reason: str | None = None


class GuardrailReason:
    DEPTH = "DEPTH"
    BUDGET = "BUDGET"
    KINDLIST = "KINDLIST"
    NO_FOLLOWUP = "NO_FOLLOWUP"
    UNKNOWN_KIND = "UNKNOWN_KIND"


class EnrichmentGraphPlanner:
    """Applies the recursion guardrails and computes follow-up directives.

    Guards (per plan §6):
      1. depth < max_depth
      2. case budget not exhausted (directives + facts)
      3. entity kind has allowed follow-up workers (kind allowlist)
      4. leaf kinds never fan out
    """

    def __init__(
        self,
        *,
        max_depth: int = 2,
        max_directives: int = 50,
        close_company_loop: bool = True,
    ) -> None:
        self._max_depth = max_depth
        self._max_directives = max_directives
        self._close_company_loop = close_company_loop

    def decide(
        self,
        *,
        entity_type: str,
        entity_key: str,
        depth: int,
        directives_so_far: int = 0,
        max_depth: int | None = None,
        max_directives: int | None = None,
    ) -> GuardDecision:
        """Returns planned follow-up directives for a discovered entity.

        `max_depth` / `max_directives` override the planner defaults (used for
        per-case budgets).
        """
        max_depth = self._max_depth if max_depth is None else max_depth
        max_directives = self._max_directives if max_directives is None else max_directives

        # Guard 4: leaf kinds are terminal relationship targets.
        if entity_type in LEAF_ENTITY_KINDS:
            return GuardDecision(allowed=False, reason=GuardrailReason.NO_FOLLOWUP)

        workers = FOLLOWUP_WORKERS_BY_KIND.get(entity_type)
        if not workers:
            return GuardDecision(allowed=False, reason=GuardrailReason.UNKNOWN_KIND)

        # Guard 1: depth budget.
        if depth >= max_depth:
            return GuardDecision(allowed=False, reason=GuardrailReason.DEPTH)

        # Guard 2: directive budget.
        if directives_so_far >= max_directives:
            return GuardDecision(allowed=False, reason=GuardrailReason.BUDGET)

        directives: list[PlannedDirective] = []
        for wt in sorted(workers, key=lambda w: w.value):
            if wt not in FOLLOWUP_ALLOWED:
                continue
            directives.append(
                PlannedDirective(
                    worker_type=wt,
                    entity_type=entity_type,
                    entity_key=entity_key,
                    target=entity_key,
                    depth=depth + 1,
                )
            )
        if not directives:
            return GuardDecision(allowed=False, reason=GuardrailReason.KINDLIST)
        return GuardDecision(allowed=True, directives=directives)


class CompanySeedPlanner:
    """Initial fan-out for a company request (depth 0)."""

    SEED_WORKERS = (
        (WorkerType.REGISTRY, "COMPANY"),
        (WorkerType.DOMAIN, "COMPANY"),
        (WorkerType.CONTACTS, "COMPANY"),
        (WorkerType.TECH, "COMPANY"),
        (WorkerType.FINANCIAL, "COMPANY"),
    )

    def plan_seed(self, *, cnpj: str, company_id: str) -> list[PlannedDirective]:
        directives: list[PlannedDirective] = []
        for wt, _kind in self.SEED_WORKERS:
            directives.append(
                PlannedDirective(
                    worker_type=wt,
                    entity_type="COMPANY",
                    entity_key=cnpj,
                    target=cnpj,
                    depth=0,
                    target_company_id=company_id,
                )
            )
        return directives
