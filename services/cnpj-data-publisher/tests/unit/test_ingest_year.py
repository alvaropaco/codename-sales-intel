"""Unit tests for the year backfill orchestration (``pipeline.ingest_year``)."""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from cnpj_data_publisher import pipeline as pipeline_module

pytestmark = pytest.mark.unit


def test_ingest_year_processes_months_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    class _FakePipeline:
        def __init__(self, requested_snapshot: str = "latest", force: bool = False) -> None:
            self.requested = requested_snapshot
            self.force = force

        def run(self) -> pipeline_module.IngestResult:
            seen.append(self.requested)
            return pipeline_module.IngestResult(snapshot_version=self.requested, status="COMPLETED")

    discovery = Mock()
    discovery.list_versions.return_value = ["2025-12", "2024-06", "2025-01", "2026-03", "2025-07"]

    monkeypatch.setattr(pipeline_module, "IngestPipeline", _FakePipeline)
    monkeypatch.setattr(pipeline_module, "SnapshotDiscovery", lambda: discovery)

    results = pipeline_module.ingest_year(2025)

    assert seen == ["2025-01", "2025-07", "2025-12"]
    assert [r.snapshot_version for r in results] == seen


def test_ingest_year_forwards_force(monkeypatch: pytest.MonkeyPatch) -> None:
    forced: list[bool] = []

    class _FakePipeline:
        def __init__(self, requested_snapshot: str = "latest", force: bool = False) -> None:
            self.requested_snapshot = requested_snapshot
            self.force = force
            forced.append(force)

        def run(self) -> pipeline_module.IngestResult:
            return pipeline_module.IngestResult(
                snapshot_version=self.requested_snapshot, status="COMPLETED"
            )

    discovery = Mock()
    discovery.list_versions.return_value = ["2025-01"]

    monkeypatch.setattr(pipeline_module, "IngestPipeline", _FakePipeline)
    monkeypatch.setattr(pipeline_module, "SnapshotDiscovery", lambda: discovery)

    pipeline_module.ingest_year(2025, force=True)

    assert forced == [True]


def test_ingest_year_no_matching_months_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    discovery = Mock()
    discovery.list_versions.return_value = ["2026-01", "2024-12"]

    monkeypatch.setattr(pipeline_module, "SnapshotDiscovery", lambda: discovery)

    assert pipeline_module.ingest_year(2025) == []
