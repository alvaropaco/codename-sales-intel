# Event Contracts

Input/output are NATS JetStream events only. No business REST API.

The service has two modes. In legacy mode the subjects below (company.*) are
the whole contract. In multi-worker (graph) mode the worker/entity subjects are
added (see `docs/PLAN_OSINT_EXPANSION.md`).

## Subjects

| Subject | Direction | Purpose |
|---|---|---|
| `enrichment.company.requested.v1` | in | A company enrichment was requested |
| `enrichment.worker.<type>.requested.v1` | org → worker `<type>` | Graph directive (bbot/social/contacts/people/…) |
| `enrichment.worker.<type>.completed.v1` | worker → org | Per-directive outcome |
| `enrichment.entity.discovered.v1` | worker → org | New entity that may unlock follow-on enrichment |
| `enrichment.ingest.collected.v1` | collection worker → persister | Collected data to persist to PostgreSQL |
| `enrichment.company.completed.v1` | out | Enrichment completed (via outbox) |
| `enrichment.company.failed.v1` | out | Pipeline failure after retries |
| `enrichment.company.partial.v1` | out | Enrichment completed with gaps |
| `enrichment.company.discarded.v1` | out | Job discarded (invalid/deterministic) |
| `enrichment.company.dlq.v1` | out | Poison/malformed messages terminated |

## `EnrichmentRequestedV1`

```json
{
  "version": "1",
  "event_id": "uuid",
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "cnpj": "00.000.000/0001-00",
  "company_name": "string|null",
  "trade_name": "string|null",
  "address_city": "string|null",
  "address_state": "string|null",
  "published_at": "ISO-8601"
}
```

## `WorkerDirectiveRequestedV1` (graph mode)

```json
{
  "version": "1",
  "event_id": "uuid",
  "case_id": "uuid",
  "request_event_id": "uuid",
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "worker_type": "bbot",
  "entity": { "entity_type": "DOMAIN", "entity_key": "acme.com.br" },
  "target": "acme.com.br",
  "hints": { "cnpj": "…", "legal_name": "…" },
  "depth": 1,
  "budget": { "max_facts": 200, "max_seconds": 600, "max_events": 5000 },
  "published_at": "ISO-8601"
}
```

## `EntityDiscoveredV1` (graph mode)

```json
{
  "version": "1",
  "event_id": "uuid",
  "case_id": "uuid",
  "request_event_id": "uuid",
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "entity": { "entity_type": "EMAIL", "entity_key": "contato@acme.com.br", "label": "…" },
  "depth": 2,
  "confidence": 0.9,
  "source": { "type": "BBOT", "url": "…" },
  "published_at": "ISO-8601"
}
```

## `IngestCollectedV1` (graph mode)

Collection workers publish their collected data here; the dedicated `persister`
worker consumes it and writes entities/facts/relations to PostgreSQL.

```json
{
  "version": "1",
  "event_id": "uuid",
  "directive_event_id": "uuid",
  "case_id": "uuid",
  "request_event_id": "uuid",
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "worker_type": "bbot",
  "entity": { "entity_type": "DOMAIN", "entity_key": "acme.com.br" },
  "target": "acme.com.br",
  "depth": 1,
  "status": "COMPLETED",
  "facts": [
    { "entity_type": "DOMAIN", "entity_key": "acme.com.br", "fact_key": "website",
      "value": { "value": "acme.com.br" }, "confidence": 0.9,
      "source": { "type": "BBOT", "url": "…" } }
  ],
  "entities": [
    { "entity_type": "EMAIL", "entity_key": "contato@acme.com.br", "label": "…",
      "relation_type": "HAS_EMAIL", "confidence": 0.8, "meta": {}, "emit_discovery": true }
  ],
  "relations": [
    { "source": "acme.com.br", "target": "contato@acme.com.br",
      "relation_type": "HAS_EMAIL", "confidence": 0.7 }
  ],
  "summary": {},
  "published_at": "ISO-8601"
}
```

## `CompanyResultEventV1` (completed / failed / partial / discarded)

```json
{
  "version": "1",
  "event_id": "uuid",
  "request_event_id": "uuid",
  "tenant_id": "uuid|null",
  "company_id": "uuid",
  "cnpj": "string",
  "status": "COMPLETED|FAILED|PARTIAL|DISCARDED",
  "enrichment_version": 1,
  "summary": { "...": "aggregate scores/domain/email" },
  "error_code": "string|null",
  "error_message": "string|null",
  "published_at": "ISO-8601"
}
```

## `DLQEventV1`

```json
{
  "version": "1",
  "event_id": "uuid",
  "original_event_id": "uuid|null",
  "subject": "enrichment.company.requested.v1",
  "payload": { "...": "original message" },
  "consumer_seq": 0,
  "error_code": "INVALID_EVENT|...",
  "error_message": "string",
  "published_at": "ISO-8601"
}
```

## JetStream semantics

- Stream `ENRICHMENT` holds `enrichment.>` (widened from `enrichment.company.>`
  in graph mode to capture worker/entity subjects).
- Legacy: durable pull consumer `enrichment-worker`, explicit ACK, shared by all
  pods. Graph mode: one durable pull consumer per worker type
  (`enrichment-orchestrator`, `enrichment-bbot`, `enrichment-persister`, …).
- Collection workers ACK their directive after handing data to
  `enrichment.ingest.collected.v1`; the `persister` worker ACKs the ingest
  message only after the PostgreSQL transaction commits.
- At-least-once: ACK only after durable persistence.
- Malformed messages terminate (no redelivery) and go to the DLQ.
- Graph fan-out is idempotent: `enrichment_worker_jobs` unique
  `(case_id, worker_type, entity_key)` prevents duplicate directives.
