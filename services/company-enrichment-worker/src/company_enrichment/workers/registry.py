"""Worker type registry for the multi-worker OSINT expansion.

Every enrichment capability is an independent worker type. A pod runs one type
(or a small `core` alias that mirrors the legacy pipeline). The registry maps a
configured worker type to its NATS consumer filter, request subjects, and the
capability callable that processes a directive.
"""
from __future__ import annotations

from enum import StrEnum

from company_enrichment.events.graph_contracts import (
    worker_directive_subject,
    worker_result_subject,
)


class WorkerType(StrEnum):
    ORCHESTRATOR = "orchestrator"
    REGISTRY = "registry"
    DOMAIN = "domain"
    BBOT = "bbot"
    SPIDERFOOT = "spiderfoot"
    SOCIAL = "social"
    CONTACTS = "contacts"
    FINANCIAL = "financial"
    PEOPLE = "people"
    TECH = "tech"
    RELATIONSHIPS = "relationships"
    VALIDATOR = "validator"
    PERSISTER = "persister"


#: Worker types that consume company-level directives (entity_key == company).
#: Must cover every worker the CompanySeedPlanner seeds at depth 0.
COMPANY_SCOPE_WORKERS = {
    WorkerType.REGISTRY,
    WorkerType.DOMAIN,
    WorkerType.CONTACTS,
    WorkerType.TECH,
    WorkerType.FINANCIAL,
}

#: Worker types that consume arbitrary entity-level directives (domain, email, person...).
ENTITY_SCOPE_WORKERS = {
    WorkerType.BBOT,
    WorkerType.SPIDERFOOT,
    WorkerType.SOCIAL,
    WorkerType.CONTACTS,
    WorkerType.RELATIONSHIPS,
    WorkerType.PEOPLE,
    WorkerType.TECH,
}

#: Worker types that are allowed to be scheduled as follow-up (non-company-scope).
FOLLOWUP_ALLOWED = ENTITY_SCOPE_WORKERS

#: Leaf entity kinds that never fan out further (terminal relationship targets).
LEAF_ENTITY_KINDS = {"PHONE", "ADDRESS", "TECHNOLOGY", "URL"}

#: Follow-up rules: discovered entity kind -> worker types that may run next.
FOLLOWUP_WORKERS_BY_KIND: dict[str, set[WorkerType]] = {
    # Feature 006 (FR-011): SPIDERFOOT saiu do plano incondicional — roda só
    # como fallback de bbot fraco (graph_director._maybe_spiderfoot_fallback).
    "DOMAIN": {WorkerType.BBOT, WorkerType.TECH, WorkerType.CONTACTS, WorkerType.SOCIAL},
    "URL": {WorkerType.TECH, WorkerType.CONTACTS},
    "EMAIL": {WorkerType.CONTACTS, WorkerType.PEOPLE},
    "PERSON": {WorkerType.SOCIAL, WorkerType.PEOPLE, WorkerType.RELATIONSHIPS},
    "SOCIAL_PROFILE": {WorkerType.SOCIAL, WorkerType.PEOPLE},
    "COMPANY": {WorkerType.REGISTRY, WorkerType.RELATIONSHIPS, WorkerType.FINANCIAL},
}

#: An alias group that mirrors the legacy single-process pipeline.
CORE_ALIAS = {
    WorkerType.ORCHESTRATOR,
    WorkerType.REGISTRY,
    WorkerType.DOMAIN,
    WorkerType.CONTACTS,
    WorkerType.TECH,
    WorkerType.VALIDATOR,
}

#: Worker types that perform network-heavy external calls (provider bound).
HEAVY_WORKERS = {WorkerType.BBOT, WorkerType.SPIDERFOOT, WorkerType.SOCIAL, WorkerType.CONTACTS}

#: Default worker concurrency per type (bounded; provider limits take precedence).
DEFAULT_CONCURRENCY: dict[WorkerType, int] = {
    WorkerType.ORCHESTRATOR: 10,
    WorkerType.REGISTRY: 10,
    WorkerType.DOMAIN: 10,
    WorkerType.BBOT: 2,
    WorkerType.SPIDERFOOT: 1,
    WorkerType.SOCIAL: 8,
    WorkerType.CONTACTS: 8,
    WorkerType.FINANCIAL: 10,
    WorkerType.PEOPLE: 8,
    WorkerType.TECH: 10,
    WorkerType.RELATIONSHIPS: 10,
    WorkerType.VALIDATOR: 10,
    WorkerType.PERSISTER: 10,
}

#: Default NATS consumer name suffix per type.
CONSUMER_NAME: dict[WorkerType, str] = {
    wt: f"enrichment-{wt.value}" for wt in WorkerType
}


def _resolve_alias(value: str | WorkerType) -> list[WorkerType]:
    """Expand a configured WORKER_TYPE value into concrete worker types."""
    if isinstance(value, WorkerType):
        return [value]
    key = value.strip().lower()
    if key == "core":
        return sorted(CORE_ALIAS, key=lambda wt: wt.value)
    try:
        return [WorkerType(key)]
    except ValueError as exc:
        raise ValueError(
            f"unknown worker type {value!r}; allowed: {[w.value for w in WorkerType]} or 'core'"
        ) from exc


def resolve_worker_types(configured: str | list[str]) -> list[WorkerType]:
    """Expand a comma-separated WORKER_TYPE setting into concrete worker types.

    'core' expands to the legacy pipeline set. Empty/missing expands to 'core'
    for backward compatibility with the current deployment.
    """
    if configured is None or configured == "" or configured == []:
        return _resolve_alias("core")
    if isinstance(configured, str):
        parts = [p for p in configured.split(",") if p.strip()]
    else:
        parts = [str(p) for p in configured if str(p).strip()]
    if not parts:
        return _resolve_alias("core")
    resolved: list[WorkerType] = []
    for part in parts:
        for wt in _resolve_alias(part):
            if wt not in resolved:
                resolved.append(wt)
    return resolved


def worker_request_subject(worker_type: WorkerType) -> str:
    return worker_directive_subject(worker_type.value)


def worker_result_subjects(worker_type: WorkerType) -> list[str]:
    return [worker_result_subject(worker_type.value)]
