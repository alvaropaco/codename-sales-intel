"""Field-level normalization rules (spec sections 9, 10 and 11).

Everything here is pure and deterministic so it can be unit tested and reused by
both the DuckDB pipeline and the event builders.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum


# ---------------------------------------------------------------------
# Registration status (spec section 11)
# ---------------------------------------------------------------------
class RegistrationStatus(StrEnum):
    NULL = "NULL"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    UNFIT = "UNFIT"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


REGISTRATION_STATUS_BY_CODE: dict[str, RegistrationStatus] = {
    "01": RegistrationStatus.NULL,
    "02": RegistrationStatus.ACTIVE,
    "03": RegistrationStatus.SUSPENDED,
    "04": RegistrationStatus.UNFIT,
    "08": RegistrationStatus.CLOSED,
}

ACTIVE_STATUS_CODE = "02"
HEADQUARTERS_CODE = "1"


class HeadquartersBranch(StrEnum):
    HEADQUARTERS = "HEADQUARTERS"
    BRANCH = "BRANCH"
    UNKNOWN = "UNKNOWN"


_CONTROL_CHARS = dict.fromkeys(range(32)) | {127: None}
_NON_DIGITS = re.compile(r"\D+")
_MULTISPACE = re.compile(r"\s+")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
_PLACEHOLDER_VALUES = {
    "",
    "0",
    "00",
    "000",
    "0000",
    "00000000",
    "N/A",
    "NA",
    "NAO INFORMADO",
    "NÃO INFORMADO",
    "SEM INFORMACAO",
    "NULL",
    "NONE",
    "-",
    "--",
    "..",
    "*",
    "********",
}


# ---------------------------------------------------------------------
# Primitive cleaners
# ---------------------------------------------------------------------
def strip_control_chars(value: str) -> str:
    return value.translate(_CONTROL_CHARS)


def clean_text(value: str | None) -> str | None:
    """Trim, collapse whitespace, drop control characters and placeholders."""
    if value is None:
        return None
    cleaned = _MULTISPACE.sub(" ", strip_control_chars(value)).strip()
    if not cleaned or cleaned.upper() in _PLACEHOLDER_VALUES:
        return None
    return cleaned


def normalize_registry_text(value: str | None) -> str | None:
    """Uppercase registry fields. Accents are preserved on purpose (spec 10)."""
    cleaned = clean_text(value)
    return cleaned.upper() if cleaned else None


def normalize_email(value: str | None) -> str | None:
    """Lowercase and validate. Malformed addresses become NULL, never an error."""
    cleaned = clean_text(value)
    if cleaned is None:
        return None
    lowered = cleaned.lower().replace(" ", "")
    if not _EMAIL_RE.match(lowered):
        return None
    return lowered


def digits_only(value: str | None) -> str | None:
    cleaned = clean_text(value)
    if cleaned is None:
        return None
    stripped = _NON_DIGITS.sub("", cleaned)
    return stripped or None


def normalize_postal_code(value: str | None) -> str | None:
    digits = digits_only(value)
    if digits is None:
        return None
    padded = digits.zfill(8)
    if len(padded) != 8 or padded == "0" * 8:
        return None
    return padded


def normalize_phone(area_code: str | None, number: str | None) -> dict[str, str] | None:
    """Return ``{"area_code", "number"}`` or None when unusable."""
    area = digits_only(area_code)
    num = digits_only(number)
    if not num or len(num) < 7:
        return None
    if not area or len(area) > 3:
        return None
    return {"area_code": area, "number": num}


def parse_date(value: str | None) -> date | None:
    """Parse ``YYYYMMDD``. Invalid or sentinel dates return None (never raise)."""
    digits = digits_only(value)
    if digits is None or len(digits) != 8:
        return None
    if digits in {"00000000", "99999999"}:
        return None
    try:
        parsed = date(int(digits[0:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return None
    if parsed.year < 1900 or parsed.year > 2200:
        return None
    return parsed


def format_date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def parse_decimal(value: str | None) -> Decimal | None:
    """Parse share capital. Handles ``100000,00`` and ``100.000,00``."""
    cleaned = clean_text(value)
    if cleaned is None:
        return None
    candidate = cleaned.replace(" ", "")
    if "," in candidate:
        candidate = candidate.replace(".", "").replace(",", ".")
    try:
        parsed = Decimal(candidate)
    except (InvalidOperation, ValueError):
        return None
    if parsed < 0:
        return None
    return parsed


def format_decimal(value: Decimal | None) -> str | None:
    """Serialize money as a fixed two-decimal string."""
    if value is None:
        return None
    return f"{value:.2f}"


def parse_bool_flag(value: str | None, true_value: str = "S") -> bool:
    """Receita uses ``S``/``N`` flags; anything else is False."""
    cleaned = clean_text(value)
    return cleaned is not None and cleaned.upper() == true_value.upper()


# ---------------------------------------------------------------------
# CNPJ (always textual, never numeric - spec section 9)
# ---------------------------------------------------------------------
def normalize_cnpj_part(value: str | None, length: int) -> str | None:
    """Zero-pad a CNPJ segment while preserving alphanumeric CNPJs."""
    cleaned = clean_text(value)
    if cleaned is None:
        return None
    compact = cleaned.replace(".", "").replace("/", "").replace("-", "").replace(" ", "").upper()
    if not compact:
        return None
    if len(compact) > length:
        return None
    return compact.rjust(length, "0")


def build_cnpj(basic: str | None, order: str | None, check_digits: str | None) -> str | None:
    """Assemble the 14-character CNPJ from its three segments."""
    b = normalize_cnpj_part(basic, 8)
    o = normalize_cnpj_part(order, 4)
    c = normalize_cnpj_part(check_digits, 2)
    if not (b and o and c):
        return None
    cnpj = f"{b}{o}{c}"
    return cnpj if len(cnpj) == 14 else None


# ---------------------------------------------------------------------
# Enumerated mappings
# ---------------------------------------------------------------------
def map_registration_status(code: str | None) -> RegistrationStatus:
    cleaned = clean_text(code)
    if cleaned is None:
        return RegistrationStatus.UNKNOWN
    return REGISTRATION_STATUS_BY_CODE.get(cleaned.zfill(2), RegistrationStatus.UNKNOWN)


def normalize_status_code(code: str | None) -> str | None:
    cleaned = clean_text(code)
    return cleaned.zfill(2) if cleaned else None


def is_active(code: str | None) -> bool:
    return normalize_status_code(code) == ACTIVE_STATUS_CODE


def map_headquarters_branch(code: str | None) -> HeadquartersBranch:
    cleaned = clean_text(code)
    if cleaned == HEADQUARTERS_CODE:
        return HeadquartersBranch.HEADQUARTERS
    if cleaned == "2":
        return HeadquartersBranch.BRANCH
    return HeadquartersBranch.UNKNOWN


def is_headquarters(code: str | None) -> bool:
    return clean_text(code) == HEADQUARTERS_CODE


def normalize_cnae(value: str | None) -> str | None:
    digits = digits_only(value)
    if digits is None:
        return None
    padded = digits.zfill(7)
    return padded if len(padded) == 7 and padded != "0000000" else None


def normalize_secondary_cnaes(value: str | None) -> list[str]:
    """Split, normalize, deduplicate and sort the secondary CNAE list."""
    cleaned = clean_text(value)
    if cleaned is None:
        return []
    parts = (normalize_cnae(part) for part in cleaned.split(","))
    return sorted({part for part in parts if part})


def normalize_state(value: str | None) -> str | None:
    cleaned = clean_text(value)
    if cleaned is None:
        return None
    upper = cleaned.upper()
    return upper if len(upper) == 2 and upper.isalpha() else None


def normalize_code(value: str | None, width: int = 0) -> str | None:
    """Normalize a numeric lookup code, optionally zero padded."""
    digits = digits_only(value)
    if digits is None:
        return None
    return digits.zfill(width) if width else digits


def strip_accents(value: str) -> str:
    """Only for auxiliary/derived fields - never for display values."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c))
