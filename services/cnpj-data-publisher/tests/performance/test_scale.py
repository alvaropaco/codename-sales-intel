"""Performance benchmarks (spec section 40).

Generates synthetic datasets and asserts that memory stays bounded: the
pipeline must never allocate in proportion to the dataset size.

Run explicitly, they are slow:
    pytest tests/performance -m performance -s
    CNPJ_PERF_ROWS=1000000 pytest tests/performance -m performance -s
"""

from __future__ import annotations

import os
import resource
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb
import pytest

from cnpj_data_publisher.processing.canonical_snapshot import CanonicalSnapshotBuilder
from cnpj_data_publisher.processing.diff import DiffEngine

pytestmark = [pytest.mark.performance, pytest.mark.slow]

ROWS = int(os.environ.get("CNPJ_PERF_ROWS", "100000"))
STATES = ("SP", "RJ", "MG", "BA", "RS", "PR", "SC", "GO", "PE", "CE")


def _peak_rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux reports kilobytes.
    return usage / (1024 * 1024) if usage > 10**7 else usage / 1024


@contextmanager
def measure(label: str) -> Iterator[dict[str, float]]:
    stats: dict[str, float] = {}
    before = _peak_rss_mb()
    started = time.perf_counter()
    yield stats
    stats["seconds"] = time.perf_counter() - started
    stats["peak_rss_mb"] = _peak_rss_mb()
    stats["rss_growth_mb"] = stats["peak_rss_mb"] - before
    print(
        f"\n  {label}: {stats['seconds']:.2f}s, "
        f"peak RSS {stats['peak_rss_mb']:.0f}MB "
        f"(+{stats['rss_growth_mb']:.0f}MB)"
    )


def _generate_csvs(directory: Path, rows: int, seed: int = 0) -> None:
    """Write synthetic CSVs in the exact Receita Federal layout via DuckDB."""
    directory.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(":memory:")
    try:
        con.execute("SET preserve_insertion_order=false")
        states = ", ".join(f"'{s}'" for s in STATES)

        con.execute(
            f"""
            CREATE VIEW base AS
            SELECT
                lpad((i + {seed})::VARCHAR, 8, '0') AS basic,
                i AS i
            FROM range({rows}) t(i)
            """
        )

        con.execute(
            f"""
            COPY (
                SELECT basic, 'EMPRESA ' || i || ' LTDA', '2062', '49',
                       (10000 + i % 1000000) || ',00', '03', ''
                FROM base
            ) TO '{directory / "Empresas0.EMPRECSV"}'
            (FORMAT CSV, DELIMITER ';', HEADER false, QUOTE '"', FORCE_QUOTE *)
            """
        )

        con.execute(
            f"""
            COPY (
                SELECT basic, '0001', '90', '1', '',
                       CASE WHEN i % 10 = 0 THEN '08' ELSE '02' END,
                       '20260701', '00', '', '105', '20200115',
                       '6201501', '6202300',
                       'RUA', 'EXEMPLO ' || i, (i % 9999)::VARCHAR, '', 'CENTRO',
                       '01000000', ([{states}])[1 + i % {len(STATES)}], '7107',
                       '11', '9' || lpad((i % 100000000)::VARCHAR, 8, '0'),
                       '', '', '', '',
                       'contato' || i || '@empresa.com.br', '', ''
                FROM base
            ) TO '{directory / "Estabelecimentos0.ESTABELE"}'
            (FORMAT CSV, DELIMITER ';', HEADER false, QUOTE '"', FORCE_QUOTE *)
            """
        )

        con.execute(
            f"""
            COPY (SELECT basic, 'S', '20200201', '', 'N', '', '' FROM base)
            TO '{directory / "Simples.SIMPLES"}'
            (FORMAT CSV, DELIMITER ';', HEADER false, QUOTE '"', FORCE_QUOTE *)
            """
        )

        for name, payload in (
            (
                "Cnaes.CNAECSV",
                [("6201501", "DESENVOLVIMENTO DE PROGRAMAS"), ("6202300", "LICENCIAMENTO")],
            ),
            ("Municipios.MUNICCSV", [("7107", "SAO PAULO")]),
            ("Naturezas.NATJUCSV", [("2062", "SOCIEDADE EMPRESARIA LIMITADA")]),
            ("Paises.PAISCSV", [("105", "BRASIL")]),
            ("Qualificacoes.QUALSCSV", [("49", "SOCIO-ADMINISTRADOR")]),
            ("Motivos.MOTICSV", [("00", "SEM MOTIVO")]),
        ):
            (directory / name).write_text(
                "\n".join(f'"{c}";"{d}"' for c, d in payload), encoding="latin-1"
            )
    finally:
        con.close()


def _build(tmp_path: Path, extracted: Path, version: str) -> Path:
    builder = CanonicalSnapshotBuilder(
        snapshot_version=version,
        extracted_dir=extracted,
        output_dir=tmp_path / "building" / version,
        rejected_dir=tmp_path / "rejected" / version,
    )
    builder.build()
    target = tmp_path / "snapshots" / version
    target.parent.mkdir(parents=True, exist_ok=True)
    builder.building_dir.rename(target)
    return target


