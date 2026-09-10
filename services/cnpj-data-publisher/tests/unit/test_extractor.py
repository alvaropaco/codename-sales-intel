"""Unit tests for safe ZIP extraction."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from cnpj_data_publisher.receita.extractor import (
    ExtractionError,
    Extractor,
    SizeLimitExceeded,
    UnsafePathError,
    is_safe_member_name,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "name",
    [
        "../../etc/passwd",
        "/etc/passwd",
        "a/../../b",
        "",
        "C:\\windows\\system32",
        "\\absolute",
    ],
)
def test_unsafe_names_rejected(name: str) -> None:
    assert is_safe_member_name(name) is False


@pytest.mark.parametrize("name", ["Empresas0.csv", "sub/Empresas0.csv", "K3241.EMPRECSV"])
def test_safe_names_accepted(name: str) -> None:
    assert is_safe_member_name(name) is True


def test_extract_writes_flattened_files(tmp_path: Path, make_zip) -> None:
    archive = make_zip(
        "Empresas0.zip",
        {"nested/dir/K3241.EMPRECSV": b"1;ACME;2062;49;100000,00;03;\n"},
    )
    extractor = Extractor(tmp_path / "extracted")
    result = extractor.extract(archive)

    assert len(result.files) == 1
    extracted = result.files[0]
    assert extracted.name == "K3241.EMPRECSV"  # flattened
    assert extracted.path.parent == tmp_path / "extracted"
    assert extracted.path.read_bytes().startswith(b"1;ACME")
    assert result.total_bytes == extracted.size


def test_invalid_latin1_bytes_sanitized(tmp_path: Path, make_zip) -> None:
    # 0x8F (undefined latin-1 C1 control) and 0x1A (DOS EOF) appear in some
    # Receita Federal exports and abort DuckDB's strict latin-1 reader. They
    # must be replaced with spaces, byte-length preserved, while legitimate
    # accented bytes (0xC7 = Ç, 0xE3 = ã) survive untouched.
    raw = b"1;A\x8fCME\x1a;SItio\xc3\xa3o;\n"
    archive = make_zip("Empresas0.zip", {"K3241.EMPRECSV": raw})
    extractor = Extractor(tmp_path / "extracted")
    result = extractor.extract(archive)

    written = result.files[0].path.read_bytes()
    assert len(written) == len(raw)  # length preserved -> size accounting exact
    assert b"\x8f" not in written
    assert b"\x1a" not in written
    assert written == b"1;A CME ;SItio\xc3\xa3o;\n"
    written.decode("latin-1")  # must now be valid strict latin-1


def test_zip_slip_blocked(tmp_path: Path, make_zip) -> None:
    archive = make_zip("evil.zip", {"../../escape.txt": b"pwned"})
    extractor = Extractor(tmp_path / "extracted")

    with pytest.raises(UnsafePathError):
        extractor.extract(archive)

    assert not (tmp_path / "escape.txt").exists()


def test_absolute_path_blocked(tmp_path: Path, make_zip) -> None:
    archive = make_zip("evil.zip", {"/tmp/pwned.txt": b"pwned"})
    extractor = Extractor(tmp_path / "extracted")

    with pytest.raises(UnsafePathError):
        extractor.extract(archive)


def test_symlink_member_blocked(tmp_path: Path) -> None:
    archive = tmp_path / "symlink.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        info = zipfile.ZipInfo("link")
        info.external_attr = (0xA1FF) << 16  # S_IFLNK | 0777
        zf.writestr(info, "/etc/passwd")

    extractor = Extractor(tmp_path / "extracted")
    with pytest.raises(UnsafePathError, match="symlink"):
        extractor.extract(archive)


def test_per_file_size_limit(tmp_path: Path, make_zip) -> None:
    archive = make_zip("big.zip", {"big.csv": b"x" * 10_000})
    extractor = Extractor(tmp_path / "extracted", max_file_size=1_000)

    with pytest.raises(SizeLimitExceeded):
        extractor.extract(archive)

    assert list((tmp_path / "extracted").glob("*")) == []


def test_total_size_limit(tmp_path: Path, make_zip) -> None:
    archive = make_zip("many.zip", {f"file{i}.csv": b"x" * 1_000 for i in range(5)})
    extractor = Extractor(tmp_path / "extracted", max_total_size=2_000)

    with pytest.raises(SizeLimitExceeded):
        extractor.extract(archive)


def test_corrupt_archive_detected(tmp_path: Path) -> None:
    archive = tmp_path / "corrupt.zip"
    archive.write_bytes(b"not a zip file at all")

    extractor = Extractor(tmp_path / "extracted")
    with pytest.raises(ExtractionError):
        extractor.extract(archive)


def test_missing_archive(tmp_path: Path) -> None:
    extractor = Extractor(tmp_path / "extracted")
    with pytest.raises(ExtractionError, match="not found"):
        extractor.extract(tmp_path / "nope.zip")


def test_extract_all_cleans_up_on_failure(tmp_path: Path, make_zip) -> None:
    good = make_zip("good.zip", {"good.csv": b"ok"})
    evil = make_zip("evil.zip", {"../escape.csv": b"pwned"})

    extractor = Extractor(tmp_path / "extracted")
    with pytest.raises(UnsafePathError):
        extractor.extract_all([good, evil])

    # Everything written by the successful archive must be removed.
    assert list((tmp_path / "extracted").glob("*.csv")) == []


def test_no_partial_files_remain(tmp_path: Path, make_zip) -> None:
    archive = make_zip("Empresas0.zip", {"data.csv": b"a;b;c\n" * 100})
    dest = tmp_path / "extracted"
    Extractor(dest).extract(archive)

    assert list(dest.glob("*.partial")) == []
