"""Capability registry: maps a WorkerType to its implementation."""
from __future__ import annotations

from typing import TYPE_CHECKING

from company_enrichment.workers.capabilities.deterministic import (
    ContactsCapability,
    DomainCapability,
    FinancialCapability,
    RegistryCapability,
    TechCapability,
    ValidatorCapability,
)
from company_enrichment.workers.capabilities.osint import (
    BbotCapability,
    PeopleCapability,
    RelationshipsCapability,
    SocialCapability,
    SpiderFootCapability,
)
from company_enrichment.workers.registry import WorkerType

if TYPE_CHECKING:  # pragma: no cover
    from company_enrichment.workers.capability import WorkerCapability


CAPABILITIES: dict[WorkerType, type[WorkerCapability]] = {
    WorkerType.REGISTRY: RegistryCapability,
    WorkerType.DOMAIN: DomainCapability,
    WorkerType.TECH: TechCapability,
    WorkerType.CONTACTS: ContactsCapability,
    WorkerType.FINANCIAL: FinancialCapability,
    WorkerType.BBOT: BbotCapability,
    WorkerType.SPIDERFOOT: SpiderFootCapability,
    WorkerType.SOCIAL: SocialCapability,
    WorkerType.PEOPLE: PeopleCapability,
    WorkerType.RELATIONSHIPS: RelationshipsCapability,
    WorkerType.VALIDATOR: ValidatorCapability,
}


def capability_for(worker_type: WorkerType | str) -> WorkerCapability | None:
    wt = worker_type if isinstance(worker_type, WorkerType) else WorkerType(worker_type)
    cls = CAPABILITIES.get(wt)
    if cls is None:
        return None
    return cls()


def supported_worker_types() -> list[str]:
    return [wt.value for wt in CAPABILITIES]


__all__ = [
    "CAPABILITIES",
    "capability_for",
    "supported_worker_types",
]
