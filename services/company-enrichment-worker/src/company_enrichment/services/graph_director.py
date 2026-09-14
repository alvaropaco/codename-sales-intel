"""Graph director: turns directives/discoveries into durable work.

This is the orchestrator-side coordinator. It owns:
  - case creation + seed fan-out on company requests
  - entity-discovered -> guard-check -> follow-up directive scheduling
  - directive execution via the capability registry (with lease + heartbeat)
  - persistence of entities/facts/relations and emission of result events
  - final aggregation and company completion

Every mutation is idempotent (unique keys). Durability comes from the
`enrichment_worker_jobs` row + outbox before ACK. The director serializes per
case with in-process asyncio locks; the DB unique keys are the cross-replica
backstop (at-least-once is expected).
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from company_enrichment.db.graph_models import CaseStatus, EdgeKind, WorkerDirectiveStatus
from company_enrichment.db.graph_repository import GraphRepository
from company_enrichment.events.graph_contracts import (
    EntityDiscoveredV1,
    GraphEntityRef,
    IngestCollectedV1,
    IngestEntity,
    IngestFact,
    IngestRelation,
    WorkerDirectiveRequestedV1,
    WorkerResultEventV1,
    ingest_collected_subject,
)
from company_enrichment.metrics.metrics import (
    ENRICHMENT_CASES_TOTAL,
    ENRICHMENT_DIRECTIVE_DURATION,
    ENRICHMENT_DIRECTIVES_COMPLETED,
    ENRICHMENT_DIRECTIVES_FAILED,
    ENRICHMENT_DIRECTIVES_TOTAL,
    ENRICHMENT_ENTITIES_CREATED,
    ENRICHMENT_ENTITY_DISCOVERED_EVENTS,
    ENRICHMENT_FACTS_WRITTEN,
    ENRICHMENT_GRAPH_GUARD_REJECTIONS,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.firmographics import normalize_cnpj
from company_enrichment.services.graph_planner import CompanySeedPlanner, EnrichmentGraphPlanner
from company_enrichment.workers.capabilities import capability_for
from company_enrichment.workers.capability import (
    CapabilityContext,
    DirectiveOutcome,
    EntityWrite,
    FactWrite,
)
from company_enrichment.workers.registry import (
    COMPANY_SCOPE_WORKERS,
    WorkerType,
    worker_request_subject,
)

log = get_logger("graph_director")


class GraphRunError(Exception):
    pass


class GraphDirector:
    """Coordinates the enrichment graph for cases and executes directives.

    `publish_fn(subject, payload_dict)` emits events (wrapped by the caller,
    typically the outbox publisher). `graph_repo` provides idempotent
    persistence. Used by both the orchestrator worker (case + discovery paths)
    and worker-type pods (directive execution path).
    """

    def __init__(
        self,
        *,
        graph_repo: GraphRepository,
        publish_fn,
        ctx: CapabilityContext,
        max_depth: int = 2,
        max_directives: int = 50,
        max_facts: int = 200,
        worker_id: str = "director",
        lease_seconds: int = 60,
        subject_completed: str = "enrichment.company.completed.v1",
        subject_partial: str = "enrichment.company.partial.v1",
        directive_hard_timeout_seconds: int = 900,
    ) -> None:
        self._repo = graph_repo
        self._publish = publish_fn
        self._ctx = ctx
        self._max_depth = max_depth
        self._max_directives = max_directives
        self._max_facts = max_facts
        self._subject_completed = subject_completed
        self._subject_partial = subject_partial
        self._planner = EnrichmentGraphPlanner(max_depth=max_depth, max_directives=max_directives)
        self._seeder = CompanySeedPlanner()
        self._worker_id = worker_id
        self._lease_seconds = lease_seconds
        self._directive_hard_timeout_seconds = directive_hard_timeout_seconds
        self._locks: dict[uuid.UUID, asyncio.Lock] = {}

    # ---------------------------------------------------------------- requests
    async def on_company_requested(self, req) -> None:
        """Create a case (idempotent) and fan out seed directives."""
        case = await self._repo.create_case(
            request_event_id=req.event_id,
            tenant_id=req.tenant_id,
            company_id=req.company_id,
            cnpj=req.cnpj,
            max_depth=self._max_depth,
            max_directives=self._max_directives,
            max_facts=self._max_facts,
        )
        if case is None:
            return
        ENRICHMENT_CASES_TOTAL.labels(status=case.status).inc()
        async with self._lock_for(case.id):
            await self._seed_case(case, req)

    async def _seed_case(self, case, req) -> None:
        hints = {
            "cnpj": req.cnpj,
            "company_name": req.company_name,
            "trade_name": req.trade_name,
            "city": req.address_city,
            "state": req.address_state,
        }
        for planned in self._seeder.plan_seed(cnpj=req.cnpj, company_id=str(req.company_id)):
            if planned.worker_type not in COMPANY_SCOPE_WORKERS:
                continue
            await self._enqueue_directive(
                case=case,
                request_event_id=req.event_id,
                tenant_id=req.tenant_id,
                company_id=req.company_id,
                worker_type=planned.worker_type,
                entity_type="COMPANY",
                entity_key=planned.entity_key,
                target_company_id=req.company_id,
                target=planned.target,
                depth=0,
                hints=hints,
            )

    # ------------------------------------------------------------ discoveries
    async def on_entity_discovered(self, ev: EntityDiscoveredV1) -> None:
        """Guard-check a discovered entity and schedule legal follow-ups."""
        async with self._lock_for(ev.case_id):
            case = await self._repo.get_case(ev.case_id)
            if case is None or case.status in (CaseStatus.COMPLETED, CaseStatus.FAILED):
                return
            await self._schedule_followups(
                case=case,
                request_event_id=ev.request_event_id,
                tenant_id=ev.tenant_id,
                company_id=ev.company_id,
                entity_type=ev.entity.entity_type,
                entity_key=ev.entity.entity_key,
                depth=ev.depth,
            )

    async def _schedule_followups(
        self,
        *,
        case,
        request_event_id,
        tenant_id,
        company_id,
        entity_type,
        entity_key,
        depth,
    ) -> None:
        """Plan follow-up directives for a discovered entity and enqueue them.

        Idempotent: `enrichment_worker_jobs` unique (case, worker, entity) means
        double scheduling (sync path + the async `entity.discovered` event) never
        duplicates work or pending counts.
        """
        decision = self._planner.decide(
            entity_type=entity_type,
            entity_key=entity_key,
            depth=depth,
            directives_so_far=case.directives_total,
            max_depth=case.max_depth,
            max_directives=case.max_directives,
        )
        if not decision.allowed:
            ENRICHMENT_GRAPH_GUARD_REJECTIONS.labels(
                reason=decision.reason or "UNKNOWN"
            ).inc()
            log.info(
                "guard_rejected", reason=decision.reason,
                entity=entity_key, depth=depth,
            )
            return
        # Enrich follow-up hints with the discovered entity's page facts so the
        # contacts/social/tech workers have real crawled data (graph chain).
        hints: dict = {"operator": entity_key}
        entity = await self._repo._get_entity(entity_type, entity_key)
        if entity is not None:
            facts = await self._repo.list_facts_for_entity_ids([str(entity.id)], limit=50)
            for fact in facts:
                if fact.fact_key in ("page_text", "page_html") and fact.value:
                    hints[fact.fact_key] = fact.value.get("value")
                if fact.fact_key == "website" and fact.value:
                    hints.setdefault("domain", fact.value.get("value"))
        for planned in decision.directives:
            await self._enqueue_directive(
                case=case,
                request_event_id=request_event_id,
                tenant_id=tenant_id,
                company_id=company_id,
                worker_type=planned.worker_type,
                entity_type=planned.entity_type,
                entity_key=planned.entity_key,
                target_company_id=planned.target_company_id,
                target=planned.target,
                depth=planned.depth,
                hints=hints,
            )

    # ------------------------------------------------------------ directives
    async def on_directive_requested(self, directive_event: WorkerDirectiveRequestedV1) -> None:
        """Receive a directive event and execute it (idempotent by job key)."""
        job = await self._find_directive(
            directive_event.case_id,
            directive_event.worker_type,
            directive_event.entity.entity_key,
        )
        if job is None:
            # Directive not yet materialized (e.g. worker pod received before the
            # orchestrator's DB write): recreate via the idempotent upsert.
            await self._upsert_and_run(directive_event)
            return
        await self._run_existing(directive_event, job)

    async def _run_existing(self, directive_event: WorkerDirectiveRequestedV1, job) -> None:
        if job.status in (
            WorkerDirectiveStatus.COLLECTED,
            WorkerDirectiveStatus.COMPLETED,
            WorkerDirectiveStatus.FAILED,
        ):
            return
        acquired = await self._repo.acquire_directive_lease(
            job.id, self._worker_id, self._lease_seconds
        )
        if not acquired:
            log.info("directive_lease_busy", job_id=str(job.id))
            return
        ENRICHMENT_DIRECTIVES_TOTAL.labels(
            worker_type=directive_event.worker_type, status="requested"
        ).inc()
        start = time.monotonic()
        try:
            # Hard backstop: capabilities bound their own subprocess timeouts,
            # but a hung scan (ex.: sf.py com arquivo gigante) nunca retorna.
            # Sem este teto o directive prende o slot — e o caso — para sempre.
            outcome = await asyncio.wait_for(
                self._execute_capability(directive_event, job),
                timeout=self._directive_hard_timeout_seconds,
            )
        except TimeoutError as exc:
            log.warning(
                "directive_hard_timeout", worker_type=directive_event.worker_type,
                entity=directive_event.entity.entity_key, case_id=str(directive_event.case_id),
                timeout_seconds=self._directive_hard_timeout_seconds,
            )
            await self._fail_directive(
                job,
                directive_event,
                "CAPABILITY_TIMEOUT",
                f"capability exceeded {self._directive_hard_timeout_seconds}s hard timeout",
            )
            return
        except Exception as exc:  # noqa: BLE001
            log.exception(
                "directive_failed", worker_type=directive_event.worker_type, error=str(exc)
            )
            await self._fail_directive(
                job,
                directive_event,
                "CAPABILITY_ERROR",
                str(exc)[:1000],
            )
            return
        finally:
            ENRICHMENT_DIRECTIVE_DURATION.labels(
                worker_type=directive_event.worker_type
            ).observe(time.monotonic() - start)

        if outcome.status == "FAILED":
            await self._fail_directive(
                job,
                directive_event,
                outcome.error_code or "FAILED",
                outcome.error_message or "",
            )
            return

        # Collection is done. Hand the collected data to the ingest queue; the
        # dedicated persister worker owns the PostgreSQL write + case completion.
        await self._enqueue_ingest(directive_event, outcome)
        await self._repo.mark_directive_collected(job.id)
        await self._publish_result(
            directive_event, outcome.status,
            summary=outcome.summary, facts_written=len(outcome.facts),
        )
        log.info(
            "directive_collected", worker_type=directive_event.worker_type,
            entity=directive_event.entity.entity_key, case_id=str(directive_event.case_id),
        )

    async def on_ingest_collected(self, ev: IngestCollectedV1) -> None:
        """Persist a collected-data batch (consumed by the persister worker).

        This is the only path that writes entities/facts/relations and completes
        a directive, so collection workers never touch PostgreSQL directly.
        Idempotent: a duplicate ingest for an already-completed directive is a
        no-op (guarded by the atomic COMPLETED transition).
        """
        job = await self._find_directive(ev.case_id, ev.worker_type, ev.entity.entity_key)
        if job is None:
            # Directive row must exist (created at seed). Recreate defensively so
            # an out-of-order ingest never loses collected data.
            upsert = await self._repo.upsert_directive(
                case_id=ev.case_id,
                request_event_id=ev.request_event_id,
                tenant_id=ev.tenant_id,
                company_id=ev.company_id,
                worker_type=ev.worker_type,
                target=ev.target,
                entity_type=ev.entity.entity_type,
                entity_key=ev.entity.entity_key,
                target_company_id=ev.entity.target_company_id,
                depth=ev.depth,
                hints=None,
            )
            job = upsert.job
        if job is None:
            raise GraphRunError(
                f"ingest for unknown directive {ev.worker_type}/{ev.entity.entity_key}"
            )
        if job.status in (WorkerDirectiveStatus.COMPLETED, WorkerDirectiveStatus.FAILED):
            return  # already persisted (or terminal); duplicate ingest no-op

        directive_event = WorkerDirectiveRequestedV1(
            event_id=ev.directive_event_id,
            case_id=ev.case_id,
            request_event_id=ev.request_event_id,
            tenant_id=ev.tenant_id,
            company_id=ev.company_id,
            worker_type=ev.worker_type,
            entity=ev.entity,
            target=ev.target,
            depth=ev.depth,
        )
        outcome = self._outcome_from_ingest(ev)

        await self._persist_outcome(job, directive_event, outcome)
        if await self._repo.mark_directive_completed(job.id):
            await self._repo.case_pending_dec(ev.case_id)
            ENRICHMENT_DIRECTIVES_COMPLETED.labels(worker_type=ev.worker_type).inc()
            log.info(
                "directive_completed", worker_type=ev.worker_type,
                entity=ev.entity.entity_key, case_id=str(ev.case_id),
            )
            # If this was the last pending directive, finalize and aggregate the case.
            await self._maybe_finalize_case(ev.case_id)

    async def _maybe_finalize_case(self, case_id: uuid.UUID) -> None:
        case = await self._repo.get_case(case_id)
        if case is None or case.status in (
            CaseStatus.COMPLETED, CaseStatus.PARTIAL, CaseStatus.FAILED
        ):
            return
        directives = await self._repo.list_directives(case_id)
        pending_now = case.pending
        if pending_now > 0:
            return
        # All directives settled -> aggregate and produce the versioned profile.
        failed_any = any(d.status == "FAILED" for d in directives)
        from company_enrichment.services.graph_aggregator import GraphAggregator

        # The COMPANY entity is keyed by the normalized (digits-only) CNPJ, while
        # the case stores the request's raw CNPJ. Normalize here so finalization
        # finds the entity for formatted inputs like "00.000.000/0001-91".
        company = await self._repo._get_entity(
            "COMPANY", normalize_cnpj(case.cnpj) or case.cnpj
        )
        if company is None:
            await self._repo.mark_case_terminated(
                case_id, CaseStatus.FAILED,
                "NO_COMPANY_ENTITY", "company entity not found",
            )
            return
        facts = await self._repo.list_facts_for_entity_ids([str(company.id)])
        relations = await self._repo.list_relations_for_entity(str(company.id))
        labels = {
            str(company.id): company.label or company.entity_key,
        }
        for rel in relations:
            labels.setdefault(str(rel.source_entity_id), str(rel.source_entity_id))
            labels.setdefault(str(rel.target_entity_id), str(rel.target_entity_id))
        result, summary = GraphAggregator(
            facts=facts, entity_labels=labels, relations=relations
        ).compose()

        terminal = CaseStatus.PARTIAL if failed_any else CaseStatus.COMPLETED
        if not await self._repo.mark_case_terminated(case_id, terminal):
            return  # another finalizer won the transition; skip duplicate work
        # Persist the immutable, versioned profile (reuses company_enrichments).
        await self._repo.create_enrichment(
            company_id=case.company_id,
            tenant_id=case.tenant_id,
            cnpj=case.cnpj,
            result=result,
            summary=summary,
        )
        await self._emit_company_result(case, result, summary, terminal)
        terminal_status = terminal.value if hasattr(terminal, "value") else str(terminal)
        ENRICHMENT_CASES_TOTAL.labels(status=terminal_status).inc()

    async def _emit_company_result(
        self, case, result: dict, summary: dict, terminal
    ) -> None:
        from company_enrichment.events.contracts import (
            CompanyResultEventV1,
            EnrichmentRequestStatus,
        )

        status = (
            EnrichmentRequestStatus.PARTIAL
            if terminal.value == CaseStatus.PARTIAL.value
            else EnrichmentRequestStatus.COMPLETED
        )
        event = CompanyResultEventV1(
            request_event_id=case.request_event_id,
            tenant_id=case.tenant_id,
            company_id=case.company_id,
            cnpj=case.cnpj,
            status=status,
            summary=summary,
        )
        subject = (
            self._subject_completed
            if status == EnrichmentRequestStatus.COMPLETED
            else self._subject_partial
        )
        await self._publish(subject, event.model_dump(mode="json"))

    async def _fail_directive(self, job, directive_event, code: str, message: str) -> None:
        await self._repo.mark_directive_failed(job.id, code, message)
        await self._repo.case_pending_dec(directive_event.case_id)
        ENRICHMENT_DIRECTIVES_FAILED.labels(
            worker_type=directive_event.worker_type, error_code=code
        ).inc()
        await self._publish_result(directive_event, "FAILED", code=code, message=message)
        # If this was the last pending directive, finalize (PARTIAL) so the case
        # never hangs OPEN after its final directive fails.
        await self._maybe_finalize_case(directive_event.case_id)

    async def _upsert_and_run(self, directive_event: WorkerDirectiveRequestedV1) -> None:
        upsert = await self._repo.upsert_directive(
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            worker_type=directive_event.worker_type,
            target=directive_event.target,
            entity_type=directive_event.entity.entity_type,
            entity_key=directive_event.entity.entity_key,
            target_company_id=directive_event.entity.target_company_id,
            depth=directive_event.depth,
            hints=directive_event.hints,
        )
        if upsert.created:
            await self._repo.case_pending_inc(directive_event.case_id)
            await self._repo.directives_inc(directive_event.case_id)
            ENRICHMENT_DIRECTIVES_TOTAL.labels(
                worker_type=directive_event.worker_type, status="requested"
            ).inc()
        await self._run_existing(directive_event, upsert.job)

    async def _execute_capability(self, directive_event, job) -> Any:
        cap = capability_for(directive_event.worker_type)
        if cap is None:
            raise GraphRunError(f"no capability for {directive_event.worker_type}")
        budget = directive_event.budget
        return await cap.run(
            directive_id=directive_event.event_id,
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            entity=directive_event.entity,
            target=directive_event.target,
            hints=directive_event.hints,
            depth=directive_event.depth,
            budget_max_facts=budget.max_facts,
            ctx=self._ctx,
        )

    # ---------------------------------------------------------------- persist
    async def _persist_outcome(self, job, directive_event, outcome) -> None:
        created_keys: set[tuple[str, str]] = set()
        for fact in outcome.facts:
            up = await self._repo.upsert_entity(
                entity_type=fact.entity_type,
                entity_key=fact.entity_key,
                label=fact.entity_key,
            )
            if up.created and up.entity is not None:
                created_keys.add((fact.entity_type, fact.entity_key))
                ENRICHMENT_ENTITIES_CREATED.labels(entity_type=fact.entity_type).inc()
            if up.entity is None:
                continue
            await self._repo.upsert_fact(
                entity_id=up.entity.id,
                fact_key=fact.fact_key,
                value=fact.value,
                confidence=fact.confidence,
                source=fact.source,
            )
            ENRICHMENT_FACTS_WRITTEN.labels(entity_type=fact.entity_type).inc()

        operator = await self._repo._get_entity(
            directive_event.entity.entity_type, directive_event.entity.entity_key
        )
        for ent in outcome.entities:
            up = await self._repo.upsert_entity(
                entity_type=ent.entity_type,
                entity_key=ent.entity_key,
                label=ent.label,
                meta=ent.meta,
            )
            if up.created and up.entity is not None:
                created_keys.add((ent.entity_type, ent.entity_key))
                ENRICHMENT_ENTITIES_CREATED.labels(entity_type=ent.entity_type).inc()
            if (
                up.entity is not None
                and operator is not None
                and ent.relation_type is not None
            ):
                await self._repo.upsert_relation(
                    source_entity_id=operator.id,
                    target_entity_id=up.entity.id,
                    relation_type=ent.relation_type.value,
                    confidence=ent.confidence,
                    source=ent.meta or None,
                )
            # Emit discovery + schedule follow-ups for every entity this
            # directive produced for THIS case, regardless of whether the global
            # entity already exists (entities are deduplicated across cases, so
            # a re-seen domain must still trigger its per-case OSINT/social
            # chain). Follow-up enqueue is idempotent per (case, worker, entity),
            # so re-scheduling is safe.
            if ent.emit_discovery:
                ENRICHMENT_ENTITY_DISCOVERED_EVENTS.inc()
                await self._emit_entity_discovered(directive_event, ent)

        for src, dst, edge, conf in outcome.relations:
            await self._emit_relation_signal(directive_event, src, dst, edge, conf)

    async def _enqueue_ingest(self, directive_event: WorkerDirectiveRequestedV1, outcome: DirectiveOutcome) -> None:
        """Publish the collected outcome to the ingest queue for the persister."""
        event = IngestCollectedV1(
            directive_event_id=directive_event.event_id,
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            worker_type=directive_event.worker_type,
            entity=directive_event.entity,
            target=directive_event.target,
            depth=directive_event.depth,
            status=outcome.status,
            facts=[
                IngestFact(
                    entity_type=f.entity_type,
                    entity_key=f.entity_key,
                    fact_key=f.fact_key,
                    value=f.value,
                    confidence=f.confidence,
                    source=f.source,
                )
                for f in outcome.facts
            ],
            entities=[
                IngestEntity(
                    entity_type=e.entity_type,
                    entity_key=e.entity_key,
                    label=e.label,
                    relation_type=e.relation_type.value if e.relation_type else None,
                    confidence=e.confidence,
                    meta=e.meta,
                    emit_discovery=e.emit_discovery,
                )
                for e in outcome.entities
            ],
            relations=[
                IngestRelation(
                    source=src, target=dst, relation_type=edge.value, confidence=conf
                )
                for src, dst, edge, conf in outcome.relations
            ],
            summary=outcome.summary,
            error_code=outcome.error_code,
            error_message=outcome.error_message,
        )
        await self._publish(
            ingest_collected_subject(), event.model_dump(mode="json")
        )

    def _outcome_from_ingest(self, ev: IngestCollectedV1) -> DirectiveOutcome:
        """Reconstruct a DirectiveOutcome from a queued ingest payload."""
        return DirectiveOutcome(
            status=ev.status,
            facts=[
                FactWrite(
                    entity_type=f.entity_type,
                    entity_key=f.entity_key,
                    fact_key=f.fact_key,
                    value=f.value,
                    confidence=f.confidence,
                    source=f.source,
                )
                for f in ev.facts
            ],
            entities=[
                EntityWrite(
                    entity_type=e.entity_type,
                    entity_key=e.entity_key,
                    label=e.label,
                    relation_type=EdgeKind(e.relation_type) if e.relation_type else None,
                    confidence=e.confidence,
                    meta=e.meta,
                    emit_discovery=e.emit_discovery,
                )
                for e in ev.entities
            ],
            relations=[
                (r.source, r.target, EdgeKind(r.relation_type), r.confidence)
                for r in ev.relations
            ],
            summary=ev.summary,
            error_code=ev.error_code,
            error_message=ev.error_message,
        )

    async def _emit_entity_discovered(self, directive_event, ent) -> None:
        event = EntityDiscoveredV1(
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            entity=GraphEntityRef(
                entity_type=ent.entity_type, entity_key=ent.entity_key, label=ent.label
            ),
            depth=min(directive_event.depth + 1, self._max_depth + 1),
            confidence=ent.confidence,
            source=ent.meta,
        )
        await self._publish("enrichment.entity.discovered.v1", event.model_dump(mode="json"))
        # Schedule follow-ups synchronously too: the async event may be consumed
        # only after this directive's case is finalized (pending==0), which would
        # lose the graph chain. Idempotent enqueue makes the duplicate-safe.
        case = await self._repo.get_case(directive_event.case_id)
        if case is not None and case.status not in (CaseStatus.COMPLETED, CaseStatus.FAILED):
            await self._schedule_followups(
                case=case,
                request_event_id=directive_event.request_event_id,
                tenant_id=directive_event.tenant_id,
                company_id=directive_event.company_id,
                entity_type=ent.entity_type,
                entity_key=ent.entity_key,
                depth=min(directive_event.depth + 1, self._max_depth + 1),
            )

    async def _emit_relation_signal(
        self, directive_event, src: str, dst: str, edge, conf: float
    ) -> None:
        event = EntityDiscoveredV1(
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            entity=GraphEntityRef(entity_type="PERSON", entity_key=dst),
            meta={"relation_type": edge.value, "from": src},
            depth=min(directive_event.depth + 1, self._max_depth + 1),
            confidence=conf,
        )
        await self._publish("enrichment.entity.discovered.v1", event.model_dump(mode="json"))

    async def _publish_result(
        self,
        directive_event,
        status: str,
        *,
        summary: dict | None = None,
        facts_written: int = 0,
        code: str | None = None,
        message: str | None = None,
    ) -> None:
        result = WorkerResultEventV1(
            directive_event_id=directive_event.event_id,
            case_id=directive_event.case_id,
            request_event_id=directive_event.request_event_id,
            tenant_id=directive_event.tenant_id,
            company_id=directive_event.company_id,
            worker_type=directive_event.worker_type,
            status=status,
            facts_written=facts_written,
            error_code=code,
            error_message=message,
            summary=summary,
        )
        subject = f"enrichment.worker.{directive_event.worker_type}.completed.v1"
        await self._publish(subject, result.model_dump(mode="json"))

    # ---------------------------------------------------------------- helpers
    async def _enqueue_directive(
        self, *, case, request_event_id, tenant_id, company_id, worker_type,
        entity_type, entity_key, target_company_id, target, depth, hints,
    ) -> None:
        upsert = await self._repo.upsert_directive(
            case_id=case.id,
            request_event_id=request_event_id,
            tenant_id=tenant_id,
            company_id=company_id,
            worker_type=worker_type.value if isinstance(worker_type, WorkerType) else worker_type,
            target=target,
            entity_type=entity_type,
            entity_key=entity_key,
            target_company_id=target_company_id,
            depth=depth,
            hints=hints,
        )
        if not upsert.created:
            return
        await self._repo.case_pending_inc(case.id)
        await self._repo.directives_inc(case.id)
        event = WorkerDirectiveRequestedV1(
            case_id=case.id,
            request_event_id=request_event_id,
            tenant_id=tenant_id,
            company_id=company_id,
            worker_type=upsert.job.worker_type if upsert.job else (
                worker_type.value if isinstance(worker_type, WorkerType) else worker_type
            ),
            entity=GraphEntityRef(
                entity_type=entity_type,
                entity_key=entity_key,
                target_company_id=target_company_id,
            ),
            target=target,
            hints=hints,
            depth=depth,
        )
        subject = worker_request_subject(WorkerType(event.worker_type))
        await self._publish(subject, event.model_dump(mode="json"))

    async def _find_directive(self, case_id, worker_type, entity_key):
        return await self._repo._get_directive(case_id, worker_type, entity_key)

    def _lock_for(self, case_id: uuid.UUID) -> asyncio.Lock:
        lock = self._locks.get(case_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[case_id] = lock
        return lock
