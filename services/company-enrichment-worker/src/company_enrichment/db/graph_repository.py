"""Repository for the entity graph: cases, worker directives, entities, facts.

All writes are idempotent (unique keys with ON CONFLICT DO NOTHING / update) so
at-least-once redelivery cannot duplicate graph state.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from company_enrichment.db.graph_models import (
    CaseStatus,
    EnrichmentCase,
    EnrichmentFact,
    EnrichmentWorkerJob,
    Entity,
    EntityRelation,
    WorkerDirectiveStatus,
)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class DirectiveUpsert:
    created: bool
    job: EnrichmentWorkerJob | None = None


@dataclass
class EntityUpsert:
    created: bool
    entity: Entity | None = None


class GraphRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    # --- Resiliência (feature 006): órfãs COLLECTED ---
    async def list_collected_orphans(self, *, min_age_s: int, limit: int = 200) -> list:
        """Diretivas COLLECTED cujo ingest se perdeu há mais de `min_age_s`.

        O worker coletou os dados e publicou o ingest, mas a persistência não
        concluiu a diretiva — sem re-drive o caso nunca finaliza.
        """
        cutoff = datetime.now(UTC) - timedelta(seconds=min_age_s)
        result = await self._s.execute(
            select(EnrichmentWorkerJob)
            .where(
                EnrichmentWorkerJob.status == WorkerDirectiveStatus.COLLECTED,
                EnrichmentWorkerJob.updated_at < cutoff,
            )
            .order_by(EnrichmentWorkerJob.updated_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def reset_directive_to_requested(self, job_id: uuid.UUID) -> None:
        """Volta a diretiva para REQUESTED para re-execução pelo worker."""
        await self._s.execute(
            update(EnrichmentWorkerJob)
            .where(EnrichmentWorkerJob.id == job_id)
            .values(status=WorkerDirectiveStatus.REQUESTED)
        )

    # --- Cases ---
    async def create_case(
        self,
        *,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        cnpj: str,
        max_depth: int = 2,
        max_directives: int = 50,
        max_facts: int = 200,
    ) -> EnrichmentCase:
        stmt = (
            pg_insert(EnrichmentCase)
            .values(
                request_event_id=request_event_id,
                tenant_id=tenant_id,
                company_id=company_id,
                cnpj=cnpj,
                max_depth=max_depth,
                max_directives=max_directives,
                max_facts=max_facts,
                status=CaseStatus.OPEN,
            )
            .on_conflict_do_nothing(index_elements=["request_event_id"])
        )
        await self._s.execute(stmt)
        await self._s.flush()
        return await self.get_case_by_request(request_event_id)  # type: ignore[return-value]

    async def get_case_by_request(self, request_event_id: uuid.UUID) -> EnrichmentCase | None:
        res = await self._s.execute(
            select(EnrichmentCase).where(EnrichmentCase.request_event_id == request_event_id)
        )
        return res.scalar_one_or_none()

    async def get_case(self, case_id: uuid.UUID) -> EnrichmentCase | None:
        res = await self._s.execute(select(EnrichmentCase).where(EnrichmentCase.id == case_id))
        return res.scalar_one_or_none()

    async def case_pending_inc(self, case_id: uuid.UUID, by: int = 1) -> None:
        await self._s.execute(
            update(EnrichmentCase)
            .where(EnrichmentCase.id == case_id)
            .values(pending=EnrichmentCase.pending + by)
        )

    async def case_pending_dec(self, case_id: uuid.UUID) -> None:
        """Decrement pending exactly once per directive outcome (guard >= 0)."""
        await self._s.execute(
            update(EnrichmentCase)
            .where(EnrichmentCase.id == case_id, EnrichmentCase.pending > 0)
            .values(pending=EnrichmentCase.pending - 1)
        )

    async def directives_inc(self, case_id: uuid.UUID, by: int = 1) -> None:
        await self._s.execute(
            update(EnrichmentCase)
            .where(EnrichmentCase.id == case_id)
            .values(directives_total=EnrichmentCase.directives_total + by)
        )

    async def list_directives(
        self, case_id: uuid.UUID, limit: int = 500
    ) -> list[EnrichmentWorkerJob]:
        res = await self._s.execute(
            select(EnrichmentWorkerJob)
            .where(EnrichmentWorkerJob.case_id == case_id)
            .order_by(EnrichmentWorkerJob.created_at)
            .limit(limit)
        )
        return list(res.scalars().all())

    async def list_open_cases(self, limit: int = 100) -> list[EnrichmentCase]:
        res = await self._s.execute(
            select(EnrichmentCase)
            .where(EnrichmentCase.status.in_([CaseStatus.OPEN, CaseStatus.PENDING_CHILD]))
            .order_by(EnrichmentCase.updated_at)
            .limit(limit)
        )
        return list(res.scalars().all())

    # --- Worker directives ---
    async def upsert_directive(
        self,
        *,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        worker_type: str,
        target: str,
        entity_type: str | None,
        entity_key: str,
        target_company_id: uuid.UUID | None,
        depth: int,
        hints: dict | None = None,
    ) -> DirectiveUpsert:
        stmt = (
            pg_insert(EnrichmentWorkerJob)
            .values(
                case_id=case_id,
                request_event_id=request_event_id,
                tenant_id=tenant_id,
                company_id=company_id,
                worker_type=worker_type,
                target=target,
                entity_type=entity_type,
                entity_key=entity_key,
                target_company_id=target_company_id,
                depth=depth,
                hints=hints,
                status=WorkerDirectiveStatus.REQUESTED,
            )
            .on_conflict_do_nothing(index_elements=["case_id", "worker_type", "entity_key"])
        )
        res = await self._s.execute(stmt)
        created = (res.rowcount or 0) > 0
        job = await self._get_directive(case_id, worker_type, entity_key)
        return DirectiveUpsert(created=created, job=job)

    async def _get_directive(
        self, case_id: uuid.UUID, worker_type: str, entity_key: str
    ) -> EnrichmentWorkerJob | None:
        res = await self._s.execute(
            select(EnrichmentWorkerJob).where(
                EnrichmentWorkerJob.case_id == case_id,
                EnrichmentWorkerJob.worker_type == worker_type,
                EnrichmentWorkerJob.entity_key == entity_key,
            )
        )
        return res.scalar_one_or_none()

    async def get_directive_by_id(self, job_id: uuid.UUID) -> EnrichmentWorkerJob | None:
        res = await self._s.execute(
            select(EnrichmentWorkerJob).where(EnrichmentWorkerJob.id == job_id)
        )
        return res.scalar_one_or_none()

    async def acquire_directive_lease(
        self, job_id: uuid.UUID, worker_id: str, lease_seconds: int
    ) -> bool:
        from datetime import timedelta

        now = _now()
        expires = now + timedelta(seconds=lease_seconds)
        stmt = (
            update(EnrichmentWorkerJob)
            .where(
                EnrichmentWorkerJob.id == job_id,
                EnrichmentWorkerJob.status.notin_(
                    [
                        WorkerDirectiveStatus.COLLECTED,
                        WorkerDirectiveStatus.COMPLETED,
                        WorkerDirectiveStatus.FAILED,
                    ]
                ),
                (
                    (EnrichmentWorkerJob.lease_expires_at.is_(None))
                    | (EnrichmentWorkerJob.lease_expires_at < now)
                ),
            )
            .values(
                worker_id=worker_id,
                started_at=now,
                heartbeat_at=now,
                lease_expires_at=expires,
                status=WorkerDirectiveStatus.RUNNING,
                attempt=EnrichmentWorkerJob.attempt + 1,
            )
        )
        res = await self._s.execute(stmt)
        await self._s.commit()
        return (res.rowcount or 0) > 0

    async def directive_heartbeat(self, job_id: uuid.UUID, worker_id: str, lease_seconds: int) -> None:
        from datetime import timedelta

        now = _now()
        expires = now + timedelta(seconds=lease_seconds)
        await self._s.execute(
            update(EnrichmentWorkerJob)
            .where(
                EnrichmentWorkerJob.id == job_id,
                EnrichmentWorkerJob.worker_id == worker_id,
            )
            .values(heartbeat_at=now, lease_expires_at=expires)
        )
        await self._s.commit()

    async def mark_directive_collected(self, job_id: uuid.UUID) -> None:
        """Mark a directive as collected (data handed off to the ingest queue).

        The directive stays `COLLECTED` until the persister worker persists its
        outcome and flips it to `COMPLETED`.
        """
        await self._s.execute(
            update(EnrichmentWorkerJob)
            .where(EnrichmentWorkerJob.id == job_id)
            .values(status=WorkerDirectiveStatus.COLLECTED)
        )

    async def mark_directive_completed(self, job_id: uuid.UUID) -> bool:
        """Transition a directive to COMPLETED; returns True only on transition.

        Guarded so concurrent persister replicas processing a duplicate ingest
        message decrement the case's pending count exactly once.
        """
        res = await self._s.execute(
            update(EnrichmentWorkerJob)
            .where(
                EnrichmentWorkerJob.id == job_id,
                EnrichmentWorkerJob.status.notin_(
                    [WorkerDirectiveStatus.COMPLETED, WorkerDirectiveStatus.FAILED]
                ),
            )
            .values(
                status=WorkerDirectiveStatus.COMPLETED,
                completed_at=_now(),
                worker_id=None,
                lease_expires_at=None,
            )
        )
        return (res.rowcount or 0) > 0

    async def mark_directive_failed(self, job_id: uuid.UUID, code: str, message: str) -> None:
        await self._s.execute(
            update(EnrichmentWorkerJob)
            .where(EnrichmentWorkerJob.id == job_id)
            .values(
                status=WorkerDirectiveStatus.FAILED,
                error_code=code,
                error_message=message,
                completed_at=_now(),
                worker_id=None,
                lease_expires_at=None,
            )
        )

    # --- Entities ---
    async def upsert_entity(
        self,
        *,
        entity_type: str,
        entity_key: str,
        label: str | None = None,
        meta: dict | None = None,
    ) -> EntityUpsert:
        stmt = (
            pg_insert(Entity)
            .values(entity_type=entity_type, entity_key=entity_key, label=label, meta=meta)
            .on_conflict_do_nothing(index_elements=["entity_type", "entity_key"])
        )
        res = await self._s.execute(stmt)
        created = (res.rowcount or 0) > 0
        entity = await self._get_entity(entity_type, entity_key)
        return EntityUpsert(created=created, entity=entity)

    async def _get_entity(self, entity_type: str, entity_key: str) -> Entity | None:
        res = await self._s.execute(
            select(Entity).where(
                Entity.entity_type == entity_type, Entity.entity_key == entity_key
            )
        )
        return res.scalar_one_or_none()

    # --- Relations ---
    async def upsert_relation(
        self,
        *,
        source_entity_id: uuid.UUID,
        target_entity_id: uuid.UUID,
        relation_type: str,
        confidence: float = 0.5,
        source: dict | None = None,
    ) -> bool:
        stmt = (
            pg_insert(EntityRelation)
            .values(
                source_entity_id=source_entity_id,
                target_entity_id=target_entity_id,
                relation_type=relation_type,
                confidence=confidence,
                source=source,
            )
            .on_conflict_do_nothing(
                index_elements=["source_entity_id", "target_entity_id", "relation_type"]
            )
        )
        res = await self._s.execute(stmt)
        await self._s.flush()
        return (res.rowcount or 0) > 0

    # --- Facts ---
    async def upsert_fact(
        self,
        *,
        entity_id: uuid.UUID,
        fact_key: str,
        value: dict | None,
        confidence: float = 0.5,
        source: dict | None = None,
    ) -> bool:
        stmt = (
            pg_insert(EnrichmentFact)
            .values(
                entity_id=entity_id,
                fact_key=fact_key,
                value=value,
                confidence=confidence,
                source=source,
            )
            .on_conflict_do_update(
                index_elements=["entity_id", "fact_key"],
                set_={
                    "value": value,
                    "confidence": confidence,
                    "source": source,
                    "observed_at": _now(),
                },
            )
        )
        res = await self._s.execute(stmt)
        await self._s.flush()
        return (res.rowcount or 0) > 0

    async def count_case_facts(self, case_id: uuid.UUID) -> int:
        return 0  # facts are global per entity; case budgets tracked by composer

    # --- finalization / aggregation helpers ---
    async def mark_case_terminated(
        self, case_id: uuid.UUID, status: CaseStatus, error_code: str | None = None,
        error_message: str | None = None,
    ) -> bool:
        """Transition a case to a terminal status; returns True only on transition.

        Guarded so concurrent finalizers (e.g. a failure path in a collection
        worker racing the persister) never emit a duplicate profile/event.
        """
        res = await self._s.execute(
            update(EnrichmentCase)
            .where(
                EnrichmentCase.id == case_id,
                EnrichmentCase.status.notin_(
                    [CaseStatus.COMPLETED, CaseStatus.PARTIAL, CaseStatus.FAILED]
                ),
            )
            .values(
                status=status,
                completed_at=_now(),
                error_code=error_code,
                error_message=error_message,
            )
        )
        return (res.rowcount or 0) > 0

    async def next_enrichment_version(self, company_id: uuid.UUID) -> int:
        """Next version number for a company (graph mode), reusing the legacy table."""
        from company_enrichment.db.models import CompanyEnrichment

        res = await self._s.execute(
            select(CompanyEnrichment.enrichment_version)
            .where(CompanyEnrichment.company_id == company_id)
            .order_by(CompanyEnrichment.enrichment_version.desc())
            .limit(1)
        )
        last = res.scalar_one_or_none()
        return (last or 0) + 1

    async def create_enrichment(
        self,
        *,
        company_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        cnpj: str,
        result: dict,
        summary: dict,
    ) -> None:
        """Persist an immutable, versioned company profile (graph mode).

        Reuses the legacy `company_enrichments` table so downstream consumers
        see the same versioned history contract regardless of worker mode.
        """
        from company_enrichment.db.models import CompanyEnrichment

        version = await self.next_enrichment_version(company_id)
        row = CompanyEnrichment(
            company_id=company_id,
            tenant_id=tenant_id,
            cnpj=cnpj,
            enrichment_version=version,
            job_id=None,  # graph mode has no single legacy job row
            result=result,
            summary=summary,
            firmographics=result.get("firmographics") or None,
            domain=result.get("domain") or None,
            digital_presence=result.get("digital_presence") or None,
            technologies=result.get("technologies") or None,
            contacts=result.get("contact_points") or None,
            ai_analysis=result.get("ai_analysis") or None,
        )
        self._s.add(row)
        await self._s.flush()

    async def list_entity_ids_for_keys(
        self, pairs: list[tuple[str, str]], limit: int = 1000
    ) -> dict[tuple[str, str], str]:
        """Return {(type, key): entity_id} for the given type/key pairs."""
        if not pairs:
            return {}
        unique = list(dict.fromkeys(pairs))
        res = {}
        for entity_type, entity_key in unique:
            entity = await self._get_entity(entity_type, entity_key)
            if entity is not None:
                res[(entity_type, entity_key)] = str(entity.id)
                if len(res) >= limit:
                    break
        return res

    async def list_facts_for_entity_ids(
        self, entity_ids: list[str], limit: int = 2000
    ) -> list[EnrichmentFact]:
        if not entity_ids:
            return []
        res = await self._s.execute(
            select(EnrichmentFact)
            .where(EnrichmentFact.entity_id.in_([uuid.UUID(e) for e in entity_ids]))
            .order_by(EnrichmentFact.updated_at.desc())
            .limit(limit)
        )
        return list(res.scalars().all())

    async def list_relations_for_entity(
        self, entity_id: str, limit: int = 500
    ) -> list[EntityRelation]:
        res = await self._s.execute(
            select(EntityRelation)
            .where(
                (EntityRelation.source_entity_id == uuid.UUID(entity_id))
                | (EntityRelation.target_entity_id == uuid.UUID(entity_id))
            )
            .order_by(EntityRelation.observed_at.desc())
            .limit(limit)
        )
        return list(res.scalars().all())
