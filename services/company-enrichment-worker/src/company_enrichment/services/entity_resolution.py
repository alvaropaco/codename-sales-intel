"""Entity resolution: canonical keys, dedup, normalization.

Deterministic graph-tier resolution. Never calls an LLM. Every entity carries a
normalized `entity_key` (unique per type in `entities`), so duplicate
discoveries become merge contributions instead of duplicate work.
"""
from __future__ import annotations

import re

from company_enrichment.providers.firmographics import normalize_cnpj


def normalize_domain(value: str | None) -> str | None:
    """Lowercase, strip scheme/path/www, keep punycode as-is (idna on registration)."""
    if not value:
        return None
    host = value.strip().lower()
    host = re.sub(r"^[a-z][a-z0-9+.-]*://", "", host)
    host = host.split("/")[0].split("?")[0].split("#")[0]
    while host.endswith("."):
        host = host[:-1]
    if host.startswith("www."):
        host = host[4:]
    if not host or "." not in host or " " in host:
        return None
    return host


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    email = value.strip().lower().replace("mailto:", "")
    email = email.split("?")[0]
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return None
    return email


def normalize_phone(value: str | None) -> str | None:
    """Collapse to E.164-ish digits (country code optional, +55 default for BR)."""
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 10 or len(digits) == 11:
        digits = "55" + digits
    if len(digits) in (12, 13) and digits.startswith("55"):
        return digits
    if 8 <= len(digits) <= 15:
        return digits
    return None


def normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    url = value.strip()
    if not url.startswith(("http://", "https://")):
        if not url.startswith("www.") and "." not in url.split("/")[0]:
            return None
        url = "https://" + url
    return url.split("#")[0]


def normalize_person_name(value: str | None) -> str | None:
    """Collapse whitespace, strip honorifics/abbreviations for keying."""
    if not value:
        return None
    name = re.sub(r"\s+", " ", value.strip().title())
    if not name:
        return None
    return name


def social_key(platform: str, handle_or_url: str | None) -> str | None:
    """Canonical SOCIAL_PROFILE key e.g. linkedin:acme-brasil or instagram:acme."""
    if not handle_or_url:
        return None
    raw = handle_or_url.strip().strip("/")
    # Extract trailing handle/ID from a full profile URL.
    m = re.search(r"([^/]+)/?$", raw)
    if m:
        raw = m.group(1)
    raw = raw.split("?")[0]
    if not raw:
        return None
    return f"{platform.lower()}:{raw.lower()}"


def entity_key_for(kind: str, value: object) -> str | None:
    """Return the normalized canonical key for a value, or None if not valid."""
    if value is None:
        return None
    if kind == "DOMAIN":
        return normalize_domain(str(value))
    if kind == "EMAIL":
        return normalize_email(str(value))
    if kind == "PHONE":
        return normalize_phone(str(value))
    if kind == "URL":
        return normalize_url(str(value))
    if kind == "COMPANY":
        digits = normalize_cnpj(str(value))
        return digits
    if kind == "PERSON":
        return normalize_person_name(str(value))
    if kind == "SOCIAL_PROFILE" and isinstance(value, tuple):
        platform, handle = value
        return social_key(str(platform), str(handle))
    if kind in ("TECHNOLOGY", "ADDRESS"):
        text = str(value).strip().lower()
        return text or None
    text = str(value).strip()
    return text or None
