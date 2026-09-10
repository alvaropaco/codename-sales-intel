"""Company event builders (spec sections 22-26).

Converts a canonical diff row into the exact payload shape defined by the
JSON Schemas in ``contracts/``.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from cnpj_data_publisher.events.envelope import EventEnvelope, build_envelope
from cnpj_data_publisher.events.subjects import EventType

MAX_CHANGES = 25


# ---------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------
def _iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _money(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, Decimal | float | int):
        return f"{Decimal(str(value)):.2f}"
    text = str(value).strip()
    return text or None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [v for v in (part.strip() for part in value.split(",")) if v]
    return [str(v) for v in value if v is not None]


def _phones(row: dict[str, Any]) -> list[dict[str, str]]:
    phones: list[dict[str, str]] = []
    for area_key, number_key in (("area_code_1", "phone_1"), ("area_code_2", "phone_2")):
        area = _text(row.get(area_key))
        number = _text(row.get(number_key))
        if area and number and len(number) >= 7:
            phones.append({"area_code": area, "number": number})
    return phones


# ---------------------------------------------------------------------
# Canonical company payload
# ---------------------------------------------------------------------
def build_company_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Project a diff row into the canonical company payload."""
    fax_area = _text(row.get("fax_area_code"))
    fax_number = _text(row.get("fax"))
    fax = f"{fax_area or ''}{fax_number}" if fax_number else None

    return {
        "cnpj": _text(row.get("cnpj")),
        "cnpj_basic": _text(row.get("cnpj_basic")),
        "cnpj_order": _text(row.get("cnpj_order")),
        "cnpj_check_digits": _text(row.get("cnpj_check_digits")),
        "headquarters_branch": _text(row.get("headquarters_branch")),
        "legal_name": _text(row.get("legal_name")),
        "trade_name": _text(row.get("trade_name")),
        "registration_status": _text(row.get("registration_status")),
        "registration_status_code": _text(row.get("registration_status_code")),
        "registration_status_date": _iso_date(row.get("registration_status_date")),
        "registration_status_reason": _text(row.get("registration_status_reason")),
        "opening_date": _iso_date(row.get("opening_date")),
        "legal_nature": {
            "code": _text(row.get("legal_nature_code")),
            "description": _text(row.get("legal_nature_description")),
        },
        "main_cnae": {
            "code": _text(row.get("main_cnae")),
            "description": _text(row.get("main_cnae_description")),
        },
        "secondary_cnaes": _list(row.get("secondary_cnaes")),
        "company_size_code": _text(row.get("company_size_code")),
        "share_capital": _money(row.get("share_capital")),
        "simple_tax_option": bool(row.get("simple_tax_option")),
        "mei_option": bool(row.get("mei_option")),
        "address": {
            "street_type": _text(row.get("street_type")),
            "street": _text(row.get("street")),
            "number": _text(row.get("number")),
            "complement": _text(row.get("complement")),
            "district": _text(row.get("district")),
            "postal_code": _text(row.get("postal_code")),
            "city_code": _text(row.get("city_code")),
            "city_name": _text(row.get("city_name")),
            "state": _text(row.get("state")),
            "country_code": _text(row.get("country_code")),
        },
        "contacts": {
            "phones": _phones(row),
            "fax": fax,
            "email": _text(row.get("email")),
        },
    }


def _metadata(row: dict[str, Any], snapshot_version: str) -> dict[str, Any]:
    return {
        "dataset": "RECEITA_FEDERAL_CNPJ",
        "snapshot_version": snapshot_version,
        "fingerprint": _text(row.get("fingerprint")),
    }


# ---------------------------------------------------------------------
# Event builders
# ---------------------------------------------------------------------
def build_discovered(
    row: dict[str, Any], snapshot_version: str, correlation_id: str | None = None
) -> EventEnvelope:
    return build_envelope(
        EventType.COMPANY_DISCOVERED,
        data=build_company_payload(row),
        metadata=_metadata(row, snapshot_version),
        correlation_id=correlation_id,
    )


