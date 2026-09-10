"""Capability model for worker types.

A `WorkerCapability` implements the enrichment logic for one worker type. It
receives a directive (target entity + hints), runs bounded deterministic/OSINT
work, and returns a `DirectiveOutcome` describing facts written, entities
discovered, relations, and discoveries to emit. Capabilities never talk to
NATS or the DB directly; the graph runner performs persistence + event emission
around them.
"""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.events.graph_contracts import GraphEntityRef
from company_enrichment.workers.registry import WorkerType


@dataclass
class EntityWrite:
    """A durable entity to upsert + optional relation to the operator entity."""

    entity_type: str
    entity_key: str
    label: str | None = None
    relation_type: EdgeKind | None = None
    confidence: float = 0.5
    meta: dict[str, Any] | None = None
    emit_discovery: bool = True


@dataclass
class FactWrite:
    entity_type: str
    entity_key: str
    fact_key: str
    value: dict[str, Any] | None = None
    confidence: float = 0.5
    source: dict[str, Any] | None = None


@dataclass
class DirectiveOutcome:
    """What a capability produced for one directive."""

    status: str = "COMPLETED"  # COMPLETED | FAILED | DISCARDED
    facts: list[FactWrite] = field(default_factory=list)
    entities: list[EntityWrite] = field(default_factory=list)
    relations: list[tuple[str, str, EdgeKind, float]] = field(default_factory=list)
    discoveries: list[EntityWrite] = field(default_factory=list)
    summary: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None


class CapabilityContext:
    """Injectables a capability may need (providers/services)."""

    def __init__(
        self,
        *,
        graph_repo=None,
        bbot=None,
        spiderfoot=None,
        web=None,
        searxng=None,
        dns=None,
        rdap=None,
        crawler=None,
        ai=None,
        firmographics=None,
        tech_detection=None,
        digital_presence=None,
        domain_discovery=None,
        domain_validation=None,
        qsa=None,
    ) -> None:
        self.graph_repo = graph_repo
        self.bbot = bbot
        self.spiderfoot = spiderfoot
        self.web = web
        self.searxng = searxng
        self.dns = dns
        self.rdap = rdap
        self.crawler = crawler
        self.ai = ai
        self.firmographics = firmographics
        self.tech_detection = tech_detection
        self.digital_presence = digital_presence
        self.domain_discovery = domain_discovery
        self.domain_validation = domain_validation
        self.qsa = qsa


class WorkerCapability(ABC):
    worker_type: WorkerType

    @abstractmethod
    async def run(
        self,
        *,
        directive_id: uuid.UUID,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        entity: GraphEntityRef,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        ...
