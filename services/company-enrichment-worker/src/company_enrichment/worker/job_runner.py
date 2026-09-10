"""Job runner: turns a NATS message into a durable, idempotent enrichment run."""
from __future__ import annotations

import asyncio
import json
import time
import uuid

from pydantic import ValidationError

from company_enrichment.config.settings import Settings
from company_enrichment.db.models import JobStatus, OutboxEvent
from company_enrichment.db.repository import EnrichmentRepository
from company_enrichment.events.contracts import (
    CompanyResultEventV1,
    DLQEventV1,
    EnrichmentRequestedV1,
    EnrichmentRequestStatus,
)
from company_enrichment.metrics.metrics import (
    ENRICHMENT_JOB_DURATION,
    ENRICHMENT_JOBS_COMPLETED,
    ENRICHMENT_JOBS_FAILED,
    ENRICHMENT_JOBS_TOTAL,
)
from company_enrichment.models.outputs.results import EnrichmentResult, Firmographics
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.firmographics import FirmographicsProvider
from company_enrichment.services.pipeline import EnrichmentPipeline
from company_enrichment.worker.nats_client import NATSClient

log = get_logger("job_runner")


class JobRunner:
    def __init__(
        self,
        settings: Settings,
        repo: EnrichmentRepository,
        nats: NATSClient,
        pipeline: EnrichmentPipeline,
        firmographics_provider: FirmographicsProvider | None = None,
    ) -> None:
        self._settings = settings
        self._repo = repo
        self._nats = nats
        self._pipeline = pipeline
        self._firmographics = firmographics_provider

    async def handle_message(self, msg) -> None:
        """Process one NATS message. Explicitly ACKs only after durable completion."""
        start = time.monotonic()
        try:
            payload = json.loads(msg.data)
            req = EnrichmentRequestedV1.model_validate(payload)
        except (json.JSONDecodeError, ValidationError) as exc:
            # Malformed / poison message -> DLQ and terminate (no redelivery loop).
            ENRICHMENT_JOBS_TOTAL.labels(status="discarded").inc()
            await self._write_dlq(msg, "INVALID_EVENT", str(exc))
            await self._nats.term(msg)
            return

        ENRICHMENT_JOBS_TOTAL.labels(status="requested").inc()
        await self._run(req, msg)
        ENRICHMENT_JOB_DURATION.observe(time.monotonic() - start)

    async def _run(self, req: EnrichmentRequestedV1, msg) -> None:
        job, created = await self._repo.upsert_job_from_event(
            req.event_id,
            company_id=req.company_id,
            tenant_id=req.tenant_id,
            cnpj=req.cnpj,
            company_name=req.company_name,
            trade_name=req.trade_name,
            address_city=req.address_city,
            address_state=req.address_state,
        )
        if job is None:
            await self._nats.ack(msg)
            return

        # Idempotência: se o job já terminou (COMPLETED/FAILED/DISCARDED/DLQ/PARTIAL),
        # apenas confirma a mensagem — evita redelivery infinito de eventos antigos.
        if job.status in (
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.DISCARDED,
            JobStatus.DLQ,
            JobStatus.PARTIAL,
        ):
            await self._nats.ack(msg)
            return

        acquired = await self._repo.acquire_lease(
            job.id, self._settings.worker_id or "", self._settings.worker_lease_seconds
        )
        if not acquired:
            # Another worker holds a valid lease; leave the message unacked for redelivery
            # once the lease expires (JetStream will redeliver after ack_wait).
            log.info("lease_not_acquired", job_id=str(job.id))
            return

        try:
            firmographics = self._build_firmographics(req)
            if self._firmographics is not None and self._firmographics.enabled:
                enriched = await self._firmographics.lookup(req.cnpj)
                if enriched is not None:
                    firmographics = self._merge_firmographics(firmographics, enriched)
            # Run pipeline as a task while a concurrent heartbeat keeps the lease fresh.
            pipeline_task = asyncio.create_task(self._pipeline.run(firmographics))
            heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(job.id, self._settings.worker_id or "")
            )
            try:
                result = await pipeline_task
            finally:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass
            await self._complete(job.id, req, result)
            ENRICHMENT_JOBS_COMPLETED.inc()
            await self._nats.ack(msg)
            log.info("job_completed", job_id=str(job.id), cnpj=req.cnpj)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            ENRICHMENT_JOBS_FAILED.labels(error_code="PIPELINE").inc()
            await self._repo.mark_failed(job.id, "PIPELINE", str(exc)[:1000])
            await self._publish_result(
                req,
                status=EnrichmentRequestStatus.FAILED,
                error_code="PIPELINE",
                error_message=str(exc)[:1000],
            )
            # Leave unacked so the message is redelivered and retried (at-least-once).
            await self._nats.nack(msg, delay_seconds=5)

    async def _heartbeat_loop(self, job_id: uuid.UUID, worker_id: str) -> None:
        while True:
            await asyncio.sleep(self._settings.worker_heartbeat_seconds)
            try:
                await self._repo.heartbeat(
                    job_id, worker_id, self._settings.worker_lease_seconds
                )
            except Exception:  # noqa: BLE001
                log.warning("heartbeat_failed", job_id=str(job_id))

    async def _complete(
        self, job_id: uuid.UUID, req: EnrichmentRequestedV1, result: EnrichmentResult
    ) -> None:
        result_dict = result.model_dump(mode="json")
        version = await self._repo.next_version(req.company_id)
        result_dict["enrichment_version"] = version
        outbox = OutboxEvent(
            subject=self._settings.subject_completed,
            payload={
                **CompanyResultEventV1(
                    request_event_id=req.event_id,
                    tenant_id=req.tenant_id,
                    company_id=req.company_id,
                    cnpj=req.cnpj,
                    status=EnrichmentRequestStatus.COMPLETED,
                    enrichment_version=version,
                    summary=self._summary(result_dict),
                ).model_dump(mode="json")
            },
            headers={"event_id": str(uuid.uuid4())},
            job_id=job_id,
        )
        job = await self._repo.get_job(job_id)
        if job is None:
            raise RuntimeError("job missing during completion")
        summary = self._summary(result_dict)
        await self._repo.create_enrichment_and_complete(
            job=job, result_dict=result_dict, summary=summary, outbox_event=outbox
        )

    async def _publish_result(
        self,
        req: EnrichmentRequestedV1,
        *,
        status: EnrichmentRequestStatus,
        error_code: str | None = None,
        error_message: str | None = None,
        summary: dict | None = None,
    ) -> None:
        event = CompanyResultEventV1(
            request_event_id=req.event_id,
            tenant_id=req.tenant_id,
            company_id=req.company_id,
            cnpj=req.cnpj,
            status=status,
            error_code=error_code,
            error_message=error_message,
            summary=summary,
        )
        subject = {
            EnrichmentRequestStatus.FAILED: self._settings.subject_failed,
            EnrichmentRequestStatus.PARTIAL: self._settings.subject_partial,
            EnrichmentRequestStatus.DISCARDED: self._settings.subject_discarded,
        }.get(status, self._settings.subject_completed)
        await self._nats.publish(
            subject, json.dumps(event.model_dump(mode="json"), default=str).encode()
        )

    async def _write_dlq(self, msg, code: str, message: str) -> None:
        try:
            payload = json.loads(msg.data)
        except Exception:  # noqa: BLE001
            payload = {"raw": msg.data.decode(errors="replace")}
        event = DLQEventV1(
            subject=self._settings.subject_requested,
            payload=payload,
            consumer_seq=getattr(msg, "metadata", None).sequence.consumer if getattr(msg, "metadata", None) else None,
            error_code=code,
            error_message=message,
        )
        await self._nats.publish(
            self._settings.subject_dlq,
            json.dumps(event.model_dump(mode="json"), default=str).encode(),
        )

    @staticmethod
    def _build_firmographics(req: EnrichmentRequestedV1) -> Firmographics:
        return Firmographics(
            legal_name=req.company_name,
            trade_name=req.trade_name,
            cnpj=req.cnpj,
            city=req.address_city,
            state=req.address_state,
        )

    @staticmethod
    def _merge_firmographics(base: Firmographics, enriched: Firmographics) -> Firmographics:
        """Warehouse values win; fall back to the request-provided values."""
        merged = base.model_dump()
        for key, value in enriched.model_dump().items():
            if value not in (None, "", []):
                merged[key] = value
        return Firmographics(**merged)

    @staticmethod
    def _summary(result_dict: dict) -> dict:
        return {
            "domain": result_dict.get("domain", {}).get("domain"),
            "website_active": bool(result_dict.get("domain", {}).get("https")),
            "corporate_email": bool(
                result_dict.get("digital_presence", {}).get("corporate_email")
            ),
            "launch_velocity": result_dict.get("launch_velocity", {}).get("score"),
            "operational_readiness": result_dict.get("operational_readiness", {}).get("score"),
            "commercial_potential": result_dict.get("commercial_potential", {}).get("score"),
            "tech_count": len(result_dict.get("technologies", []) or []),
        }
