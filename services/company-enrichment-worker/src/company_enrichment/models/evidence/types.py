"""Evidence-first domain types (every discovery carries value, confidence, source, observed_at)."""
from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(UTC)


class EvidenceType(StrEnum):
    DNS = "DNS"
    DNS_MX = "DNS_MX"
    HTTP = "HTTP"
    HTTPS = "HTTPS"
    RDAP = "RDAP"
    SEARCH = "SEARCH"
    HTML = "HTML"
    HEADER = "HEADER"
    SCRIPT = "SCRIPT"
    SOCIAL = "SOCIAL"
    CONTACT = "CONTACT"
    LLM = "LLM"
    INTERNAL = "INTERNAL"
    OTHER = "OTHER"


class EvidenceSource(BaseModel):
    """Provenance of a single piece of evidence."""

    type: EvidenceType
    url: str | None = None
    host: str | None = None
    provider: str | None = None
    observed_at: datetime = Field(default_factory=_utcnow)


class Evidence(BaseModel):
    """A single discovered fact with confidence and provenance."""

    key: str
    value: Any = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: EvidenceSource = Field(default_factory=EvidenceSource)


class ProviderStats(BaseModel):
    """Per-provider statistics recorded for observability."""

    provider: str
    ok: int = 0
    failed: int = 0
    retries: int = 0
    total_latency_ms: int = 0
    last_error: str | None = None


class PresenceClassification(StrEnum):
    VERIFIED = "VERIFIED"
    FOUND = "FOUND"
    INFERRED = "INFERRED"


class DigitalPresence(BaseModel):
    official_website: str | None = None
    website_classification: PresenceClassification | None = None
    corporate_email: str | None = None
    email_classification: PresenceClassification | None = None
    linkedin: str | None = None
    instagram: str | None = None
    facebook: str | None = None
    youtube: str | None = None
    github: str | None = None
    whatsapp: str | None = None
    google_business_signals: bool = False


class TechDetection(BaseModel):
    category: str
    name: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: str | None = None  # e.g. DNS_MX, HTML, HEADER, SCRIPT
    evidence: list[Evidence] | None = None


class Contact(BaseModel):
    type: str  # email, phone, whatsapp, address
    value: str
    classification: PresenceClassification = PresenceClassification.INFERRED
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    source: str | None = None
