from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageBackend(StrEnum):
    LOCAL = "LOCAL"
    S3 = "S3"
    GCS = "GCS"


class Sink(StrEnum):
    """Where the canonical snapshot is loaded for querying, in addition to files."""

    NONE = "NONE"
    POSTGRES = "POSTGRES"


class InitialSnapshotMode(StrEnum):
    STORE_ONLY = "STORE_ONLY"
    PUBLISH_ALL = "PUBLISH_ALL"


class Settings(BaseSettings):
    """Runtime configuration. Every field maps 1:1 to an env var in .env.example."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application ---------------------------------------------------
    app_env: Literal["development", "staging", "production", "test"] = "development"
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"
    service_name: str = "cnpj-data-publisher"

    # --- PostgreSQL -----------------------------------------------------
    database_url: str = "postgresql+psycopg://cnpj:cnpj@localhost:5432/cnpj"

    # --- NATS JetStream --------------------------------------------------
    nats_url: str = "nats://localhost:4222"
    nats_creds_file: str = ""
    nats_stream: str = "BRAZIL_COMPANY_EVENTS"
    nats_subject_prefix: str = "company.br.cnpj"
    nats_stream_replicas: int = 1
    nats_stream_max_age_days: int = 30
    nats_stream_duplicate_window_hours: int = 24
    nats_connect_timeout_seconds: int = 10

    # --- Receita Federal source -------------------------------------------
    receita_base_url: str = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj"
    receita_include_partners: bool = False
    receita_max_download_concurrency: int = 4
    receita_request_timeout_seconds: int = 60
    receita_download_retries: int = 5
    receita_download_chunk_size_bytes: int = 8_388_608
    receita_allowed_hosts: str = (
        "arquivos.receitafederal.gov.br,dadosabertos.rfb.gov.br,"
        "dados-abertos-rf-cnpj.casadosdados.com.br"
    )

    # --- Storage ------------------------------------------------------
    storage_backend: StorageBackend = StorageBackend.LOCAL
    storage_local_path: Path = Path("/data")
    s3_endpoint: str = ""
    s3_region: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_force_path_style: bool = True

    # --- Google Cloud Storage (native backend) ---------------------------
    gcs_bucket: str = ""
    gcs_project: str = ""
    # Path to a service-account JSON key. Leave empty to use Application
    # Default Credentials (Workload Identity, GKE metadata server, etc.).
    google_application_credentials: str = ""

    # --- Extraction limits ------------------------------------------------
    max_extracted_file_size_bytes: int = 50_000_000_000
    max_total_extracted_size_bytes: int = 500_000_000_000
    extract_concurrency: int = 4

    # --- Upload ---------------------------------------------------------
    s3_upload_concurrency: int = 8

    # --- Processing -----------------------------------------------------
    include_branches: bool = False
    initial_snapshot_mode: InitialSnapshotMode = InitialSnapshotMode.STORE_ONLY
    schema_version: int = 1
    duckdb_memory_limit: str = "4GB"
    duckdb_threads: int = 4

    # --- Analytical sink (OLAP / RAG) -----------------------------------
    # Loads the canonical ``active`` dataset into a queryable store in addition
    # to writing Parquet. NONE keeps the file-only behaviour.
    sink: Sink = Sink.NONE
    # Separate DSN for the analytical data. Defaults to the app database_url.
    sink_database_url: str = ""
    sink_table: str = "companies"
    # Restrict the loaded rows to companies opened in this year or later
    # (0 = no filter, keep every active company regardless of opening date).
    sink_active_opening_year: int = 0
    # Embedding column dimension (LiteLLM gemini-embedding default is 1536).
    sink_embedding_dimensions: int = 1536

    # --- Embeddings (semantic search backfill) --------------------------
    # OpenAI-compatible embeddings endpoint. In-cluster this is the LiteLLM
    # gateway; leave empty to disable the embed command.
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "gemini-embedding"
    embedding_batch_size: int = 128
    embedding_request_timeout_seconds: int = 60
    embedding_max_rows_per_run: int = 0  # 0 == no limit
    # Number of concurrent embedding requests in flight. 1 == fully serial.
    embedding_concurrency: int = 1
    # Prefix prepended to each text before embedding. Required by e5 models
    # (use "passage: " when indexing documents, "query: " when searching).
    embedding_input_prefix: str = ""
    # Send the OpenAI "dimensions" param. Vertex/gemini support it (to shrink
    # 3072->1536); local servers like TEI reject unknown fields, so keep off.
    embedding_send_dimensions: bool = False
    # IVFFlat index `lists` count (number of centroids). Rule of thumb is
    # ~sqrt(rows); 1000 is a good default for millions of rows. IVFFlat builds
    # in minutes where HNSW graph construction is single-threaded and can take
    # many hours for >1M vectors.
    embedding_index_lists: int = 1000

    # --- Parquet ------------------------------------------------------
    parquet_compression: str = "zstd"
    parquet_row_group_size: int = 250_000

    # --- Validation thresholds --------------------------------------------
    max_rejected_row_percentage: Decimal = Decimal("0.01")
    min_expected_total_rows: int = 1_000_000

    # --- Outbox -------------------------------------------------------
    outbox_batch_size: int = 500
    outbox_concurrency: int = 20
    outbox_poll_interval_ms: int = 1_000
    outbox_max_attempts: int = 20
    outbox_retry_base_seconds: int = 5
    outbox_retry_max_seconds: int = 3_600

    # --- Backfill -----------------------------------------------------
    backfill_default_batch_size: int = 1_000
    backfill_default_rate: int = 0  # 0 == unlimited

    # --- Retention ------------------------------------------------------
    keep_raw_downloads_months: int = 2
    keep_extracted_files_months: int = 1
    keep_canonical_snapshots_months: int = 3
    keep_diffs_months: int = 6
    keep_rejected_rows_months: int = 3
    keep_published_outbox_days: int = 14

    # --- Observability ----------------------------------------------------
    metrics_port: int = 9090
    health_port: int = 8080
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str = ""

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------
    @field_validator("parquet_compression")
    @classmethod
    def _validate_compression(cls, v: str) -> str:
        allowed = {"zstd", "snappy", "gzip", "lz4", "brotli", "uncompressed"}
        low = v.lower()
        if low not in allowed:
            raise ValueError(f"PARQUET_COMPRESSION must be one of {sorted(allowed)}")
        return low

    @field_validator("max_rejected_row_percentage")
    @classmethod
    def _validate_reject_pct(cls, v: Decimal) -> Decimal:
        if not (Decimal(0) <= v <= Decimal(1)):
            raise ValueError("MAX_REJECTED_ROW_PERCENTAGE must be between 0 and 1")
        return v

    # ------------------------------------------------------------------
    # Derived helpers
    # ------------------------------------------------------------------
    @property
    def allowed_download_hosts(self) -> set[str]:
        return {h.strip().lower() for h in self.receita_allowed_hosts.split(",") if h.strip()}

    @property
    def data_root(self) -> Path:
        return self.storage_local_path

    @property
    def effective_sink_dsn(self) -> str:
        """DSN for the analytical sink, defaulting to the app database."""
        return self.sink_database_url or self.database_url

    def downloads_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "downloads" / snapshot_version

    def extracted_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "extracted" / snapshot_version

    def snapshot_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "snapshots" / snapshot_version

    def snapshot_building_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "snapshots" / f"{snapshot_version}-building"

    def diffs_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "diffs" / snapshot_version

    def rejected_dir(self, snapshot_version: str) -> Path:
        return self.data_root / "rejected" / snapshot_version

    @property
    def temporary_dir(self) -> Path:
        return self.data_root / "temporary"

    def ensure_dirs(self, snapshot_version: str) -> None:
        for directory in (
            self.downloads_dir(snapshot_version),
            self.extracted_dir(snapshot_version),
            self.diffs_dir(snapshot_version),
            self.rejected_dir(snapshot_version),
            self.temporary_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    # --- Subjects -----------------------------------------------------
    def subject(self, leaf: str) -> str:
        return f"{self.nats_subject_prefix}.{leaf}"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Test helper - clears the cached settings singleton."""
    global _settings
    _settings = None
