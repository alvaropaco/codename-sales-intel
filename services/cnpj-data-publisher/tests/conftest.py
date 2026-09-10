"""Shared pytest fixtures."""

from __future__ import annotations

import os
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from cnpj_data_publisher.config import Settings, reset_settings


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every test gets a clean settings singleton rooted in tmp_path."""
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "data"))
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.setenv("MIN_EXPECTED_TOTAL_ROWS", "1")
    reset_settings()
    yield
    reset_settings()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    from cnpj_data_publisher.config import get_settings

    return get_settings()


@pytest.fixture
def make_zip(tmp_path: Path):
    """Factory building a ZIP archive from a {member_name: bytes} mapping."""

    def _make(name: str, members: dict[str, bytes], directory: Path | None = None) -> Path:
        target_dir = directory or tmp_path
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / name
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for member, payload in members.items():
                zf.writestr(member, payload)
        return path

    return _make


@pytest.fixture
def database_url() -> str | None:
    return os.environ.get("TEST_DATABASE_URL")
