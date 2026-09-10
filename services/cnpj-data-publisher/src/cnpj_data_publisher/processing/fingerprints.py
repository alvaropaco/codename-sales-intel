"""Deterministic per-company fingerprints (spec section 14)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

#: Exact field list from the spec. Order does not matter (keys are sorted),
#: but membership does: adding or removing a field changes every fingerprint.
FINGERPRINT_FIELDS: tuple[str, ...] = (
    "cnpj",
    "headquarters_branch",
    "legal_name",
    "trade_name",
    "registration_status_code",
    "registration_status_date",
    "opening_date",
    "legal_nature_code",
    "main_cnae",
    "secondary_cnaes",
    "company_size_code",
    "share_capital",
    "simple_tax_option",
    "mei_option",
    "address",
    "contacts",
)


def _canonicalize(value: Any) -> Any:
    """Recursively produce a stable representation.

    - dict keys sorted
    - lists of scalars sorted (CNAEs, phones by their canonical form)
    - empty string treated as null so ``""`` and ``None`` never differ
    """
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, dict):
        return {k: _canonicalize(value[k]) for k in sorted(value)}
    if isinstance(value, list | tuple | set):
        items = [_canonicalize(v) for v in value]
        try:
            return sorted(items, key=lambda v: json.dumps(v, sort_keys=True, default=str))
        except TypeError:  # pragma: no cover - defensive
            return items
    return str(value)


def build_fingerprint_data(record: dict[str, Any]) -> dict[str, Any]:
    """Project a canonical record down to the fingerprint fields."""
    return {field: _canonicalize(record.get(field)) for field in FINGERPRINT_FIELDS}


def canonical_payload(fingerprint_data: dict[str, Any]) -> str:
    """Serialize exactly as the spec prescribes."""
    return json.dumps(
        fingerprint_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def compute_fingerprint(record: dict[str, Any]) -> str:
    """SHA-256 hex digest of the canonical JSON payload."""
    payload = canonical_payload(build_fingerprint_data(record))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def diff_fields(
    previous: dict[str, Any], current: dict[str, Any], max_changes: int = 25
) -> list[dict[str, Any]]:
    """Compute a bounded, flattened list of changed fields (spec section 23)."""
    changes: list[dict[str, Any]] = []

    def walk(prefix: str, before: Any, after: Any) -> None:
        if len(changes) >= max_changes:
            return
        if isinstance(before, dict) or isinstance(after, dict):
            before_d = before if isinstance(before, dict) else {}
            after_d = after if isinstance(after, dict) else {}
            for key in sorted(set(before_d) | set(after_d)):
                walk(f"{prefix}.{key}" if prefix else key, before_d.get(key), after_d.get(key))
            return
        if _canonicalize(before) != _canonicalize(after):
            changes.append(
                {
                    "field": prefix,
                    "previous": _truncate(before),
                    "current": _truncate(after),
                }
            )

    prev_data = build_fingerprint_data(previous)
    curr_data = build_fingerprint_data(current)
    for field in FINGERPRINT_FIELDS:
        walk(field, prev_data.get(field), curr_data.get(field))

    return changes[:max_changes]


def _truncate(value: Any, limit: int = 512) -> Any:
    """Keep payloads small; oversized values are omitted per spec section 23."""
    if value is None or isinstance(value, bool | int | float):
        return value
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if len(text) > limit:
        return None
    return value
