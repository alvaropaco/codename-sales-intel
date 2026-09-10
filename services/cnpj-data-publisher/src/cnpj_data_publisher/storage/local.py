"""Local filesystem storage backend (spec section 27)."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

from cnpj_data_publisher.config import get_settings
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)


def sha256_of(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_of_tree(directory: Path) -> str:
    """Stable checksum for a directory: hashes relative paths and contents."""
    digest = hashlib.sha256()
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        digest.update(str(path.relative_to(directory)).encode("utf-8"))
        digest.update(sha256_of(path).encode("ascii"))
    return digest.hexdigest()


class LocalStorage:
    """Stores artifacts on the mounted data volume."""

    backend = "LOCAL"

    def __init__(self, root: Path | None = None) -> None:
        self.settings = get_settings()
        self.root = root or self.settings.storage_local_path

    def upload_file(self, source: Path, key: str) -> str:
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() != target.resolve():
            tmp = target.with_name(target.name + ".uploading")
            shutil.copy2(source, tmp)
            tmp.replace(target)
        return str(target)

    def upload_directory(self, source: Path, prefix: str) -> list[str]:
        uploaded: list[str] = []
        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            key = f"{prefix.rstrip('/')}/{path.relative_to(source)}"
            uploaded.append(self.upload_file(path, key))
        return uploaded

    def exists(self, key: str) -> bool:
        return (self.root / key).exists()

    def delete_prefix(self, prefix: str) -> int:
        target = self.root / prefix
        if not target.exists():
            return 0
        count = sum(1 for p in target.rglob("*") if p.is_file())
        shutil.rmtree(target, ignore_errors=True)
        return count

    def checksum(self, key: str) -> str | None:
        path = self.root / key
        if path.is_file():
            return sha256_of(path)
        if path.is_dir():
            return sha256_of_tree(path)
        return None

    def descriptor(self, prefix: str, manifest_key: str | None = None) -> dict[str, Any]:
        """Storage block for the SNAPSHOT_READY event.

        Local paths are meaningless to external consumers, so the descriptor
        deliberately advertises no download location (spec section 26).
        """
        return {
            "type": "LOCAL",
            "bucket": None,
            "prefix": prefix,
            "manifest": manifest_key,
            "endpoint": None,
        }
