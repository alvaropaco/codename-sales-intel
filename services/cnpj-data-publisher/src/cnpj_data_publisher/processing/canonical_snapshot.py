"""Canonical snapshot construction with DuckDB (spec sections 10 and 12).

All heavy lifting stays inside DuckDB so memory use is bounded regardless of
dataset size. The normalization SQL mirrors ``processing.normalizer`` exactly;
``tests/unit/test_normalizer_parity.py`` guards the two implementations.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger
from cnpj_data_publisher.processing._duckdb import fetch_one, fetch_scalar
from cnpj_data_publisher.processing.normalizer import (
    ACTIVE_STATUS_CODE,
    HEADQUARTERS_CODE,
)
from cnpj_data_publisher.receita.layouts import (
    CSV_DELIMITER,
    CSV_ENCODING,
    CSV_QUOTECHAR,
    Layout,
    classify_file,
    get_layout,
)

logger = get_logger(__name__)

SNAPSHOT_MANIFEST = "manifest.json"

# --- Reusable SQL fragments mirroring normalizer.py --------------------
_CLEAN = "nullif(trim(regexp_replace({col}, '[[:cntrl:]]', '', 'g')), '')"


def _clean(col: str) -> str:
    return _CLEAN.format(col=col)


def _upper(col: str) -> str:
    return f"upper({_clean(col)})"


def _digits(col: str) -> str:
    return f"nullif(regexp_replace(coalesce({col}, ''), '[^0-9]', '', 'g'), '')"


def _date(col: str) -> str:
    d = _digits(col)
    return (
        f"CASE WHEN {d} IS NULL OR length({d}) <> 8 OR {d} IN ('00000000','99999999') "
        f"THEN NULL ELSE try_strptime({d}, '%Y%m%d')::DATE END"
    )


def _decimal(col: str) -> str:
    c = _clean(col)
    return f"try_cast(replace(replace(replace({c}, ' ', ''), '.', ''), ',', '.') AS DECIMAL(20,2))"


def _flag(col: str) -> str:
    return f"(upper({_clean(col)}) = 'S')"


@dataclass(slots=True)
class SnapshotStats:
    total_rows: int = 0
    active_rows: int = 0
    headquarters_rows: int = 0
    branches_rows: int = 0
    rejected_rows: int = 0
    partitions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "active_rows": self.active_rows,
            "headquarters_rows": self.headquarters_rows,
            "branches_rows": self.branches_rows,
            "rejected_rows": self.rejected_rows,
            "partitions": sorted(self.partitions),
        }


class SnapshotBuildError(RuntimeError):
    pass


class CanonicalSnapshotBuilder:
    """Builds ``all/`` and ``active/`` Parquet datasets partitioned by state."""

    def __init__(
        self,
        snapshot_version: str,
        extracted_dir: Path,
        output_dir: Path | None = None,
        rejected_dir: Path | None = None,
    ) -> None:
        self.settings = get_settings()
        self.snapshot_version = snapshot_version
        self.extracted_dir = extracted_dir
        self.building_dir = output_dir or self.settings.snapshot_building_dir(snapshot_version)
        self.final_dir = self.settings.snapshot_dir(snapshot_version)
        self.rejected_dir = rejected_dir or self.settings.rejected_dir(snapshot_version)
        self.stats = SnapshotStats()

    # -- DuckDB -----------------------------------------------------------
    def _connect(self) -> duckdb.DuckDBPyConnection:
        """Open a file-backed database.

        An in-memory database cannot spill intermediate results, so peak memory
        would grow with the dataset. Backing the database with a file lets
        DuckDB honour ``memory_limit`` and spill to ``temp_directory`` instead,
        keeping the pipeline streaming regardless of snapshot size.
        """
        self.settings.temporary_dir.mkdir(parents=True, exist_ok=True)
        self._db_path = self.settings.temporary_dir / f"build-{self.snapshot_version}.duckdb"
        self._db_path.unlink(missing_ok=True)

        con = duckdb.connect(str(self._db_path))
        con.execute(f"SET memory_limit='{self.settings.duckdb_memory_limit}'")
        con.execute(f"SET threads={self.settings.duckdb_threads}")
        con.execute(f"SET temp_directory='{self.settings.temporary_dir}'")
        con.execute("SET preserve_insertion_order=false")
        return con

    def _cleanup_db(self) -> None:
        path = getattr(self, "_db_path", None)
        if path is not None:
            path.unlink(missing_ok=True)
            Path(str(path) + ".wal").unlink(missing_ok=True)

    def _files_for(self, layout: Layout) -> list[str]:
        matches = [
            str(path)
            for path in sorted(self.extracted_dir.iterdir())
            if path.is_file() and classify_file(path.name) is layout
        ]
        return matches

    def _read_csv(self, con: duckdb.DuckDBPyConnection, layout: Layout, table: str) -> int:
        """Register one layout as a DuckDB table. Returns the row count."""
        files = self._files_for(layout)
        columns = ", ".join(f"'{c}': 'VARCHAR'" for c in layout.columns)

        if not files:
            # An empty, correctly-typed view keeps downstream SQL valid.
            empty_cols = ", ".join(f"NULL::VARCHAR AS {c}" for c in layout.columns)
            con.execute(f"CREATE VIEW {table} AS SELECT {empty_cols} WHERE false")
            logger.warning("layout_missing", layout=layout.name)
            return 0

        file_list = ", ".join(f"'{f}'" for f in files)
        con.execute(
            f"""
            CREATE VIEW {table} AS
            SELECT * FROM read_csv(
                [{file_list}],
                delim='{CSV_DELIMITER}',
                quote='{CSV_QUOTECHAR}',
                header=false,
                encoding='{CSV_ENCODING}',
                columns={{{columns}}},
                ignore_errors=true,
                null_padding=true,
                parallel=false
            )
            """
        )
        logger.info("layout_loaded", layout=layout.name, files=len(files))
        return 0

    # -- build -----------------------------------------------------------
    def build(self) -> SnapshotStats:
        if self.building_dir.exists():
            shutil.rmtree(self.building_dir)
        self.building_dir.mkdir(parents=True, exist_ok=True)
        self.rejected_dir.mkdir(parents=True, exist_ok=True)

        con = self._connect()
        try:
            self._load_sources(con)
            self._build_canonical(con)
            self._capture_rejects(con)
            self._write_parquet(con)
            self._collect_stats(con)
            self._write_manifest()
        finally:
            con.close()
            self._cleanup_db()

        logger.info(
            "snapshot_built",
            snapshot_version=self.snapshot_version,
            **self.stats.as_dict(),
        )
        return self.stats

    def _load_sources(self, con: duckdb.DuckDBPyConnection) -> None:
        # Large files stay as lazy views so the final COPY streams them.
        self._read_csv(con, get_layout("empresas"), "raw_empresas")
        self._read_csv(con, get_layout("estabelecimentos"), "raw_estabelecimentos")
        self._read_csv(con, get_layout("simples"), "raw_simples")

        # Lookup tables are tiny and joined repeatedly, so materialize them.
        for lookup in ("cnaes", "municipios", "naturezas", "paises", "qualificacoes", "motivos"):
            view = f"raw_{lookup}_src"
            self._read_csv(con, get_layout(lookup), view)
            con.execute(f"CREATE TABLE raw_{lookup} AS SELECT * FROM {view}")

    def _build_canonical(self, con: duckdb.DuckDBPyConnection) -> None:
        """Join and normalize everything into a single canonical table."""
        con.execute(
            f"""
            CREATE VIEW canonical AS
            WITH est AS (
                SELECT
                    lpad(upper(nullif(trim(cnpj_basic), '')), 8, '0')        AS cnpj_basic,
                    lpad(upper(nullif(trim(cnpj_order), '')), 4, '0')        AS cnpj_order,
                    lpad(upper(nullif(trim(cnpj_check_digits), '')), 2, '0') AS cnpj_check_digits,
                    {_clean("headquarters_branch")}                          AS hq_code,
                    {_upper("trade_name")}                                   AS trade_name,
                    lpad({_clean("registration_status_code")}, 2, '0')       AS registration_status_code,
                    {_date("registration_status_date")}                      AS registration_status_date,
                    {_clean("registration_status_reason")}                   AS registration_status_reason_code,
                    {_date("opening_date")}                                  AS opening_date,
                    nullif(lpad({_digits("main_cnae")}, 7, '0'), '0000000')   AS main_cnae,
                    {_clean("secondary_cnaes")}                              AS secondary_cnaes_raw,
                    {_upper("street_type")}                                  AS street_type,
                    {_upper("street")}                                       AS street,
                    {_upper("number")}                                       AS number,
                    {_upper("complement")}                                   AS complement,
                    {_upper("district")}                                     AS district,
                    CASE WHEN length(lpad({_digits("postal_code")}, 8, '0')) = 8
                              AND lpad({_digits("postal_code")}, 8, '0') <> '00000000'
                         THEN lpad({_digits("postal_code")}, 8, '0') END      AS postal_code,
                    CASE WHEN length({_upper("state")}) = 2 THEN {_upper("state")} END AS state,
                    {_digits("city_code")}                                   AS city_code,
                    {_digits("country_code")}                                AS country_code,
                    {_digits("area_code_1")}                                 AS area_code_1,
                    {_digits("phone_1")}                                     AS phone_1,
                    {_digits("area_code_2")}                                 AS area_code_2,
                    {_digits("phone_2")}                                     AS phone_2,
                    {_digits("fax_area_code")}                               AS fax_area_code,
                    {_digits("fax")}                                         AS fax,
                    lower({_clean("email")})                                 AS email_raw
                FROM raw_estabelecimentos
                -- The Receita export occasionally repeats a full CNPJ. Keep one
                -- row per establishment so the diff and sink never see a
                -- duplicate company (the validator enforces CNPJ uniqueness).
                -- No ORDER BY: the duplicate rows are identical, and omitting it
                -- lets DuckDB use hash partitioning instead of a global sort.
                QUALIFY row_number() OVER (
                    PARTITION BY cnpj_basic, cnpj_order, cnpj_check_digits
                ) = 1
            ),
            emp AS (
                SELECT
                    lpad(upper(nullif(trim(cnpj_basic), '')), 8, '0') AS cnpj_basic,
                    {_upper("legal_name")}                            AS legal_name,
                    {_clean("legal_nature_code")}                     AS legal_nature_code,
                    {_decimal("share_capital")}                       AS share_capital,
                    lpad({_clean("company_size_code")}, 2, '0')       AS company_size_code
                FROM raw_empresas
                -- The Receita export occasionally repeats a cnpj_basic. Keep one
                -- row per company so the establishment join can never fan out
                -- (a duplicate here multiplies every branch of that company).
                QUALIFY row_number() OVER (
                    PARTITION BY lpad(upper(nullif(trim(cnpj_basic), '')), 8, '0')
                    ORDER BY legal_name
                ) = 1
            ),
            simp AS (
                SELECT
                    lpad(upper(nullif(trim(cnpj_basic), '')), 8, '0') AS cnpj_basic,
                    {_flag("simple_tax_option")}                      AS simple_tax_option,
                    {_flag("mei_option")}                             AS mei_option
                FROM raw_simples
                -- Same defensive dedup: one Simples row per company.
                QUALIFY row_number() OVER (
                    PARTITION BY lpad(upper(nullif(trim(cnpj_basic), '')), 8, '0')
                    ORDER BY simple_tax_option DESC, mei_option DESC
                ) = 1
            ),
            cnae_lk AS (
                SELECT lpad({_digits("code")}, 7, '0') AS code, {_clean("description")} AS description
                FROM raw_cnaes
            ),
            city_lk AS (
                SELECT {_digits("code")} AS code, {_upper("description")} AS description
                FROM raw_municipios
            ),
            nature_lk AS (
                SELECT {_clean("code")} AS code, {_upper("description")} AS description
                FROM raw_naturezas
            ),
            reason_lk AS (
                SELECT {_clean("code")} AS code, {_upper("description")} AS description
                FROM raw_motivos
            )
            SELECT
                est.cnpj_basic || est.cnpj_order || est.cnpj_check_digits AS cnpj,
                est.cnpj_basic,
                est.cnpj_order,
                est.cnpj_check_digits,
                CASE est.hq_code
                    WHEN '{HEADQUARTERS_CODE}' THEN 'HEADQUARTERS'
                    WHEN '2' THEN 'BRANCH'
                    ELSE 'UNKNOWN'
                END AS headquarters_branch,
                emp.legal_name,
                est.trade_name,
                CASE est.registration_status_code
                    WHEN '01' THEN 'NULL'
                    WHEN '02' THEN 'ACTIVE'
                    WHEN '03' THEN 'SUSPENDED'
                    WHEN '04' THEN 'UNFIT'
                    WHEN '08' THEN 'CLOSED'
                    ELSE 'UNKNOWN'
                END AS registration_status,
                est.registration_status_code,
                est.registration_status_date,
                reason_lk.description AS registration_status_reason,
                est.opening_date,
                emp.legal_nature_code,
                nature_lk.description AS legal_nature_description,
                est.main_cnae,
                cnae_lk.description AS main_cnae_description,
                COALESCE(
                    list_sort(list_distinct(
                        list_filter(
                            list_transform(
                                str_split(COALESCE(est.secondary_cnaes_raw, ''), ','),
                                x -> nullif(lpad(regexp_replace(x, '[^0-9]', '', 'g'), 7, '0'), '0000000')
                            ),
                            x -> x IS NOT NULL AND length(x) = 7
                        )
                    )),
                    []
                ) AS secondary_cnaes,
                emp.company_size_code,
                emp.share_capital,
                COALESCE(simp.simple_tax_option, false) AS simple_tax_option,
                COALESCE(simp.mei_option, false)        AS mei_option,
                est.street_type,
                est.street,
                est.number,
                est.complement,
                est.district,
                est.postal_code,
                est.city_code,
                city_lk.description AS city_name,
                est.state,
                est.country_code,
                est.area_code_1,
                est.phone_1,
                est.area_code_2,
                est.phone_2,
                est.fax_area_code,
                est.fax,
                CASE WHEN regexp_matches(est.email_raw, '^[^@[:space:]]+@[^@[:space:].]+(\\.[^@[:space:].]+)+$')
                     THEN est.email_raw END AS email,
                (est.registration_status_code = '{ACTIVE_STATUS_CODE}') AS is_active,
                (est.hq_code = '{HEADQUARTERS_CODE}')                   AS is_headquarters
            FROM est
            LEFT JOIN emp       ON emp.cnpj_basic = est.cnpj_basic
            LEFT JOIN simp      ON simp.cnpj_basic = est.cnpj_basic
            LEFT JOIN cnae_lk   ON cnae_lk.code = est.main_cnae
            LEFT JOIN city_lk   ON city_lk.code = est.city_code
            LEFT JOIN nature_lk ON nature_lk.code = emp.legal_nature_code
            LEFT JOIN reason_lk ON reason_lk.code = est.registration_status_reason_code
            """
        )

        # Fingerprint over the exact spec field list, computed inside DuckDB so
        # it never materializes millions of Python dicts.
        #
        # struct_pack preserves declaration order, so fields are declared
        # alphabetically to match Python's json.dumps(sort_keys=True).
        # to_json is null-safe, unlike string concatenation.
        con.execute(
            """
            CREATE TABLE canonical_fp AS
            SELECT *,
                sha256(to_json(struct_pack(
                    address := struct_pack(
                        city_code   := city_code,
                        city_name   := city_name,
                        complement  := complement,
                        country_code := country_code,
                        district    := district,
                        number      := number,
                        postal_code := postal_code,
                        state       := state,
                        street      := street,
                        street_type := street_type
                    ),
                    cnpj := cnpj,
                    company_size_code := company_size_code,
                    contacts := struct_pack(
                        email := email,
                        fax := CASE
                            WHEN fax IS NULL OR length(fax) < 7 THEN NULL
                            ELSE coalesce(fax_area_code, '') || fax
                        END,
                        phones := list_sort(list_filter([
                            CASE WHEN phone_1 IS NOT NULL AND length(phone_1) >= 7
                                      AND area_code_1 IS NOT NULL
                                 THEN area_code_1 || '-' || phone_1 END,
                            CASE WHEN phone_2 IS NOT NULL AND length(phone_2) >= 7
                                      AND area_code_2 IS NOT NULL
                                 THEN area_code_2 || '-' || phone_2 END
                        ], x -> x IS NOT NULL))
                    ),
                    headquarters_branch := headquarters_branch,
                    legal_name := legal_name,
                    legal_nature_code := legal_nature_code,
                    main_cnae := main_cnae,
                    mei_option := mei_option,
                    opening_date := strftime(opening_date, '%Y-%m-%d'),
                    registration_status_code := registration_status_code,
                    registration_status_date := strftime(registration_status_date, '%Y-%m-%d'),
                    secondary_cnaes := secondary_cnaes,
                    share_capital := printf('%.2f', share_capital),
                    simple_tax_option := simple_tax_option,
                    trade_name := trade_name
                ))::VARCHAR) AS fingerprint
            FROM canonical
            WHERE cnpj IS NOT NULL AND length(cnpj) = 14
            """
        )

    def _capture_rejects(self, con: duckdb.DuckDBPyConnection) -> None:
        """Rows that could not produce a usable CNPJ are quarantined."""
        con.execute(
            """
            CREATE VIEW rejects AS
            SELECT * FROM canonical
            WHERE cnpj IS NULL OR length(cnpj) <> 14
            """
        )
        count = int(fetch_scalar(con, "SELECT count(*) FROM rejects"))
        self.stats.rejected_rows = count
        if count:
            target = self.rejected_dir / "rejected.parquet"
            con.execute(
                f"COPY rejects TO '{target}' (FORMAT PARQUET, COMPRESSION "
                f"'{self.settings.parquet_compression}')"
            )
            logger.warning("rows_rejected", snapshot_version=self.snapshot_version, rows=count)

    def _write_parquet(self, con: duckdb.DuckDBPyConnection) -> None:
        compression = self.settings.parquet_compression
        row_group = self.settings.parquet_row_group_size
        # canonical_fp is materialized, so both datasets stream from one pass
        # over the already-joined and already-fingerprinted rows.

        # ``all/`` keeps every establishment. ``active/`` is the publication
        # dataset and honours INCLUDE_BRANCHES (spec section 11).
        active_where = "WHERE is_active"
        if not self.settings.include_branches:
            active_where += " AND is_headquarters"

        for dataset, where in (("all", ""), ("active", active_where)):
            target = self.building_dir / dataset
            target.mkdir(parents=True, exist_ok=True)
            con.execute(
                f"""
                COPY (SELECT * FROM canonical_fp {where})
                TO '{target}' (
                    FORMAT PARQUET,
                    COMPRESSION '{compression}',
                    ROW_GROUP_SIZE {row_group},
                    PARTITION_BY (state),
                    OVERWRITE_OR_IGNORE
                )
                """
            )

    def _collect_stats(self, con: duckdb.DuckDBPyConnection) -> None:
        # Read back the written dataset instead of recomputing the projection.
        dataset = f"read_parquet('{self.building_dir / 'all' / '**' / '*.parquet'}')"
        row = fetch_one(
            con,
            f"""
            SELECT
                count(*),
                count(*) FILTER (WHERE is_active),
                count(*) FILTER (WHERE is_headquarters),
                count(*) FILTER (WHERE NOT is_headquarters)
            FROM {dataset}
            """,
        )
        self.stats.total_rows = int(row[0])
        self.stats.active_rows = int(row[1])
        self.stats.headquarters_rows = int(row[2])
        self.stats.branches_rows = int(row[3])

        partitions = con.execute(
            f"SELECT DISTINCT state FROM {dataset} WHERE state IS NOT NULL ORDER BY 1"
        ).fetchall()
        self.stats.partitions = [p[0] for p in partitions]

    def _write_manifest(self) -> None:
        manifest = {
            "snapshot_version": self.snapshot_version,
            "schema_version": self.settings.schema_version,
            "created_at": datetime.now(UTC).isoformat(),
            "include_branches": self.settings.include_branches,
            "compression": self.settings.parquet_compression,
            "row_group_size": self.settings.parquet_row_group_size,
            **self.stats.as_dict(),
        }
        path = self.building_dir / SNAPSHOT_MANIFEST
        path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # -- promotion --------------------------------------------------------
    def promote(self) -> Path:
        """Atomically replace the published snapshot with the built one."""
        if not self.building_dir.exists():
            raise SnapshotBuildError(f"nothing to promote at {self.building_dir}")

        self.final_dir.parent.mkdir(parents=True, exist_ok=True)
        backup: Path | None = None
        if self.final_dir.exists():
            backup = self.final_dir.with_name(self.final_dir.name + ".previous")
            shutil.rmtree(backup, ignore_errors=True)
            self.final_dir.rename(backup)

        try:
            self.building_dir.rename(self.final_dir)
        except OSError:
            if backup is not None:
                backup.rename(self.final_dir)
            raise

        if backup is not None:
            shutil.rmtree(backup, ignore_errors=True)

        logger.info(
            "snapshot_promoted", snapshot_version=self.snapshot_version, path=str(self.final_dir)
        )
        return self.final_dir

    def discard(self) -> None:
        """Remove the build directory, leaving any published snapshot intact."""
        shutil.rmtree(self.building_dir, ignore_errors=True)


def read_snapshot_manifest(snapshot_dir: Path) -> dict[str, Any] | None:
    path = snapshot_dir / SNAPSHOT_MANIFEST
    if not path.exists():
        return None
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data
