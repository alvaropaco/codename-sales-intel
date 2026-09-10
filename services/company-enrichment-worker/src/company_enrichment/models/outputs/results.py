"""Enrichment result output models and per-vertical scoring outputs."""
from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from company_enrichment.models.evidence.types import (
    Contact,
    DigitalPresence,
    Evidence,
    ProviderStats,
    TechDetection,
)


class ConfidenceLevel(StrEnum):
    VERY_LOW = "VERY_LOW"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class Firmographics(BaseModel):
    legal_name: str | None = None
    trade_name: str | None = None
    cnpj: str | None = None
    opening_date: str | None = None
    legal_nature: str | None = None
    porte: str | None = None
    capital_social: float | None = None
    main_cnae: str | None = None
    cnae_secondary: list[str] = Field(default_factory=list)
    city: str | None = None
    state: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    status: str | None = None
    employee_count: int | None = None


class BusinessProfile(BaseModel):
    business_classification: str | None = None
    b2b_b2c: str | None = None
    products_services: list[str] = Field(default_factory=list)
    summary: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class DomainInfo(BaseModel):
    domain: str | None = None
    www: str | None = None
    valid: bool = False
    dns_a: bool = False
    https: bool = False
    http: bool = False
    tls_valid: bool = False
    title: str | None = None
    redirects_to: str | None = None
    rdap_registered: str | None = None  # registrar
    created_at: str | None = None
    score: float = Field(default=0.0, ge=0.0, le=1.0)


class LaunchVelocity(BaseModel):
    score: float = Field(default=0.0, ge=0.0, le=100.0)
    level: ConfidenceLevel = ConfidenceLevel.VERY_LOW
    signals: list[str] = Field(default_factory=list)
    domain_age_days: int | None = None
    website_active: bool = False
    corporate_email_ready: bool = False
    social_present: bool = False
    tech_footprint: bool = False


class OperationalReadiness(BaseModel):
    score: float = Field(default=0.0, ge=0.0, le=100.0)
    level: ConfidenceLevel = ConfidenceLevel.VERY_LOW
    reasons: list[str] = Field(default_factory=list)


class CommercialPotential(BaseModel):
    score: float = Field(default=0.0, ge=0.0, le=100.0)
    level: ConfidenceLevel = ConfidenceLevel.VERY_LOW
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)


class BuyingIntentVertical(BaseModel):
    score: float = Field(default=0.0, ge=0.0, le=100.0)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class BuyingIntent(BaseModel):
    verticals: dict[str, BuyingIntentVertical] = Field(default_factory=dict)


class AIBusinessAnalysis(BaseModel):
    classification: str | None = None
    products_services: list[str] = Field(default_factory=list)
    b2b_b2c: str | None = None
    summary: str | None = None
    intent_reasoning: str | None = None
    suggested_actions: list[str] = Field(default_factory=list)
    model: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class EnrichmentResult(BaseModel):
    """Immutable, versioned enrichment result that is never overwritten."""

    enrichment_version: int = 1
    firmographics: Firmographics | None = None
    domain: DomainInfo | None = None
    business_profile: BusinessProfile | None = None
    digital_presence: DigitalPresence | None = None
    technologies: list[TechDetection] = Field(default_factory=list)
    contacts: list[Contact] = Field(default_factory=list)
    launch_velocity: LaunchVelocity | None = None
    operational_readiness: OperationalReadiness | None = None
    commercial_potential: CommercialPotential | None = None
    buying_intent: BuyingIntent | None = None
    ai_analysis: AIBusinessAnalysis | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    provider_statistics: list[ProviderStats] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)
