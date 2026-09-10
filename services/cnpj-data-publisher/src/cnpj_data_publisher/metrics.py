"""Prometheus metrics. Names follow spec section 33 exactly.

Labels are deliberately low-cardinality: never use CNPJ as a label.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, start_http_server

# --- Snapshot / ingest ------------------------------------------------
snapshot_runs_total = Counter(
    "cnpj_snapshot_runs_total",
    "Total ingest runs by terminal status",
    ["status"],
)

snapshot_run_duration_seconds = Histogram(
    "cnpj_snapshot_run_duration_seconds",
    "Duration of an ingest run or stage",
    ["stage"],
    buckets=(1, 5, 15, 60, 300, 900, 1800, 3600, 7200, 21600),
)

# --- Download ---------------------------------------------------------
download_bytes_total = Counter(
    "cnpj_download_bytes_total",
    "Total bytes downloaded from the source",
)

download_failures_total = Counter(
    "cnpj_download_failures_total",
    "Total download failures",
)

# --- Rows -------------------------------------------------------------
rows_processed_total = Counter(
    "cnpj_rows_processed_total",
    "Rows successfully parsed and normalized",
)

rows_rejected_total = Counter(
    "cnpj_rows_rejected_total",
    "Rows rejected during parsing/normalization",
)

active_companies_total = Gauge(
    "cnpj_active_companies_total",
    "Active companies in the latest published snapshot",
)

diff_companies_total = Counter(
    "cnpj_diff_companies_total",
    "Companies classified by the diff engine",
    ["event_type"],
)

# --- Outbox -----------------------------------------------------------
outbox_pending_total = Gauge(
    "cnpj_outbox_pending_total",
    "Events currently pending publication",
)

outbox_published_total = Counter(
    "cnpj_outbox_published_total",
    "Events successfully published to JetStream",
    ["event_type"],
)

outbox_failed_total = Counter(
    "cnpj_outbox_failed_total",
    "Event publication failures",
    ["event_type"],
)

# --- Backfill ---------------------------------------------------------
backfill_rows_total = Counter(
    "cnpj_backfill_rows_total",
    "Rows published by backfill runs",
)

backfill_progress = Gauge(
    "cnpj_backfill_progress",
    "Backfill completion ratio between 0 and 1",
)

# --- NATS -------------------------------------------------------------
nats_publish_duration_seconds = Histogram(
    "cnpj_nats_publish_duration_seconds",
    "Latency of a JetStream publish including PubAck",
    buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0),
)


def start_metrics_server(port: int) -> None:
    """Expose /metrics on the given port."""
    start_http_server(port)