# ---------------------------------------------------------------------
def _build_peak_rss_mb(root: Path, rows: int, version: str) -> float:
    """Build a snapshot in a fresh child process and return its peak RSS.

    `resource.getrusage` reports `ru_maxrss` as a monotonic high-water mark for
    the whole process lifetime. Measuring two builds in one process would make
    the second reading include the first build's peak, so the ratio would be
    meaningless. Each size therefore runs in its own interpreter, and the child
    reports `RUSAGE_SELF` for just that build.
    """
    root.mkdir(parents=True, exist_ok=True)
    extracted = root / "extracted"
    script = f"""
import resource, sys
sys.path.insert(0, {str(Path(__file__).parent)!r})
from pathlib import Path
from test_scale import _generate_csvs, _build, _peak_rss_mb

root = Path({str(root)!r})
_generate_csvs(Path({str(extracted)!r}), {rows})
before = _peak_rss_mb()
_build(root, Path({str(extracted)!r}), {version!r})
print(f"PEAK={{_peak_rss_mb():.4f}} GROWTH={{_peak_rss_mb() - before:.4f}}")
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    marker = [ln for ln in completed.stdout.splitlines() if ln.startswith("PEAK=")]
    assert marker, f"child produced no measurement:\n{completed.stdout}\n{completed.stderr}"
    return float(marker[-1].split("PEAK=")[1].split()[0])


def test_snapshot_build_scales(tmp_path: Path) -> None:
    """Memory must grow sub-linearly with row count.

    A fixed byte threshold would only measure DuckDB's configured buffer pool,
    which is deliberately large. What matters for the spec is that memory does
    not grow in proportion to the dataset, so this compares two sizes, each
    measured in its own process (see `_build_peak_rss_mb`).
    """
    small_rows = max(50_000, ROWS // 4)

    small_peak = _build_peak_rss_mb(tmp_path / "small", small_rows, "2026-06")
    print(f"\n  build {small_rows:,} rows: peak RSS {small_peak:.0f}MB")
    large_peak = _build_peak_rss_mb(tmp_path / "large", ROWS, "2026-07")
    print(f"  build {ROWS:,} rows: peak RSS {large_peak:.0f}MB")

    # Rebuild once in-process so the Parquet output can be inspected.
    extracted = tmp_path / "extracted-verify"
    _generate_csvs(extracted, ROWS)
    snapshot = _build(tmp_path / "verify", extracted, "2026-07")

    con = duckdb.connect(":memory:")
    try:
        total = con.execute(
            f"SELECT count(*) FROM read_parquet('{snapshot}/all/**/*.parquet')"
        ).fetchone()
    finally:
        con.close()

    assert total is not None
    assert total[0] == ROWS

    size_mb = sum(f.stat().st_size for f in snapshot.rglob("*.parquet")) / 1e6
    print(f"  parquet size: {size_mb:.1f}MB ({size_mb * 1e6 / ROWS:.0f} bytes/row)")

    data_ratio = ROWS / small_rows
    memory_ratio = large_peak / max(small_peak, 1.0)
    print(f"  data x{data_ratio:.1f} -> memory x{memory_ratio:.2f}")

    assert memory_ratio < data_ratio, (
        f"memory scaled with the dataset: {data_ratio:.1f}x more rows "
        f"produced {memory_ratio:.2f}x more memory"
    )


def test_diff_scales(tmp_path: Path) -> None:
    """Diffing two large snapshots must stay streaming."""
    first = tmp_path / "extracted-06"
    second = tmp_path / "extracted-07"
    _generate_csvs(first, ROWS)
    _generate_csvs(second, ROWS, seed=ROWS // 100)  # 1% new companies

    june = _build(tmp_path, first, "2026-06")
    july = _build(tmp_path, second, "2026-07")

    with measure(f"diff ({ROWS:,} vs {ROWS:,} rows)") as stats:
        result = DiffEngine(
            snapshot_version="2026-07",
            current_dir=july,
            previous_dir=june,
            output_dir=tmp_path / "diffs",
            previous_snapshot_version="2026-06",
        ).run()

    print(f"  counts: {result.counts.as_dict()}")

    assert result.counts.discovered > 0
    # The diff is a hash join streamed straight to Parquet: the marginal cost of
    # comparing two snapshots must stay small relative to building them.
    assert stats["rss_growth_mb"] < 512, f"diff memory grew {stats['rss_growth_mb']:.0f}MB"


def test_event_throughput(tmp_path: Path) -> None:
    """Measure how fast diff rows convert into event payloads."""
    from cnpj_data_publisher.events.company_events import build_discovered

    extracted = tmp_path / "extracted"
    sample = min(ROWS, 50_000)
    _generate_csvs(extracted, sample)
    snapshot = _build(tmp_path, extracted, "2026-07")

    con = duckdb.connect(":memory:")
    try:
        cursor = con.execute(f"SELECT * FROM read_parquet('{snapshot}/active/**/*.parquet')")
        columns = [d[0] for d in cursor.description]
        rows = [dict(zip(columns, r, strict=True)) for r in cursor.fetchall()]
    finally:
        con.close()

    with measure(f"build {len(rows):,} events") as stats:
        for row in rows:
            build_discovered(row, "2026-07")

    per_second = len(rows) / stats["seconds"]
    print(f"  throughput: {per_second:,.0f} events/s")

    assert per_second > 1_000, f"event building is too slow: {per_second:.0f}/s"
