"""Download manifest models and persistence (spec section 7)."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MANIFEST_FILENAME = "manifest.json"


@dataclass(slots=True)
class FileEntry:
    """One downloaded artifact and everything needed to verify it."""

    name: str
    url: str
    size: int | None = None
    downloaded_size: int | None = None
    etag: str | None = None
    last_modified: str | None = None
    sha256: str | None = None
    downloaded_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FileEntry:
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__})  # type: ignore[arg-type]

    @property
    def verified(self) -> bool:
        if self.sha256 is None or self.downloaded_at is None:
            return False
        if self.size is not None and self.downloaded_size is not None:
            return self.size == self.downloaded_size
        return True


@dataclass(slots=True)
class DownloadManifest:
    """Persistent record of everything fetched for a snapshot version."""

    snapshot_version: str
    source_url: str = ""
    files: list[FileEntry] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    completed_at: str | None = None

    # -- lookup ------------------------------------------------------
    def get(self, name: str) -> FileEntry | None:
        for entry in self.files:
            if entry.name == name:
                return entry
        return None

    def upsert(self, entry: FileEntry) -> None:
        for index, existing in enumerate(self.files):
            if existing.name == entry.name:
                self.files[index] = entry
                return
        self.files.append(entry)

    # -- aggregates ---------------------------------------------------
    @property
    def total_bytes(self) -> int:
        return sum(f.downloaded_size or 0 for f in self.files)

    @property
    def all_verified(self) -> bool:
        return bool(self.files) and all(f.verified for f in self.files)

    def missing(self) -> list[str]:
        return [f.name for f in self.files if not f.verified]

    # -- serialization -------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "snapshot_version": self.snapshot_version,
            "source_url": self.source_url,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "total_files": len(self.files),
            "total_bytes": self.total_bytes,
            "files": [f.to_dict() for f in self.files],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DownloadManifest:
        return cls(
            snapshot_version=data["snapshot_version"],
            source_url=data.get("source_url", ""),
            files=[FileEntry.from_dict(f) for f in data.get("files", [])],
            created_at=data.get("created_at", datetime.now(UTC).isoformat()),
            completed_at=data.get("completed_at"),
        )

    # -- disk ----------------------------------------------------------
    def save(self, directory: Path) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / MANIFEST_FILENAME
        # Unique temp name so concurrent writers never clobber each other.
        tmp = directory / f".{MANIFEST_FILENAME}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        try:
            tmp.write_text(
                json.dumps(self.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
            )
            tmp.replace(path)  # atomic
        finally:
            tmp.unlink(missing_ok=True)
        return path

    @classmethod
    def load(cls, directory: Path) -> DownloadManifest | None:
        path = directory / MANIFEST_FILENAME
        if not path.exists():
            return None
        try:
            return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, KeyError):
            return None

    @classmethod
    def load_or_create(
        cls, directory: Path, snapshot_version: str, source_url: str = ""
    ) -> DownloadManifest:
        existing = cls.load(directory)
        if existing is not None and existing.snapshot_version == snapshot_version:
            if source_url:
                existing.source_url = source_url
            return existing
        return cls(snapshot_version=snapshot_version, source_url=source_url)

    def mark_completed(self) -> None:
        self.completed_at = datetime.now(UTC).isoformat()
