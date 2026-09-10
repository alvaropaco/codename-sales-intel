"""Integration tests for the DuckDB canonical snapshot builder."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from cnpj_data_publisher.processing.canonical_snapshot import (
    CanonicalSnapshotBuilder,
    read_snapshot_manifest,
)
from cnpj_data_publisher.receita.extractor import Extractor

from tests.fixtures.builder import build_snapshot_fixture

pytestmark = pytest.mark.unit


def _prepare(tmp_path: Path, snapshot: str) -> Path:
    """Build fixtures, extract them and return the extraction directory."""
    downloads = build_snapshot_fixture(tmp_path / "downloads", snapshot)
    extracted = tmp_path / "extracted" / snapshot
    Extractor(extracted).extract_all(sorted(downloads.glob("*.zip")))
    return extracted


def _build(tmp_path: Path, snapshot: str) -> CanonicalSnapshotBuilder:
    extracted = _prepare(tmp_path, snapshot)
    builder = CanonicalSnapshotBuilder(
        snapshot_version=snapshot,
        extracted_dir=extracted,
        output_dir=tmp_path / "building" / snapshot,
        rejected_dir=tmp_path / "rejected" / snapshot,
    )
    builder.build()
    return builder


def _query(builder: CanonicalSnapshotBuilder, sql: str) -> list[tuple]:
    dataset = builder.building_dir / "all" / "**" / "*.parquet"
    con = duckdb.connect(":memory:")
    try:
        return con.execute(sql.replace("{data}", f"read_parquet('{dataset}')")).fetchall()
    finally:
        con.close()


def test_builds_partitioned_datasets(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")

    assert (builder.building_dir / "all").is_dir()
    assert (builder.building_dir / "active").is_dir()
    assert sorted(p.name for p in (builder.building_dir / "all").iterdir() if p.is_dir())


def test_partition_by_state(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    partitions = {p.name for p in (builder.building_dir / "all").iterdir() if p.is_dir()}
    assert "state=SP" in partitions
    assert "state=RJ" in partitions
    assert "state=MG" in partitions


def test_cnpj_is_text_and_14_chars(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = _query(builder, "SELECT cnpj, typeof(cnpj) FROM {data} ORDER BY cnpj")

    assert rows, "expected canonical rows"
    for cnpj, dtype in rows:
        assert dtype == "VARCHAR"
        assert len(cnpj) == 14
        assert cnpj.isdigit() or cnpj.isalnum()


def test_status_mapping(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, registration_status FROM {data}"))

    assert rows["11111111000190"] == "ACTIVE"
    assert rows["44444444000190"] == "CLOSED"
    assert rows["66666666000190"] == "UNFIT"


def test_share_capital_decimal_and_invalid_becomes_null(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, share_capital FROM {data}"))

    assert float(rows["11111111000190"]) == 150000.00
    assert rows["77777777000190"] is None  # "abc,xx" is not parseable


def test_invalid_date_becomes_null(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, opening_date FROM {data}"))

    assert rows["77777777000190"] is None
    assert rows["11111111000190"] is not None


def test_secondary_cnaes_sorted_and_deduped(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, secondary_cnaes FROM {data}"))

    assert rows["11111111000190"] == ["6202300"]
    assert rows["22222222000190"] == []


def test_lookup_descriptions_joined(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = _query(
        builder,
        "SELECT main_cnae_description, city_name, legal_nature_description "
        "FROM {data} WHERE cnpj = '11111111000190'",
    )
    cnae_desc, city, nature = rows[0]

    assert "programas de computador" in cnae_desc.lower()
    assert city == "SAO PAULO"
    assert "LIMITADA" in nature


def test_simples_and_mei_flags(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, (simple_tax_option, mei_option) FROM {data}"))

    assert rows["11111111000190"] == (True, False)
    assert rows["55555555000190"] == (True, True)
    assert rows["33333333000190"] == (False, False)


def test_email_normalized_and_invalid_dropped(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    rows = dict(_query(builder, "SELECT cnpj, email FROM {data}"))

    assert rows["11111111000190"] == "novo@acme.com.br"


def test_fingerprint_present_and_stable(tmp_path: Path) -> None:
    first = _build(tmp_path / "a", "2026-07")
    second = _build(tmp_path / "b", "2026-07")

    fp1 = dict(_query(first, "SELECT cnpj, fingerprint FROM {data}"))
    fp2 = dict(_query(second, "SELECT cnpj, fingerprint FROM {data}"))

    assert fp1 == fp2, "fingerprints must be deterministic across builds"
    assert all(len(v) == 64 for v in fp1.values())  # sha256 hex digest


def test_fingerprint_changes_when_data_changes(tmp_path: Path) -> None:
    june = _build(tmp_path / "june", "2026-06")
    july = _build(tmp_path / "july", "2026-07")

    fp_june = dict(_query(june, "SELECT cnpj, fingerprint FROM {data}"))
    fp_july = dict(_query(july, "SELECT cnpj, fingerprint FROM {data}"))

    # ACME changed email + capital.
    assert fp_june["11111111000190"] != fp_july["11111111000190"]
    # Stable company did not change.
    assert fp_june["22222222000190"] == fp_july["22222222000190"]


def test_active_dataset_only_has_active_headquarters(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    dataset = builder.building_dir / "active" / "**" / "*.parquet"
    con = duckdb.connect(":memory:")
    try:
        rows = con.execute(
            f"SELECT cnpj, is_active, is_headquarters FROM read_parquet('{dataset}')"
        ).fetchall()
    finally:
        con.close()

    assert rows
    assert all(active and hq for _, active, hq in rows)
    cnpjs = {r[0] for r in rows}
    assert "44444444000190" not in cnpjs  # closed
    assert "66666666000190" not in cnpjs  # unfit


def test_duplicate_establishment_cnpj_is_deduped(tmp_path: Path) -> None:
    """A Receita export can repeat a full CNPJ; the builder must keep one row."""
    from tests.fixtures import builder as b  # noqa: PLC0415

    downloads = tmp_path / "downloads" / "2026-07"
    downloads.mkdir(parents=True, exist_ok=True)

    b._write_zip(
        downloads / "Empresas0.zip",
        "K3241.K03200Y0.D50111.EMPRECSV",
        b._row("11111111", "DUPLICADA LTDA", "2062", "49", "1000,00", "03", ""),
    )
    b._write_zip(
        downloads / "Estabelecimentos0.zip",
        "K3241.K03200Y0.D50111.ESTABELE",
        "\n".join([b._estab("11111111", "02"), b._estab("11111111", "02")]),
    )
    b._write_zip(downloads / "Simples.zip", "F.K03200$W.SIMPLES.CSV.D50111", b.SIMPLES)
    b._write_zip(downloads / "Cnaes.zip", "F.K03200$Z.D50111.CNAECSV", b.CNAES)
    b._write_zip(downloads / "Municipios.zip", "F.K03200$Z.D50111.MUNICCSV", b.MUNICIPIOS)
    b._write_zip(downloads / "Naturezas.zip", "F.K03200$Z.D50111.NATJUCSV", b.NATUREZAS)
    b._write_zip(downloads / "Paises.zip", "F.K03200$Z.D50111.PAISCSV", b.PAISES)
    b._write_zip(downloads / "Qualificacoes.zip", "F.K03200$Z.D50111.QUALSCSV", b.QUALIFICACOES)
    b._write_zip(downloads / "Motivos.zip", "F.K03200$Z.D50111.MOTICSV", b.MOTIVOS)

    extracted = tmp_path / "extracted" / "2026-07"
    Extractor(extracted).extract_all(sorted(downloads.glob("*.zip")))

    builder = CanonicalSnapshotBuilder(
        snapshot_version="2026-07",
        extracted_dir=extracted,
        output_dir=tmp_path / "building" / "2026-07",
        rejected_dir=tmp_path / "rejected" / "2026-07",
    )
    builder.build()

    rows = _query(builder, "SELECT count(*) FROM {data}")
    assert rows[0][0] == 1, "duplicated establishment CNPJ must be deduplicated"


def test_manifest_written(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    manifest = read_snapshot_manifest(builder.building_dir)

    assert manifest is not None
    assert manifest["snapshot_version"] == "2026-07"
    assert manifest["schema_version"] == 1
    assert manifest["total_rows"] > 0
    assert manifest["active_rows"] > 0
    assert set(manifest["partitions"]) >= {"MG", "RJ", "SP"}


def test_promote_is_atomic(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    final = builder.promote()

    assert final.exists()
    assert not builder.building_dir.exists()
    assert (final / "manifest.json").exists()


def test_discard_leaves_published_snapshot(tmp_path: Path) -> None:
    builder = _build(tmp_path, "2026-07")
    builder.promote()

    second = _build(tmp_path / "second", "2026-07")
    second.final_dir = builder.final_dir
    second.discard()

    assert builder.final_dir.exists()
