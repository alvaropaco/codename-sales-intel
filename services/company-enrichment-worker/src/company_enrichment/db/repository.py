"""Repository for enrichment jobs, leases, enrichments, and outbox."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from company_enrichment.db.models import CompanyEnrichment, EnrichmentJob, JobStatus, OutboxEvent


def _now() -> datetime:
    return datetime.now(UTC)


class DuplicateEventError(Exception):
    """Raised when an event_id already maps to an existing job."""


@dataclass
class AcquireResult:
    acquired: bool
    job: EnrichmentJob | None = None


class EnrichmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def upsert_job_from_event(self, event_id: uuid.UUID, **fields) -> tuple[EnrichmentJob, bool]:
        """Idempotently create a job for event_id. Returns (job, created).

        Uses INSERT ... ON CONFLICT DO NOTHING on event_id unique constraint so
        concurrent workers do not duplicate a job row.
        """
        stmt = pg_insert(EnrichmentJob).values(
            event_id=event_id,
            company_id=fields.get("company_id"),
            tenant_id=fields.get("tenant_id"),
            cnpj=fields.get("cnpj", ""),
            company_name=fields.get("company_name"),
            trade_name=fields.get("trade_name"),
            address_city=fields.get("address_city"),
            address_state=fields.get("address_state"),
            status=JobStatus.REQUESTED,
            attempt=0,
        ).on_conflict_do_nothing(index_elements=["event_id"])
        result = await self._s.execute(stmt)
        created = result.rowcount == 1
        job = await self._get_job_by_event(event_id)
        return job, created

    async def _get_job_by_event(self, event_id: uuid.UUID) -> EnrichmentJob | None:
        res = await self._s.execute(
            select(EnrichmentJob).where(EnrichmentJob.event_id == event_id)
        )
        return res.scalar_one_or_none()

    async def get_job(self, job_id: uuid.UUID) -> EnrichmentJob | None:
        res = await self._s.execute(select(EnrichmentJob).where(EnrichmentJob.id == job_id))
        return res.scalar_one_or_none()

    async def acquire_lease(self, job_id: uuid.UUID, worker_id: str, lease_seconds: int) -> bool:
        """Atomically acquire a lease on the job unless the lease is still valid for another worker."""
        from datetime import timedelta

        now = _now()
        expires = now + timedelta(seconds=lease_seconds)
        # Only take if not leased, or lease already expired (stale takeover).
        stmt = (
            update(EnrichmentJob)
            .where(
                EnrichmentJob.id == job_id,
                EnrichmentJob.status.notin_(
                    [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DISCARDED, JobStatus.DLQ]
                ),
                (
                    (EnrichmentJob.lease_expires_at.is_(None))
                    | (EnrichmentJob.lease_expires_at < now)
                ),
            )
            .values(
                worker_id=worker_id,
                started_at=now,
                heartbeat_at=now,
                lease_expires_at=expires,
                status=JobStatus.RUNNING,
                attempt=EnrichmentJob.attempt + 1,
            )
        )
        res = await self._s.execute(stmt)
        await self._s.commit()
        return (res.rowcount or 0) > 0

    async def heartbeat(self, job_id: uuid.UUID, worker_id: str, lease_seconds: int) -> None:
        from datetime import timedelta

        now = _now()
        expires = now + timedelta(seconds=lease_seconds)
        await self._s.execute(
            update(EnrichmentJob)
            .where(EnrichmentJob.id == job_id, EnrichmentJob.worker_id == worker_id)
            .values(heartbeat_at=now, lease_expires_at=expires)
        )
        await self._s.commit()

    async def mark_failed(self, job_id: uuid.UUID, code: str, message: str) -> None:
        await self._s.execute(
            update(EnrichmentJob)
            .where(EnrichmentJob.id == job_id)
            .values(status=JobStatus.FAILED, error_code=code, error_message=message, completed_at=_now())
        )
        await self._s.commit()

    async def mark_discarded(self, job_id: uuid.UUID, code: str, message: str) -> None:
        await self._s.execute(
            update(EnrichmentJob)
            .where(EnrichmentJob.id == job_id)
            .values(status=JobStatus.DISCARDED, error_code=code, error_message=message, completed_at=_now())
        )
        await self._s.commit()

    async def upsert_outbox(self, event: OutboxEvent) -> None:
        self._s.add(event)

    async def create_enrichment_and_complete(
        self,
        *,
        job: EnrichmentJob,
        result_dict: dict,
        summary: dict | None,
        outbox_event: OutboxEvent,
    ) -> None:
        """Within a single transaction: save enrichment, mark job COMPLETED, create outbox event."""
        enrichment = CompanyEnrichment(
            company_id=job.company_id,
            tenant_id=job.tenant_id,
            cnpj=job.cnpj,
            enrichment_version=result_dict.get("enrichment_version", 1),
            job_id=job.id,
            result=result_dict,
            summary=summary,
            firmographics=result_dict.get("firmographics"),
            domain=result_dict.get("domain"),
            business_profile=result_dict.get("business_profile"),
            digital_presence=result_dict.get("digital_presence"),
            technologies=result_dict.get("technologies"),
            contacts=result_dict.get("contacts"),
            launch_velocity=result_dict.get("launch_velocity"),
            operational_readiness=result_dict.get("operational_readiness"),
            commercial_potential=result_dict.get("commercial_potential"),
            buying_intent=result_dict.get("buying_intent"),
            ai_analysis=result_dict.get("ai_analysis"),
            evidence=result_dict.get("evidence"),
            provider_statistics=result_dict.get("provider_statistics"),
        )
        self._s.add(enrichment)
        self._s.add(outbox_event)
        job.status = JobStatus.COMPLETED
        job.completed_at = _now()
        job.worker_id = None
        job.lease_expires_at = None
        await self._s.commit()

    async def next_version(self, company_id: uuid.UUID) -> int:
        res = await self._s.execute(
            select(CompanyEnrichment.enrichment_version)
            .where(CompanyEnrichment.company_id == company_id)
            .order_by(CompanyEnrichment.enrichment_version.desc())
            .limit(1)
        )
        last = res.scalar_one_or_none()
        return (last or 0) + 1

    async def list_unpublished_outbox(self, limit: int = 100) -> list[OutboxEvent]:
        res = await self._s.execute(
            select(OutboxEvent)
            .where(OutboxEvent.processed.is_(False))
            .order_by(OutboxEvent.created_at)
            .limit(limit)
        )
        return list(res.scalars().all())

    async def mark_outbox_published(self, event_id: uuid.UUID) -> None:
        await self._s.execute(
            update(OutboxEvent)
            .where(OutboxEvent.id == event_id)
            .values(processed=True, published_at=_now())
        )
        await self._s.commit()
