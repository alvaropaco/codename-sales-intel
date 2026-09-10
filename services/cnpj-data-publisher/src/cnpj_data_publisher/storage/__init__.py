"""Storage backend selection."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from cnpj_data_publisher.config import StorageBackend, get_settings
from cnpj_data_publisher.storage.gcs import GCSConfigurationError, GCSStorage
from cnpj_data_publisher.storage.local import LocalStorage, sha256_of, sha256_of_tree
from cnpj_data_publisher.storage.s3 import S3ConfigurationError, S3Storage


@runtime_checkable
class Storage(Protocol):
    backend: str

    def upload_file(self, source: Path, key: str) -> str: ...
    def upload_directory(self, source: Path, prefix: str) -> list[str]: ...
    def exists(self, key: str) -> bool: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def descriptor(self, prefix: str, manifest_key: str | None = None) -> dict[str, Any]: ...


def get_storage() -> Storage:
    settings = get_settings()
    if settings.storage_backend == StorageBackend.S3:
        return S3Storage()
    if settings.storage_backend == StorageBackend.GCS:
        return GCSStorage()
    return LocalStorage()


__all__ = [
    "GCSConfigurationError",
    "GCSStorage",
    "LocalStorage",
    "S3ConfigurationError",
    "S3Storage",
    "Storage",
    "get_storage",
    "sha256_of",
    "sha256_of_tree",
]
