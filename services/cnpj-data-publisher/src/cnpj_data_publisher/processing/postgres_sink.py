"""Analytical Postgres sink (OLAP + RAG + semantic search).

Loads the canonical ``active`` Parquet dataset into a Postgres table using
DuckDB's native ``postgres`` extension, so millions of rows stream straight from
Parquet to Postgres without ever being materialized in Python.

The load is **atomic**: rows are written to ``<table>_building`` and swapped
into ``<table>`` only after the row count passes a sanity check, so a partial
load can never replace a good table. A ``search_text`` column is populated for
downstream embedding, and an ``embedding vector(N)`` column is created (left
NULL here) so a separate embedding worker can backfill semantic vectors.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

import duckdb

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)

# Columns loaded into the analytical table, in declaration order. These mirror
# the canonical Parquet schema (processing.canonical_snapshot).
SINK_COLUMNS: tuple[str, ...] = (
    "cnpj",
    "cnpj_basic",
    "legal_name",
    "trade_name",
    "registration_status",
    "registration_status_date",
    "opening_date",
    "legal_nature_code",
    "legal_nature_description",
    "main_cnae",
    "main_cnae_description",
    "company_size_code",
    "share_capital",
    "simple_tax_option",
    "mei_option",
    "city_name",
    "state",
    "email",
    "is_active",
    "is_headquarters",
    "fingerprint",
)

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SinkError(RuntimeError):
    pass


def _validate_identifier(name: str, kind: str) -> str:
    if not _IDENT_RE.match(name):
        raise SinkError(f"unsafe {kind} identifier: {name!r}")
    return name


@dataclass(slots=True)
class SinkResult:
    table: str
    rows_loaded: int


class PostgresSink:
    """Loads the active dataset into Postgres for OLAP and semantic search."""

    def __init__(
        self,
        snapshot_dir: Path,
        dsn: str | None = None,
        table: str | None = None,
    ) -> None:
        self.settings = get_settings()
        self.snapshot_dir = snapshot_dir
        self.dsn = dsn or self.settings.effective_sink_dsn
        self.table = _validate_identifier(table or self.settings.sink_table, "table")
        self.building_table = _validate_identifier(f"{self.table}_building", "table")
        self.embedding_dims = int(self.settings.sink_embedding_dimensions)
        self.opening_year = int(self.settings.sink_active_opening_year)

    # -- helpers ---------------------------------------------------------
    def _active_glob(self) -> str:
        return str(self.snapshot_dir / "active" / "**" / "*.parquet")

    def _duckdb_dsn(self) -> str:
        """DuckDB's postgres extension wants a libpq DSN, not a SQLAlchemy URL."""
        return self.dsn.replace("postgresql+psycopg://", "postgresql://").replace(
            "postgresql+psycopg2://", "postgresql://"
        )

    def _search_text_sql(self) -> str:
        """Concatenate the human-meaningful fields for embedding."""
        parts = [
            "coalesce(legal_name, '')",
            "coalesce(trade_name, '')",
            "coalesce(main_cnae_description, '')",
            "coalesce(city_name, '')",
            "coalesce(state, '')",
        ]
        joined = " || ' ' || ".join(parts)
        return f"nullif(trim(regexp_replace({joined}, '\\s+', ' ', 'g')), '')"

    def _row_filter(self) -> str:
        # The active dataset is already active + headquarters (unless
        # INCLUDE_BRANCHES). Optionally restrict to companies opened in or
        # after a given year (minimum opening year).
        if self.opening_year > 0:
            return f"WHERE extract('year' FROM opening_date) >= {self.opening_year}"
        return ""

    # -- load ------------------------------------------------------------
    def load(self) -> SinkResult:
        active_glob = self._active_glob()
        pg = self._duckdb_dsn()
        columns_csv = ", ".join(SINK_COLUMNS)

        con = duckdb.connect()
        try:
            con.execute(f"SET threads={self.settings.duckdb_threads}")
            # The runtime container has a read-only root filesystem, so DuckDB
            # must not write its extension cache under $HOME. Prefer a
            # pre-installed extension directory (baked into the image via
            # DUCKDB_EXTENSION_DIRECTORY); otherwise fall back to installing
            # into the writable temp volume.
            self.settings.temporary_dir.mkdir(parents=True, exist_ok=True)
            tmp = str(self.settings.temporary_dir)
            con.execute(f"SET home_directory='{tmp}'")
            ext_dir = os.environ.get("DUCKDB_EXTENSION_DIRECTORY")
            if ext_dir:
                con.execute(f"SET extension_directory='{ext_dir}'")
                try:
                    con.execute("LOAD postgres")
                except duckdb.Error:
                    # Not pre-installed after all: install into the temp volume.
                    con.execute(f"SET extension_directory='{tmp}/.duckdb_extensions'")
                    con.execute("INSTALL postgres")
                    con.execute("LOAD postgres")
            else:
                con.execute(f"SET extension_directory='{tmp}/.duckdb_extensions'")
                con.execute("INSTALL postgres")
                con.execute("LOAD postgres")
            con.execute(f"ATTACH '{pg}' AS pg (TYPE postgres)")

            con.execute("CREATE SCHEMA IF NOT EXISTS pg.public")
            # Fresh building table each run.
            con.execute(f"DROP TABLE IF EXISTS pg.public.{self.building_table}")

            # Stream Parquet -> Postgres. search_text is computed inline; the
            # embedding column is added afterwards via a raw Postgres statement
            # (DuckDB has no vector type).
            con.execute(
                f"""
                CREATE TABLE pg.public.{self.building_table} AS
                SELECT {columns_csv}, {self._search_text_sql()} AS search_text
                FROM read_parquet('{active_glob}', hive_partitioning=true)
                {self._row_filter()}
                """
            )

            count_row = con.execute(
                f"SELECT count(*) FROM pg.public.{self.building_table}"
            ).fetchone()
            rows = int(count_row[0]) if count_row else 0
            if rows == 0:
                raise SinkError("refusing to swap in an empty analytical table")

            # Add pgvector column + indexes, then atomically swap. Executed on
            # the Postgres side so pgvector types/operators are available.
            con.execute(
                f"""
                CALL postgres_execute('pg', $$
                    CREATE EXTENSION IF NOT EXISTS vector;
                    ALTER TABLE {self.building_table}
                        ADD COLUMN IF NOT EXISTS embedding vector({self.embedding_dims});
                    ALTER TABLE {self.building_table}
                        ADD COLUMN IF NOT EXISTS loaded_at timestamptz DEFAULT now();
                    CREATE INDEX ON {self.building_table} (state);
                    CREATE INDEX ON {self.building_table} (main_cnae);
                    CREATE INDEX ON {self.building_table} (opening_date);
                    CREATE UNIQUE INDEX ON {self.building_table} (cnpj);
                    DROP TABLE IF EXISTS {self.table};
                    ALTER TABLE {self.building_table} RENAME TO {self.table};
                $$)
                """
            )
        finally:
            con.close()

        logger.info("sink_loaded", table=self.table, rows=rows, opening_year=self.opening_year)
        return SinkResult(table=self.table, rows_loaded=rows)
