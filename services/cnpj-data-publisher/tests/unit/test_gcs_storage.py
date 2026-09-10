"""Unit tests for the native GCS storage backend."""

from __future__ import annotations

from pathlib import Path

import pytest

from cnpj_data_publisher.config import reset_settings
from cnpj_data_publisher.storage.gcs import GCSConfigurationError, GCSStorage


class _FakeBlob:
    def __init__(self, name: str, store: dict[str, bytes]) -> None:
        self.name = name
        self._store = store

    def upload_from_filename(self, path: str) -> None:
        self._store[self.name] = Path(path).read_bytes()

    def delete(self) -> None:
        self._store.pop(self.name, None)

    def exists(self) -> bool:
        return self.name in self._store


class _FakeBucket:
    def __init__(self, store: dict[str, bytes]) -> None:
        self._store = store

    def blob(self, name: str) -> _FakeBlob:
        return _FakeBlob(name, self._store)

    def copy_blob(self, src: _FakeBlob, _dst: _FakeBucket, new_name: str) -> None:
        self._store[new_name] = self._store[src.name]


class _FakeClient:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def bucket(self, _name: str) -> _FakeBucket:
        return _FakeBucket(self.store)

    def list_blobs(self, _bucket: str, prefix: str = ""):
        return [_FakeBlob(k, self.store) for k in list(self.store) if k.startswith(prefix)]


@pytest.fixture
def gcs(monkeypatch: pytest.MonkeyPatch) -> GCSStorage:
    monkeypatch.setenv("GCS_BUCKET", "test-bucket")
    reset_settings()
    return GCSStorage(client=_FakeClient())


def test_requires_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GCS_BUCKET", raising=False)
    reset_settings()
    with pytest.raises(GCSConfigurationError):
        GCSStorage(client=_FakeClient())


def test_upload_file_write_then_promote(gcs: GCSStorage, tmp_path: Path) -> None:
    src = tmp_path / "x.parquet"
    src.write_bytes(b"hello")

    uri = gcs.upload_file(src, "2026-07/all/x.parquet")

    assert uri == "gs://test-bucket/2026-07/all/x.parquet"
    store = gcs.client.store  # type: ignore[attr-defined]
    assert store["2026-07/all/x.parquet"] == b"hello"
    # staging object must be cleaned up after promotion
    assert "2026-07/all/x.parquet.uploading" not in store


def test_upload_directory(gcs: GCSStorage, tmp_path: Path) -> None:
    (tmp_path / "active").mkdir()
    (tmp_path / "active" / "sp.parquet").write_bytes(b"a")
    (tmp_path / "manifest.json").write_text("{}")

    uploaded = gcs.upload_directory(tmp_path, "2026-07")

    assert sorted(uploaded) == [
        "gs://test-bucket/2026-07/active/sp.parquet",
        "gs://test-bucket/2026-07/manifest.json",
    ]


def test_exists_and_delete_prefix(gcs: GCSStorage, tmp_path: Path) -> None:
    (tmp_path / "manifest.json").write_text("{}")
    gcs.upload_directory(tmp_path, "2026-07")

    assert gcs.exists("2026-07/manifest.json")
    assert gcs.delete_prefix("2026-07/") == 1
    assert not gcs.exists("2026-07/manifest.json")


def test_descriptor(gcs: GCSStorage) -> None:
    desc = gcs.descriptor("2026-07/active/", "2026-07/manifest.json")
    assert desc == {
        "type": "GCS",
        "bucket": "test-bucket",
        "prefix": "2026-07/active/",
        "manifest": "2026-07/manifest.json",
        "endpoint": "https://storage.googleapis.com",
    }
