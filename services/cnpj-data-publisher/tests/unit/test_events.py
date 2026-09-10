"""Every generated event must validate against its JSON Schema."""

from __future__ import annotations

from pathlib import Path

import pytest

from cnpj_data_publisher.events import company_events as ce
from cnpj_data_publisher.events.envelope import build_envelope, nats_headers
from cnpj_data_publisher.events.schemas import load_schema, validate_event
from cnpj_data_publisher.events.subjects import EventType, subject_for
from cnpj_data_publisher.processing.canonical_snapshot import CanonicalSnapshotBuilder
from cnpj_data_publisher.processing.diff import (
    DISCOVERED,
    INACTIVATED,
    REACTIVATED,
    UPDATED,
    DiffEngine,
    iter_diff_rows,
)
from cnpj_data_publisher.receita.extractor import Extractor

from tests.fixtures.builder import build_snapshot_fixture

pytestmark = pytest.mark.unit


def _snapshot(tmp_path: Path, version: str) -> Path:
    downloads = build_snapshot_fixture(tmp_path / "downloads", version)
    extracted = tmp_path / "extracted" / version
    Extractor(extracted).extract_all(sorted(downloads.glob("*.zip")))
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


@pytest.fixture(scope="function")
def diff_dir(tmp_path: Path) -> Path:
    june = _snapshot(tmp_path, "2026-06")
    july = _snapshot(tmp_path, "2026-07")
    out = tmp_path / "diffs" / "2026-07"
    DiffEngine(
        snapshot_version="2026-07",
        current_dir=july,
        previous_dir=june,
        output_dir=out,
        previous_snapshot_version="2026-06",
    ).run()
    return out


# ---------------------------------------------------------------------
# Schema availability
# ---------------------------------------------------------------------
@pytest.mark.parametrize("event_type", list(EventType))
def test_every_event_type_has_a_schema(event_type: EventType) -> None:
    schema = load_schema(event_type)
    assert schema["properties"]["event_type"]["const"] == event_type.value
    # The prefix is deployment config, so only the leaf is pinned.
    import re

    assert re.search(schema["properties"]["subject"]["pattern"], subject_for(event_type))


# ---------------------------------------------------------------------
# Real events from real diff output
# ---------------------------------------------------------------------
def test_discovered_event_validates(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, DISCOVERED))
    event = ce.build_discovered(row, "2026-07")
    assert validate_event(event.to_dict()) == []


def test_updated_event_validates(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, UPDATED))
    changes = [{"field": "contacts.email", "previous": "a@b.com", "current": "c@d.com"}]
    event = ce.build_updated(row, "2026-07", changes=changes)
    assert validate_event(event.to_dict()) == []
    assert event.data["changes"] == changes


def test_reactivated_event_validates(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, REACTIVATED))
    event = ce.build_reactivated(row, "2026-07")
    assert validate_event(event.to_dict()) == []
    assert event.data["previous_registration_status_code"] == "03"


def test_inactivated_event_validates(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, INACTIVATED))
    event = ce.build_inactivated(row, "2026-07")
    assert validate_event(event.to_dict()) == []
    assert event.data["current_registration_status_code"] == "08"


def test_snapshot_ready_validates() -> None:
    event = ce.build_snapshot_ready(
        "2026-07",
        manifest={"schema_version": 1, "total_rows": 10, "active_rows": 5, "headquarters_rows": 5},
        storage={
            "type": "S3",
            "bucket": "cnpj",
            "prefix": "2026-07/active/",
            "manifest": "2026-07/manifest.json",
        },
        checksum="a" * 64,
    )
    assert validate_event(event.to_dict()) == []


def test_ingest_events_validate() -> None:
    completed = ce.build_ingest_completed("2026-07", {"total_rows": 10})
    failed = ce.build_ingest_failed("2026-07", "DOWNLOADING", "HTTP_500", "boom")

    assert validate_event(completed.to_dict()) == []
    assert validate_event(failed.to_dict()) == []


# ---------------------------------------------------------------------
# Payload invariants
# ---------------------------------------------------------------------
def test_cnpj_is_string_in_payload(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, DISCOVERED))
    payload = ce.build_company_payload(row)

    assert isinstance(payload["cnpj"], str)
    assert len(payload["cnpj"]) == 14


def test_share_capital_is_two_decimal_string(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, UPDATED))
    payload = ce.build_company_payload(row)

    assert payload["share_capital"] == "150000.00"


def test_phones_are_structured(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, DISCOVERED))
    payload = ce.build_company_payload(row)

    assert payload["contacts"]["phones"] == [{"area_code": "11", "number": "999999999"}]


def test_envelope_required_fields() -> None:
    event = build_envelope(EventType.COMPANY_DISCOVERED, data={}, metadata={})
    dumped = event.to_dict()

    for field in (
        "event_id",
        "event_type",
        "event_version",
        "subject",
        "source",
        "occurred_at",
        "correlation_id",
        "data",
        "metadata",
    ):
        assert field in dumped

    assert dumped["source"] == "cnpj-data-publisher"
    assert dumped["event_version"] == 1


def test_nats_headers_carry_msg_id() -> None:
    event = build_envelope(EventType.COMPANY_DISCOVERED, data={}, metadata={})
    headers = nats_headers(event)

    assert headers["Nats-Msg-Id"] == event.event_id
    assert headers["Ce-Type"] == "COMPANY_DISCOVERED"


def test_invalid_event_is_rejected() -> None:
    event = build_envelope(EventType.COMPANY_DISCOVERED, data={"cnpj": 123}, metadata={})
    errors = validate_event(event.to_dict())

    assert errors  # cnpj must be a string, not an integer


def test_changes_are_bounded(diff_dir: Path) -> None:
    row = next(iter_diff_rows(diff_dir, UPDATED))
    changes = [{"field": f"f{i}", "previous": "a", "current": "b"} for i in range(100)]
    event = ce.build_updated(row, "2026-07", changes=changes)

    assert len(event.data["changes"]) == ce.MAX_CHANGES
    assert validate_event(event.to_dict()) == []
