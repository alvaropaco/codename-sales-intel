"""Application configuration loaded from environment (values come from Infisical at deploy time)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- NATS JetStream ---
    nats_url: str = Field(default="nats://localhost:4222", validation_alias="NATS_URL")
    nats_creds: str | None = Field(default=None, validation_alias="NATS_CREDS")
    nats_fetch_batch_size: int = Field(default=20, validation_alias="NATS_FETCH_BATCH_SIZE")
    nats_max_ack_pending: int = Field(default=100, validation_alias="NATS_MAX_ACK_PENDING")
    nats_consumer_name: str = Field(
        default="enrichment-worker", validation_alias="NATS_CONSUMER_NAME"
    )
    nats_stream: str = Field(default="ENRICHMENT", validation_alias="NATS_STREAM")
    # Cap de storage do stream ENRICHMENT. Sem isso o update_stream de boot
    # reabre o limite para ilimitado e o stream pode drenar o storage global
    # do servidor NATS (max_file). O default cobre ~250x o uso observado.
    nats_stream_max_bytes: int = Field(
        default=1_073_741_824, validation_alias="NATS_STREAM_MAX_BYTES"
    )
    # Último anteparo contra capability presa (ex.: scan OSINT em domínio
    # patológico que sobrevive aos timeouts internos do provider): marca a
    # directive como FAILED e deixa o caso terminar (PARTIAL).
    directive_hard_timeout_seconds: int = Field(
        default=900, validation_alias="DIRECTIVE_HARD_TIMEOUT_SECONDS"
    )

    # --- Subjects ---
    stream_subjects: str = Field(default="enrichment.company.>", validation_alias="STREAM_SUBJECTS")
    subject_requested: str = Field(
        default="enrichment.company.requested.v1", validation_alias="SUBJECT_REQUESTED"
    )
    subject_completed: str = Field(
        default="enrichment.company.completed.v1", validation_alias="SUBJECT_COMPLETED"
    )
    subject_failed: str = Field(
        default="enrichment.company.failed.v1", validation_alias="SUBJECT_FAILED"
    )
    subject_discarded: str = Field(
        default="enrichment.company.discarded.v1", validation_alias="SUBJECT_DISCARDED"
    )
    subject_partial: str = Field(
        default="enrichment.company.partial.v1", validation_alias="SUBJECT_PARTIAL"
    )
    subject_dlq: str = Field(default="enrichment.company.dlq.v1", validation_alias="SUBJECT_DLQ")

    # --- Graph mode (multi-worker OSINT) subjects ---
    # Distinct from the legacy company.* subjects so graph-mode workers can be
    # deployed additively alongside the legacy `core` worker without
    # double-processing requests or clobbering the downstream completed.v1
    # consumer contract.
    graph_subject_requested: str = Field(
        default="enrichment.company.graph.requested.v1",
        validation_alias="GRAPH_SUBJECT_REQUESTED",
    )
    graph_subject_completed: str = Field(
        default="enrichment.company.graph.completed.v1",
        validation_alias="GRAPH_SUBJECT_COMPLETED",
    )
    graph_subject_partial: str = Field(
        default="enrichment.company.graph.partial.v1",
        validation_alias="GRAPH_SUBJECT_PARTIAL",
    )

    # --- PostgreSQL ---
    database_url: str = Field(default="", validation_alias="DATABASE_URL")

    # --- CNPJ warehouse (existing cnpj-postgres; deterministic firmographics) ---
    cnpj_database_url: str | None = Field(default=None, validation_alias="CNPJ_DATABASE_URL")
    cnpj_query_timeout_seconds: float = Field(
        default=5.0, validation_alias="CNPJ_QUERY_TIMEOUT_SECONDS"
    )
    # QSA (quadro societário) table name in cnpj-postgres. Unset => QSA disabled
    # (schema not yet confirmed); registry still surfaces people from hints.
    cnpj_qsa_table: str | None = Field(default=None, validation_alias="CNPJ_QSA_TABLE")

    # --- Worker ---
    worker_concurrency: int = Field(default=10, validation_alias="WORKER_CONCURRENCY")
    worker_heartbeat_seconds: int = Field(default=15, validation_alias="WORKER_HEARTBEAT_SECONDS")
    worker_lease_seconds: int = Field(default=60, validation_alias="WORKER_LEASE_SECONDS")
    worker_id: str | None = Field(default=None, validation_alias="WORKER_ID")
    shutdown_grace_seconds: int = Field(default=60, validation_alias="SHUTDOWN_GRACE_SECONDS")
    worker_lease_takeover_stale_seconds: int = Field(
        default=90, validation_alias="WORKER_LEASE_TAKEOVER_STALE_SECONDS"
    )
    enrichment_mock_mode: bool = Field(default=False, validation_alias="ENRICHMENT_MOCK_MODE")

    # --- Crawler ---
    crawler_max_pages: int = Field(default=30, validation_alias="CRAWLER_MAX_PAGES")
    crawler_max_depth: int = Field(default=3, validation_alias="CRAWLER_MAX_DEPTH")
    crawler_timeout_seconds: int = Field(default=15, validation_alias="CRAWLER_TIMEOUT_SECONDS")
    crawler_max_response_bytes: int = Field(
        default=5_000_000, validation_alias="CRAWLER_MAX_RESPONSE_BYTES"
    )

    # --- FlareSolverr ---
    flaresolverr_url: str | None = Field(default=None, validation_alias="FLARESOLVERR_URL")
    flaresolverr_max_concurrency: int = Field(
        default=3, validation_alias="FLARESOLVERR_MAX_CONCURRENCY"
    )
    flaresolverr_timeout_seconds: int = Field(
        default=60, validation_alias="FLARESOLVERR_TIMEOUT_SECONDS"
    )

    # --- SearXNG ---
    searxng_url: str | None = Field(default=None, validation_alias="SEARXNG_URL")

    # --- Obscura (headless JS renderer; CLI fallback for blocked/JS-heavy pages) ---
    obscura_bin: str | None = Field(default=None, validation_alias="OBSCURA_BIN")
    obscura_enabled: bool = Field(default=False, validation_alias="OBSCURA_ENABLED")
    obscura_timeout_seconds: int = Field(default=30, validation_alias="OBSCURA_TIMEOUT_SECONDS")
    obscura_max_concurrency: int = Field(default=3, validation_alias="OBSCURA_MAX_CONCURRENCY")
    obscura_dump: str = Field(default="markdown", validation_alias="OBSCURA_DUMP")
    obscura_stealth: bool = Field(default=False, validation_alias="OBSCURA_STEALTH")

    # --- AI Gateway ---
    ai_gateway_url: str = Field(
        default="http://litellm-gateway.ai-gateway.svc.cluster.local:4000",
        validation_alias="AI_GATEWAY_URL",
    )
    ai_gateway_api_key: str | None = Field(default=None, validation_alias="AI_GATEWAY_API_KEY")
    enrichment_model_primary: str = Field(
        default="gpt-4.1-mini", validation_alias="ENRICHMENT_MODEL_PRIMARY"
    )
    enrichment_model_fallback_1: str = Field(
        default="deepseek-v4-flash-0731", validation_alias="ENRICHMENT_MODEL_FALLBACK_1"
    )
    enrichment_model_fallback_2: str = Field(
        default="kimi-k2.6", validation_alias="ENRICHMENT_MODEL_FALLBACK_2"
    )
    llm_max_input_chars: int = Field(default=30000, validation_alias="LLM_MAX_INPUT_CHARS")

    # --- Object storage (optional) ---
    s3_endpoint: str | None = Field(default=None, validation_alias="S3_ENDPOINT")
    s3_bucket: str | None = Field(default=None, validation_alias="S3_BUCKET")
    s3_access_key: str | None = Field(default=None, validation_alias="S3_ACCESS_KEY")
    s3_secret_key: str | None = Field(default=None, validation_alias="S3_SECRET_KEY")

    # --- Redis ---
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")

    # --- Multi-worker OSINT expansion ---
    worker_types: str = Field(default="core", validation_alias="WORKER_TYPES")
    graph_max_depth: int = Field(default=2, validation_alias="GRAPH_MAX_DEPTH")
    graph_max_directives: int = Field(default=50, validation_alias="GRAPH_MAX_DIRECTIVES")
    graph_max_facts: int = Field(default=200, validation_alias="GRAPH_MAX_FACTS")
    graph_lease_seconds: int = Field(default=60, validation_alias="GRAPH_LEASE_SECONDS")

    # --- BBOT ---
    bbot_bin: str | None = Field(default=None, validation_alias="BBOT_BIN")
    bbot_timeout_seconds: int = Field(default=300, validation_alias="BBOT_TIMEOUT_SECONDS")
    bbot_max_events: int = Field(default=2000, validation_alias="BBOT_MAX_EVENTS")

    # --- SpiderFoot (complementary passive recon; enabled by default) ---
    # Feature 006 (follow-up): sweeper de diretivas órfãs COLLECTED
    orphan_sweep_interval_s: int = Field(default=300, validation_alias="ORPHAN_SWEEP_INTERVAL_S")
    orphan_min_age_s: int = Field(default=7200, validation_alias="ORPHAN_MIN_AGE_S")
    orphan_sweep_limit: int = Field(default=200, validation_alias="ORPHAN_SWEEP_LIMIT")
    spiderfoot_enabled: bool = Field(default=True, validation_alias="SPIDERFOOT_ENABLED")
    spiderfoot_bin: str | None = Field(default=None, validation_alias="SPIDERFOOT_BIN")
    spiderfoot_timeout_seconds: int = Field(
        default=600, validation_alias="SPIDERFOOT_TIMEOUT_SECONDS"
    )
    spiderfoot_modules: str = Field(
        default="sfp_crt,sfp_viewdns,sfp_whois",
        validation_alias="SPIDERFOOT_MODULES",
    )

    # --- Observability ---
    http_port: int = Field(default=8080, validation_alias="PORT")
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, validation_alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    otel_service_name: str = Field(
        default="company-enrichment-worker", validation_alias="OTEL_SERVICE_NAME"
    )
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")

    @property
    def model_chain(self) -> list[str]:
        return [
            m
            for m in (
                self.enrichment_model_primary,
                self.enrichment_model_fallback_1,
                self.enrichment_model_fallback_2,
            )
            if m
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