def build_updated(
    row: dict[str, Any],
    snapshot_version: str,
    changes: list[dict[str, Any]] | None = None,
    correlation_id: str | None = None,
) -> EventEnvelope:
    company = build_company_payload(row)
    return build_envelope(
        EventType.COMPANY_UPDATED,
        data={
            "cnpj": company["cnpj"],
            "company": company,
            "changes": (changes or [])[:MAX_CHANGES],
        },
        metadata={
            **_metadata(row, snapshot_version),
            "previous_fingerprint": _text(row.get("previous_fingerprint")),
        },
        correlation_id=correlation_id,
    )


def build_reactivated(
    row: dict[str, Any], snapshot_version: str, correlation_id: str | None = None
) -> EventEnvelope:
    company = build_company_payload(row)
    return build_envelope(
        EventType.COMPANY_REACTIVATED,
        data={
            "cnpj": company["cnpj"],
            "previous_registration_status": _text(row.get("previous_registration_status")),
            "previous_registration_status_code": _text(
                row.get("previous_registration_status_code")
            ),
            "current_registration_status": company["registration_status"],
            "current_registration_status_code": company["registration_status_code"],
            "company": company,
        },
        metadata=_metadata(row, snapshot_version),
        correlation_id=correlation_id,
    )


def build_inactivated(
    row: dict[str, Any], snapshot_version: str, correlation_id: str | None = None
) -> EventEnvelope:
    company = build_company_payload(row)
    return build_envelope(
        EventType.COMPANY_INACTIVATED,
        data={
            "cnpj": company["cnpj"],
            "previous_registration_status": _text(row.get("previous_registration_status")),
            "previous_registration_status_code": _text(
                row.get("previous_registration_status_code")
            ),
            "current_registration_status": company["registration_status"],
            "current_registration_status_code": company["registration_status_code"],
            "registration_status_date": company["registration_status_date"],
            "registration_status_reason": company["registration_status_reason"],
        },
        metadata=_metadata(row, snapshot_version),
        correlation_id=correlation_id,
    )


def build_snapshot_ready(
    snapshot_version: str,
    manifest: dict[str, Any],
    storage: dict[str, Any],
    checksum: str | None = None,
    correlation_id: str | None = None,
) -> EventEnvelope:
    return build_envelope(
        EventType.CNPJ_SNAPSHOT_READY,
        data={
            "snapshot_version": snapshot_version,
            "schema_version": manifest.get("schema_version", 1),
            "total_rows": manifest.get("total_rows", 0),
            "active_rows": manifest.get("active_rows", 0),
            "headquarters_rows": manifest.get("headquarters_rows", 0),
            "storage": storage,
            "checksum": checksum,
        },
        metadata={"snapshot_version": snapshot_version},
        correlation_id=correlation_id,
    )


def build_ingest_completed(
    snapshot_version: str, statistics: dict[str, Any], correlation_id: str | None = None
) -> EventEnvelope:
    return build_envelope(
        EventType.INGEST_COMPLETED,
        data={"snapshot_version": snapshot_version, "statistics": statistics},
        metadata={"snapshot_version": snapshot_version},
        correlation_id=correlation_id,
    )


def build_ingest_failed(
    snapshot_version: str,
    stage: str,
    error_code: str,
    error_message: str,
    correlation_id: str | None = None,
) -> EventEnvelope:
    return build_envelope(
        EventType.INGEST_FAILED,
        data={
            "snapshot_version": snapshot_version,
            "stage": stage,
            "error_code": error_code,
            "error_message": error_message[:2000],
        },
        metadata={"snapshot_version": snapshot_version},
        correlation_id=correlation_id,
    )


def diff_changes(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Field-level changes for an updated company.

    The diff engine only carries the previous fingerprint, not the full previous
    record, so the change list stays empty unless a caller supplies one. The
    complete current state is always available under ``data.company``.
    """
    return []


#: Diff dataset name -> builder function.
BUILDERS = {
    "discovered": build_discovered,
    "updated": build_updated,
    "reactivated": build_reactivated,
    "inactivated": build_inactivated,
}
