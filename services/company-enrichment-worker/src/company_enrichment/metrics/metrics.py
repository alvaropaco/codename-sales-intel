"""Prometheus metrics for the enrichment worker."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

# --- Jobs ---
ENRICHMENT_JOBS_TOTAL = Counter(
    "enrichment_jobs_total",
    "Total enrichment job messages received",
    ["status"],
)
ENRICHMENT_JOBS_COMPLETED = Counter(
    "enrichment_jobs_completed_total",
    "Enrichment jobs completed (durable result persisted)",
)
ENRICHMENT_JOBS_FAILED = Counter(
    "enrichment_jobs_failed_total",
    "Enrichment jobs failed",
    ["error_code"],
)
ENRICHMENT_JOB_DURATION = Histogram(
    "enrichment_job_duration_seconds",
    "End-to-end enrichment job duration in seconds",
    buckets=(1, 2, 5, 10, 20, 30, 60, 120, 300, 600),
)
ENRICHMENT_ACTIVE_JOBS = Gauge(
    "enrichment_active_jobs",
    "Number of jobs currently being processed by this worker",
)
ENRICHMENT_AVAILABLE_SLOTS = Gauge(
    "enrichment_available_slots",
    "Worker capacity slots currently free",
)

# --- Providers ---
ENRICHMENT_PROVIDER_REQUESTS = Counter(
    "enrichment_provider_requests_total",
    "Requests issued to an external provider",
    ["provider"],
)
ENRICHMENT_PROVIDER_FAILURES = Counter(
    "enrichment_provider_failures_total",
    "Provider failures",
    ["provider", "error_code"],
)
ENRICHMENT_PROVIDER_LATENCY = Histogram(
    "enrichment_provider_latency_seconds",
    "Provider latency in seconds",
    ["provider"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)

# --- FlareSolverr ---
ENRICHMENT_FLARESOLVERR_REQUESTS = Counter(
    "enrichment_flaresolverr_requests_total",
    "FlareSolverr requests issued",
)
ENRICHMENT_FLARESOLVERR_FALLBACK = Counter(
    "enrichment_flaresolverr_fallback_total",
    "Times the pipeline fell back to FlareSolverr after a blocked HTTP response",
    ["url_kind"],
)

# --- Obscura (headless JS renderer) ---
ENRICHMENT_OBSCURA_REQUESTS = Counter(
    "enrichment_obscura_requests_total",
    "Obscura render requests issued",
)
ENRICHMENT_OBSCURA_FALLBACK = Counter(
    "enrichment_obscura_fallback_total",
    "Times the pipeline fell back to Obscura after a blocked HTTP response",
    ["url_kind"],
)

# --- AI ---
ENRICHMENT_AI_REQUESTS = Counter(
    "enrichment_ai_requests_total",
    "AI Gateway requests",
    ["model"],
)
ENRICHMENT_AI_FAILURES = Counter(
    "enrichment_ai_failures_total",
    "AI Gateway failures",
    ["model", "error_code"],
)
ENRICHMENT_AI_TOKENS = Counter(
    "enrichment_ai_tokens_total",
    "LLM tokens consumed (input+output)",
    ["model"],
)

# --- Discovery ---
ENRICHMENT_DOMAINS_FOUND = Counter(
    "enrichment_domains_found_total",
    "Candidate domains discovered",
)
ENRICHMENT_WEBSITES_FOUND = Counter(
    "enrichment_websites_found_total",
    "Official websites successfully validated",
)

# --- NATS ---
NATS_PENDING = Gauge(
    "nats_pending_messages",
    "JetStream consumer pending messages (for future backlog-based autoscaling)",
    ["consumer"],
)

# --- OSINT tools (BBOT / SpiderFoot) ---
ENRICHMENT_OSINT_SCANS = Counter(
    "enrichment_osint_scans_total",
    "OSINT scans launched",
    ["tool"],
)
ENRICHMENT_OSINT_SCANS_FAILED = Counter(
    "enrichment_osint_scans_failed_total",
    "OSINT scans that failed or timed out",
    ["tool"],
)
ENRICHMENT_OSINT_EVENTS_INGESTED = Counter(
    "enrichment_osint_events_ingested_total",
    "Relevant OSINT events ingested from tool output",
    ["tool"],
)

# --- Entity graph ---
ENRICHMENT_ENTITIES_CREATED = Counter(
    "enrichment_entities_created_total",
    "New entities created (deduplicated)",
    ["entity_type"],
)
ENRICHMENT_FACTS_WRITTEN = Counter(
    "enrichment_facts_written_total",
    "Facts upserted onto entities",
    ["entity_type"],
)
ENRICHMENT_ENTITY_DISCOVERED_EVENTS = Counter(
    "enrichment_entity_discovered_events_total",
    "Entity discovered events emitted",
)
ENRICHMENT_GRAPH_GUARD_REJECTIONS = Counter(
    "enrichment_graph_guard_rejections_total",
    "Follow-up scheduling blocked by a guardrail",
    ["reason"],
)
ENRICHMENT_CASES_TOTAL = Counter(
    "enrichment_cases_total",
    "Enrichment graph cases created",
    ["status"],
)

# --- Worker directives ---
ENRICHMENT_DIRECTIVES_TOTAL = Counter(
    "enrichment_worker_directives_total",
    "Worker directives received",
    ["worker_type", "status"],
)
ENRICHMENT_DIRECTIVES_COMPLETED = Counter(
    "enrichment_worker_directives_completed_total",
    "Worker directives completed",
    ["worker_type"],
)
ENRICHMENT_DIRECTIVES_FAILED = Counter(
    "enrichment_worker_directives_failed_total",
    "Worker directives failed",
    ["worker_type", "error_code"],
)
ENRICHMENT_DIRECTIVE_DURATION = Histogram(
    "enrichment_worker_duration_seconds",
    "Worker directive duration in seconds",
    ["worker_type"],
    buckets=(1, 2, 5, 10, 20, 30, 60, 120, 300, 600),
)
