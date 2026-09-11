"""Semantic-search embedding backfill for the analytical sink.

Reads rows from the sink table where ``embedding IS NULL``, computes vectors
for their ``search_text`` via an OpenAI-compatible embeddings endpoint (the
in-cluster LiteLLM gateway by default), and writes them back into the
``embedding vector(N)`` column. Idempotent and resumable: only NULL rows are
processed, so re-running continues where a previous run stopped.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import httpx
from sqlalchemy import create_engine, text
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.processing.postgres_sink import _validate_identifier

logger = get_logger(__name__)


class EmbeddingError(RuntimeError):
    pass


@dataclass(slots=True)
class EmbedResult:
    rows_embedded: int
    batches: int


def _to_pgvector(values: list[float]) -> str:
    """pgvector accepts its text form: ``[0.1,0.2,...]``."""
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


class Embedder:
    """Backfills the ``embedding`` column of the analytical table."""

    def __init__(self, dsn: str | None = None, table: str | None = None) -> None:
        self.settings = get_settings()
        dsn = dsn or self.settings.effective_sink_dsn
        # SQLAlchemy wants the psycopg driver; normalize a bare libpq URL.
        if dsn.startswith("postgresql://"):
            dsn = dsn.replace("postgresql://", "postgresql+psycopg://", 1)
        self.engine = create_engine(dsn, pool_pre_ping=True, future=True)
        self.table = _validate_identifier(table or self.settings.sink_table, "table")
        self.batch_size = max(1, int(self.settings.embedding_batch_size))
        self.max_rows = int(self.settings.embedding_max_rows_per_run)
        self.concurrency = max(1, int(self.settings.embedding_concurrency))
        self.model = self.settings.embedding_model
        if not self.settings.embedding_base_url:
            raise EmbeddingError("EMBEDDING_BASE_URL is not configured")
        self._base_url = self.settings.embedding_base_url.rstrip("/")

    # -- embedding endpoint ----------------------------------------------
    @retry(
        stop=stop_after_attempt(8),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        retry=retry_if_exception_type((httpx.HTTPError,)),
        reraise=True,
    )
    def _embed_texts(self, client: httpx.Client, texts: list[str]) -> list[list[float]]:
        headers = {}
        if self.settings.embedding_api_key:
            headers["Authorization"] = f"Bearer {self.settings.embedding_api_key}"
        prefix = self.settings.embedding_input_prefix
        inputs = [f"{prefix}{t}" for t in texts] if prefix else texts
        body: dict[str, object] = {"model": self.model, "input": inputs}
        # Request a specific output dimension when the endpoint supports it
        # (Vertex/gemini). Local servers (TEI) reject unknown fields, so this is
        # gated behind EMBEDDING_SEND_DIMENSIONS.
        if self.settings.embedding_send_dimensions and self.settings.sink_embedding_dimensions:
            body["dimensions"] = int(self.settings.sink_embedding_dimensions)
        resp = client.post(
            f"{self._base_url}/v1/embeddings",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        payload = resp.json()
        # OpenAI-compatible: {"data": [{"index": i, "embedding": [...]}, ...]}
        rows = sorted(payload["data"], key=lambda d: d["index"])
        return [r["embedding"] for r in rows]

    # -- batch selection --------------------------------------------------
    def _fetch_chunk(self, conn: object, limit: int) -> list[tuple[str, str]]:
        result = conn.execute(  # type: ignore[attr-defined]
            text(
                f"""
                SELECT cnpj, search_text
                FROM {self.table}
                WHERE embedding IS NULL AND search_text IS NOT NULL
                ORDER BY cnpj
                LIMIT :n
                """
            ),
            {"n": limit},
        )
        return [(row[0], row[1]) for row in result]

    # -- run --------------------------------------------------------------
    def run(self) -> EmbedResult:
        total = 0
        batches = 0
        timeout = self.settings.embedding_request_timeout_seconds
        # Each poll pulls enough rows to keep `concurrency` requests busy, then
        # embeds those sub-batches in parallel and writes the results in one
        # transaction. Only NULL rows are selected, so the run stays resumable.
        chunk_rows = self.batch_size * self.concurrency

        with httpx.Client(
            timeout=timeout,
            # Disable keep-alive so every request opens a fresh connection.
            # Against a Service ClusterIP this lets kube-proxy round-robin the
            # requests across all TEI replica endpoints instead of pinning the
            # whole run to one pod (which starves the others).
            limits=httpx.Limits(
                max_connections=self.concurrency * 2,
                max_keepalive_connections=0,
            ),
        ) as client:
            while True:
                with self.engine.begin() as conn:
                    rows = self._fetch_chunk(conn, chunk_rows)
                    if not rows:
                        break

                    # Split the chunk into per-request sub-batches.
                    sub_batches = [
                        rows[i : i + self.batch_size] for i in range(0, len(rows), self.batch_size)
                    ]

                    def _embed_sub(
                        sub: list[tuple[str, str]],
                    ) -> list[tuple[str, str]]:
                        vecs = self._embed_texts(client, [r[1] for r in sub])
                        if len(vecs) != len(sub):
                            raise EmbeddingError(
                                f"endpoint returned {len(vecs)} vectors for {len(sub)} inputs"
                            )
                        return [
                            (cnpj, _to_pgvector(v)) for (cnpj, _), v in zip(sub, vecs, strict=True)
                        ]

                    updates: list[tuple[str, str]] = []
                    if self.concurrency == 1 or len(sub_batches) == 1:
                        for sub in sub_batches:
                            updates.extend(_embed_sub(sub))
                    else:
                        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                            futures = [pool.submit(_embed_sub, sub) for sub in sub_batches]
                            for fut in as_completed(futures):
                                updates.extend(fut.result())

                    conn.execute(
                        text(
                            f"UPDATE {self.table} SET embedding = CAST(:embedding AS vector) "
                            f"WHERE cnpj = :cnpj"
                        ),
                        [{"cnpj": cnpj, "embedding": emb} for cnpj, emb in updates],
                    )

                total += len(rows)
                batches += 1
                logger.info("embedding_batch", rows=len(rows), total=total)

                if self.max_rows and total >= self.max_rows:
                    break

        logger.info("embedding_completed", rows_embedded=total, batches=batches)
        return EmbedResult(rows_embedded=total, batches=batches)

    # -- coverage ------------------------------------------------------------
    def coverage(self) -> dict[str, int]:
        """Embedding coverage over the same population the run selects from.

        ``pending > 0`` after a run without a row cap means the backfill did
        not finish (endpoint outage, OOM, …) — callers use this to fail the
        job so the CronJob retry resumes the remaining rows.
        """
        with self.engine.connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT count(*) AS total,
                           count(*) FILTER (WHERE embedding IS NULL) AS pending
                    FROM {self.table}
                    WHERE search_text IS NOT NULL
                    """
                )
            ).one()
        total = int(row[0])
        pending = int(row[1])
        return {"total": total, "pending": pending, "embedded": total - pending}

    def create_index(self) -> None:
        """Create an IVFFlat index for cosine similarity once vectors exist.

        IVFFlat is chosen over HNSW because HNSW graph construction is
        single-threaded and takes many hours for multi-million-row tables,
        whereas IVFFlat trains k-means centroids and assigns tuples in minutes.
        """
        lists = max(1, int(self.settings.embedding_index_lists))
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE INDEX IF NOT EXISTS {self.table}_embedding_ivfflat "
                    f"ON {self.table} USING ivfflat (embedding vector_cosine_ops) "
                    f"WITH (lists = {lists})"
                )
            )
        logger.info("embedding_index_ready", table=self.table, index="ivfflat", lists=lists)
