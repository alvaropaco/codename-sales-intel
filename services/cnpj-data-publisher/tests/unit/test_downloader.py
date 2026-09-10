"""Unit tests for the streaming downloader."""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from cnpj_data_publisher.receita.discovery import RemoteFile
from cnpj_data_publisher.receita.downloader import (
    Downloader,
    DownloadError,
    IntegrityError,
    sha256_file,
)
from cnpj_data_publisher.receita.manifest import DownloadManifest

pytestmark = pytest.mark.unit

PAYLOAD = b"cnpj;razao_social\n" + b"x" * 4096
URL = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/2026-07/Empresas0.zip"


def _ok_client(payload: bytes = PAYLOAD, support_range: bool = True) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        range_header = request.headers.get("range")
        if range_header and support_range:
            start = int(range_header.removeprefix("bytes=").split("-")[0])
            if start >= len(payload):
                return httpx.Response(416)
            return httpx.Response(206, content=payload[start:])
        return httpx.Response(200, content=payload)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_download_writes_file_and_manifest(tmp_path: Path) -> None:
    dl = Downloader(tmp_path / "2026-07", client=_ok_client())
    remote = RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD))

    result = dl.download_file(remote)

    assert result.path.exists()
    assert result.size == len(PAYLOAD)
    assert result.sha256 == hashlib.sha256(PAYLOAD).hexdigest()
    assert result.path.read_bytes() == PAYLOAD

    manifest = DownloadManifest.load(tmp_path / "2026-07")
    assert manifest is not None
    entry = manifest.get("Empresas0.zip")
    assert entry is not None
    assert entry.verified is True
    assert entry.sha256 == result.sha256


def test_no_partial_file_left_behind(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dl = Downloader(dest, client=_ok_client())
    dl.download_file(RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD)))

    assert list(dest.glob("*.partial")) == []


def test_size_mismatch_rejects_file(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dl = Downloader(dest, client=_ok_client())
    remote = RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD) + 999)

    with pytest.raises(IntegrityError, match="expected"):
        dl.download_file(remote)

    assert not (dest / "Empresas0.zip").exists()
    assert list(dest.glob("*.rejected"))


def test_resume_from_partial(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dest.mkdir(parents=True)
    # Simulate an interrupted download.
    (dest / "Empresas0.zip.partial").write_bytes(PAYLOAD[:1000])

    dl = Downloader(dest, client=_ok_client())
    result = dl.download_file(RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD)))

    assert result.resumed is True
    assert result.path.read_bytes() == PAYLOAD


def test_restart_when_server_ignores_range(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dest.mkdir(parents=True)
    (dest / "Empresas0.zip.partial").write_bytes(b"stale-bytes")

    dl = Downloader(dest, client=_ok_client(support_range=False))
    result = dl.download_file(RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD)))

    assert result.path.read_bytes() == PAYLOAD


def test_second_run_skips_verified_file(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    remote = RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD))

    first = Downloader(dest, client=_ok_client())
    first.download_file(remote)

    second = Downloader(dest, client=_ok_client())
    result = second.download_file(remote)

    assert result.skipped is True


def test_host_not_allowed(tmp_path: Path) -> None:
    dl = Downloader(tmp_path / "2026-07", client=_ok_client())
    remote = RemoteFile(name="evil.zip", url="https://evil.example.com/evil.zip")

    with pytest.raises(DownloadError, match="RECEITA_ALLOWED_HOSTS"):
        dl.download_file(remote)


def test_download_all_and_verify(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dl = Downloader(dest, client=_ok_client())
    files = [RemoteFile(name=f"Empresas{i}.zip", url=URL, size=len(PAYLOAD)) for i in range(3)]

    results = dl.download_all(files)

    assert len(results) == 3
    assert dl.verify_all() == []

    manifest = DownloadManifest.load(dest)
    assert manifest is not None
    assert manifest.all_verified is True
    assert manifest.completed_at is not None


def test_verify_detects_corruption(tmp_path: Path) -> None:
    dest = tmp_path / "2026-07"
    dl = Downloader(dest, client=_ok_client())
    dl.download_all([RemoteFile(name="Empresas0.zip", url=URL, size=len(PAYLOAD))])

    (dest / "Empresas0.zip").write_bytes(b"corrupted")

    problems = dl.verify_all()
    assert problems
    assert "Empresas0.zip" in problems[0]


def test_sha256_file(tmp_path: Path) -> None:
    path = tmp_path / "sample.bin"
    path.write_bytes(PAYLOAD)
    assert sha256_file(path) == hashlib.sha256(PAYLOAD).hexdigest()
