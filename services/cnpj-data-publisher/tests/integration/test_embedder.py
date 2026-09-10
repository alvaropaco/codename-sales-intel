"""Integration test for the semantic-search embedder against real pgvector."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from cnpj_data_publisher.config import reset_settings

PG_URL = os.environ.get("TEST_PGVECTOR_URL")
requires_pgvector = pytest.mark.skipif(not PG_URL, reason="TEST_PGVECTOR_URL is not set")


def _seed_table(dsn: str, table: str, n: int) -> None:
    """Create a minimal sink table with search_text and NULL embeddings."""
    engine = create_engine(dsn.replace("postgresql://", "postgresql+psycopg://"))
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        conn.execute(
            text(
                f"CREATE TABLE {table} ("
                "cnpj text PRIMARY KEY, search_text text, embedding vector(4))"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {table}(cnpj, search_text) "
                "SELECT lpad(g::text, 14, '0'), 'company ' || g "
                f"FROM generate_series(1, {n}) g"
            )
        )
    engine.dispose()


@requires_pgvector
def test_embedder_backfills_and_resumes(monkeypatch: pytest.MonkeyPatch) -> None:
    table = "companies_embed_test"
    _seed_table(PG_URL, table, 5)

    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", table)
    monkeypatch.setenv("SINK_EMBEDDING_DIMENSIONS", "4")
    monkeypatch.setenv("EMBEDDING_BASE_URL", "http://fake.local")
    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "2")
    monkeypatch.setenv("EMBEDDING_INDEX_LISTS", "2")
    reset_settings()

    from cnpj_data_publisher.processing import embedder as embedder_mod

    # Deterministic 4-d vector per text; no network.
    def fake_embed(self, client, texts):  # noqa: ANN001, ARG001
        return [[float(len(t)), 1.0, 2.0, 3.0] for t in texts]

    monkeypatch.setattr(embedder_mod.Embedder, "_embed_texts", fake_embed)

    result = embedder_mod.Embedder().run()
    assert result.rows_embedded == 5
    assert result.batches == 3  # 2 + 2 + 1

    engine = create_engine(PG_URL.replace("postgresql://", "postgresql+psycopg://"))
    with engine.connect() as conn:
        remaining = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE embedding IS NULL")
        ).scalar()
        assert remaining == 0
        # Re-running embeds nothing (idempotent / resumable).
    again = embedder_mod.Embedder().run()
    assert again.rows_embedded == 0

    # IVFFlat index creation works once vectors exist.
    embedder_mod.Embedder().create_index()
    with engine.connect() as conn:
        idx = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                f"WHERE tablename = '{table}' AND indexname LIKE '%ivfflat%'"
            )
        ).scalar()
        assert idx is not None
    engine.dispose()


@requires_pgvector
def test_embedder_concurrent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Concurrent embedding writes every row exactly once."""
    table = "companies_embed_conc"
    _seed_table(PG_URL, table, 20)

    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", table)
    monkeypatch.setenv("SINK_EMBEDDING_DIMENSIONS", "4")
    monkeypatch.setenv("EMBEDDING_BASE_URL", "http://fake.local")
    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "3")
    monkeypatch.setenv("EMBEDDING_CONCURRENCY", "4")
    reset_settings()

    from cnpj_data_publisher.processing import embedder as embedder_mod

    def fake_embed(self, client, texts):  # noqa: ANN001, ARG001
        return [[float(len(t)), 1.0, 2.0, 3.0] for t in texts]

    monkeypatch.setattr(embedder_mod.Embedder, "_embed_texts", fake_embed)

    result = embedder_mod.Embedder().run()
    assert result.rows_embedded == 20

    engine = create_engine(PG_URL.replace("postgresql://", "postgresql+psycopg://"))
    with engine.connect() as conn:
        remaining = conn.execute(
            text(f"SELECT count(*) FROM {table} WHERE embedding IS NULL")
        ).scalar()
        assert remaining == 0
        # every row got a 4-dim vector
        dims = (
            conn.execute(text(f"SELECT DISTINCT vector_dims(embedding) FROM {table}"))
            .scalars()
            .all()
        )
        assert dims == [4]
    engine.dispose()
