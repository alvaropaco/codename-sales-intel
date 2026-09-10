"""Small typing helpers for DuckDB results."""

from __future__ import annotations

from typing import Any

import duckdb


def fetch_one(con: duckdb.DuckDBPyConnection, sql: str, params: Any = None) -> tuple[Any, ...]:
    """Execute a query that must return exactly one row."""
    result = con.execute(sql, params) if params is not None else con.execute(sql)
    row = result.fetchone()
    if row is None:
        raise RuntimeError(f"query returned no rows: {sql.strip()[:120]}")
    return row


def fetch_scalar(con: duckdb.DuckDBPyConnection, sql: str, params: Any = None) -> Any:
    return fetch_one(con, sql, params)[0]
