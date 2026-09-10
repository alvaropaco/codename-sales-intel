"""Integration test for the analytical Postgres sink.

Requires a pgvector-enabled Postgres. Set ``TEST_PGVECTOR_URL`` to a libpq or
SQLAlchemy DSN pointing at one (e.g. the pgvector/pgvector image).
"""

from __future__ import annotations

import os
from pathlib import Path

import duckdb
import pytest
from sqlalchemy import create_engine, text

from cnpj_data_publisher.config import reset_settings
from cnpj_data_publisher.processing.postgres_sink import PostgresSink, SinkError

PG_URL = os.environ.get("TEST_PGVECTOR_URL")
requires_pgvector = pytest.mark.skipif(not PG_URL, reason="TEST_PGVECTOR_URL is not set")


def _write_active_parquet(root: Path) -> None:
    """Create a minimal canonical ``active/`` dataset partitioned by state."""
    active = root / "active"
    active.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(
        """
        CREATE TABLE rows AS
        SELECT * FROM (VALUES
            ('11111111000190','11111111','ACME LTDA','ACME','ACTIVE',
             DATE '2026-03-01', DATE '2026-03-01','2062','SOCIEDADE',
             '6201501','DESENVOLVIMENTO DE SOFTWARE','05', 1000.00::DECIMAL(20,2),
             true,false,'SAO PAULO','SP','a@b.com',true,true,'fp1'),
            ('22222222000181','22222222','BETA SA','BETA','ACTIVE',
             DATE '2019-05-01', DATE '2019-05-01','2054','SA',
             '4711302','COMERCIO','03', 50.00::DECIMAL(20,2),
             false,false,'RIO','RJ','c@d.com',true,true,'fp2')
        ) AS t(cnpj,cnpj_basic,legal_name,trade_name,registration_status,
               registration_status_date,opening_date,legal_nature_code,
               legal_nature_description,main_cnae,main_cnae_description,
               company_size_code,share_capital,simple_tax_option,mei_option,
               city_name,state,email,is_active,is_headquarters,fingerprint)
        """
    )
    con.execute(
        f"COPY (SELECT * FROM rows) TO '{active}' "
        "(FORMAT PARQUET, PARTITION_BY (state), OVERWRITE_OR_IGNORE)"
    )
    con.close()


@requires_pgvector
def test_sink_loads_and_swaps(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_active_parquet(tmp_path)
    monkeypatch.setenv("SINK", "POSTGRES")
    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", "companies_test")
    reset_settings()

    result = PostgresSink(tmp_path).load()
    assert result.rows_loaded == 2

    engine = create_engine(PG_URL.replace("postgresql://", "postgresql+psycopg://"))
    with engine.connect() as conn:
        n = conn.execute(text("SELECT count(*) FROM companies_test")).scalar()
        assert n == 2
        # search_text populated and embedding column present but NULL
        row = conn.execute(
            text("SELECT search_text, embedding FROM companies_test WHERE cnpj = '11111111000190'")
        ).one()
        assert "ACME" in row[0] and "SAO PAULO" in row[0]
        assert row[1] is None
        # unique index on cnpj exists
        conn.execute(text("SELECT cnpj FROM companies_test WHERE state = 'SP'"))
    engine.dispose()


@requires_pgvector
def test_sink_opening_year_filter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_active_parquet(tmp_path)
    monkeypatch.setenv("SINK", "POSTGRES")
    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", "companies_2026")
    monkeypatch.setenv("SINK_ACTIVE_OPENING_YEAR", "2026")
    reset_settings()

    result = PostgresSink(tmp_path).load()
    assert result.rows_loaded == 1  # only the 2026 company (>= 2026 excludes 2019)

    engine = create_engine(PG_URL.replace("postgresql://", "postgresql+psycopg://"))
    with engine.connect() as conn:
        only = conn.execute(text("SELECT cnpj FROM companies_2026")).scalars().all()
        assert only == ["11111111000190"]
    engine.dispose()


@requires_pgvector
def test_sink_opening_year_is_a_minimum(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_active_parquet(tmp_path)
    monkeypatch.setenv("SINK", "POSTGRES")
    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", "companies_from_2019")
    monkeypatch.setenv("SINK_ACTIVE_OPENING_YEAR", "2019")
    reset_settings()

    result = PostgresSink(tmp_path).load()
    assert result.rows_loaded == 2  # 2019 and 2026 both >= 2019


@requires_pgvector
def test_sink_refuses_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_active_parquet(tmp_path)
    monkeypatch.setenv("SINK", "POSTGRES")
    monkeypatch.setenv("SINK_DATABASE_URL", PG_URL)
    monkeypatch.setenv("SINK_TABLE", "companies_empty")
    monkeypatch.setenv("SINK_ACTIVE_OPENING_YEAR", "2100")  # matches nothing (future year)
    reset_settings()

    with pytest.raises(SinkError):
        PostgresSink(tmp_path).load()
