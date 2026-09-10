"""Deterministic scoring: launch velocity, operational readiness, commercial potential, buying intent.

Per plan §30 these are pure heuristics (no LLM) and never estimate revenue as fact.
"""
from __future__ import annotations

from company_enrichment.models.evidence.types import DigitalPresence, TechDetection
from company_enrichment.models.outputs.results import (
    BuyingIntent,
    BuyingIntentVertical,
    CommercialPotential,
    ConfidenceLevel,
    DomainInfo,
    Firmographics,
    LaunchVelocity,
    OperationalReadiness,
)

BUYING_INTENT_VERTICALS = [
    "ACCOUNTING",
    "BANKING",
    "PAYMENTS",
    "CRM",
    "ERP",
    "PROFESSIONAL_EMAIL",
    "CLOUD",
    "CYBERSECURITY",
    "TELECOM",
    "MARKETING",
    "INSURANCE",
    "HR_SOFTWARE",
    "ECOMMERCE",
]


def level_for(score: float) -> ConfidenceLevel:
    if score >= 80:
        return ConfidenceLevel.VERY_HIGH
    if score >= 65:
        return ConfidenceLevel.HIGH
    if score >= 45:
        return ConfidenceLevel.MEDIUM
    if score >= 25:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW


def _clamp(score: float) -> float:
    return max(0.0, min(100.0, score))


def compute_launch_velocity(
    firmographics: Firmographics,
    domain: DomainInfo,
    digital: DigitalPresence,
    technologies: list[TechDetection],
) -> LaunchVelocity:
    score = 0.0
    signals: list[str] = []
    if domain and domain.valid and domain.dns_a:
        score += 30
        signals.append("DOMAIN_ACTIVE")
    if domain and domain.https:
        score += 10
        signals.append("HTTPS_ACTIVE")
    if digital and digital.corporate_email:
        score += 15
        signals.append("CORPORATE_EMAIL")
    if digital and (digital.linkedin or digital.instagram or digital.facebook):
        score += 15
        signals.append("SOCIAL_PRESENCE")
    if technologies:
        score += min(20, 5 * len(technologies))
        signals.append("TECH_FOOTPRINT")
    if firmographics and firmographics.opening_date:
        signals.append("HAS_OPENING_DATE")
    score = _clamp(score)
    return LaunchVelocity(
        score=round(score, 1),
        level=level_for(score),
        signals=signals,
        website_active=bool(domain and domain.https),
        corporate_email_ready=bool(digital and digital.corporate_email),
        social_present=bool(digital and (digital.linkedin or digital.instagram or digital.facebook)),
        tech_footprint=bool(technologies),
    )


def compute_operational_readiness(
    domain: DomainInfo,
    digital: DigitalPresence,
    technologies: list[TechDetection],
    contacts: list,
) -> OperationalReadiness:
    reasons: list[str] = []
    score = 0.0
    if domain and domain.valid and domain.dns_a:
        score += 25
        reasons.append("DOMAIN_ACTIVE")
    if domain and domain.https:
        score += 10
        reasons.append("WEBSITE_ACTIVE")
    if digital and digital.corporate_email:
        score += 15
        reasons.append("CORPORATE_EMAIL")
    has_mx = any(t.category == "mail_provider" for t in technologies) or (
        domain is not None and bool(getattr(domain, "dns_a", False)) and digital and digital.corporate_email
    )
    if has_mx:
        score += 10
        reasons.append("MX_PRESENT")
    if any(t.category == "analytics" for t in technologies):
        score += 10
        reasons.append("ANALYTICS")
    if any(t.category == "marketing" for t in technologies):
        score += 10
        reasons.append("MARKETING_STACK")
    if digital and (digital.linkedin or digital.instagram or digital.facebook):
        score += 10
        reasons.append("SOCIAL")
    if any(t.category == "payments" for t in technologies):
        score += 5
        reasons.append("PAYMENTS")
    if any(t.category == "communications" for t in technologies):
        score += 5
        reasons.append("COMMUNICATIONS")
    score = _clamp(score)
    return OperationalReadiness(score=round(score, 1), level=level_for(score), reasons=reasons)


def compute_commercial_potential(
    firmographics: Firmographics,
    digital_readiness: float,
    tech_footprint: int,
    launch_velocity_score: float,
) -> CommercialPotential:
    score = 0.0
    reasons: list[str] = []
    capital = (firmographics.capital_social or 0) if firmographics else 0
    if capital > 1_000_000:
        score += 20
        reasons.append("HIGH_CAPITAL")
    elif capital > 100_000:
        score += 12
        reasons.append("MEANINGFUL_CAPITAL")
    if firmographics and firmographics.porte in ("ME", "EPP", "GRANDE"):
        score += 10
        reasons.append("PORTE")
    if firmographics and firmographics.main_cnae:
        score += 5
        reasons.append("CNAE")
    score += digital_readiness * 0.4
    score += min(20, tech_footprint * 5)
    score += launch_velocity_score * 0.1
    score = _clamp(score)
    confidence = _clamp(
        0.4
        + (0.15 if capital > 0 else 0)
        + (0.1 if firmographics and firmographics.main_cnae else 0)
        + (0.1 if digital_readiness >= 50 else 0)
        + (0.1 if tech_footprint > 0 else 0)
    )
    return CommercialPotential(
        score=round(score, 1),
        level=level_for(score),
        confidence=round(confidence, 2),
        reasons=reasons,
    )


def compute_buying_intent(
    firmographics: Firmographics,
    digital: DigitalPresence,
    technologies: list[TechDetection],
    operational: OperationalReadiness,
    commercial: CommercialPotential,
) -> BuyingIntent:
    """Per-vertical B2B buying-intent heuristics (deterministic, evidence-based)."""
    intents: dict[str, BuyingIntentVertical] = {}
    op_score = operational.score if operational else 50.0
    com_score = commercial.score if commercial else 50.0
    base = 0.6 * op_score + 0.4 * com_score
    cats = {t.category for t in technologies}
    has_email = bool(digital and digital.corporate_email)
    # Professional email is the strongest universally-applicable signal.
    if has_email:
        intents["PROFESSIONAL_EMAIL"] = BuyingIntentVertical(
            score=round(_clamp(30 + 0.7 * op_score), 1),
            confidence=round(_clamp(0.6 + op_score / 200), 2),
        )
    for vertical in BUYING_INTENT_VERTICALS:
        if vertical == "PROFESSIONAL_EMAIL":
            continue
        v = _vertical_score(vertical, cats, has_email, base, firmographics)
        if v is not None:
            intents[vertical] = v
    return BuyingIntent(verticals=intents)


def _vertical_score(
    vertical: str, cats: set[str], has_email: bool, base: float, firmographics: Firmographics
) -> BuyingIntentVertical | None:
    score = base * 0.6
    confidence = 0.5
    cnae = firmographics.main_cnae or "" if firmographics else ""

    # Recency and email strongly indicate intent across most verticals.
    if has_email:
        score += 12
        confidence += 0.1

    maps = {
        "ACCOUNTING": ("finance", "tax", "accounting"),
        "BANKING": ("finance",),
        "PAYMENTS": ("payments", "finance", "ecommerce"),
        "CRM": ("crm", "marketing", "sales"),
        "ERP": ("erp", "backoffice"),
        "CLOUD": ("cloud", "hosting"),
        "CYBERSECURITY": ("security",),
        "TELECOM": ("communications",),
        "MARKETING": ("marketing",),
        "INSURANCE": (),
        "HR_SOFTWARE": ("hr",),
        "ECOMMERCE": ("ecommerce", "payments"),
    }
    want = maps.get(vertical, ())
    hit = next((c for c in want if c in cats), None)
    if hit:
        score += 20
        confidence += 0.15
    # Sizing heuristic from CNAE (rough, non-factual).
    if cnae.startswith("62") or cnae.startswith("63"):  # ICT companies signal SaaS verticals
        if vertical in ("CRM", "CLOUD", "CYBERSECURITY", "PROFESSIONAL_EMAIL"):
            score += 8
    # Small/medium businesses are the primary target buyers for these verticals.
    if firmographics and firmographics.porte in ("ME", "EPP", "DEMAIS"):
        confidence += 0.1
    score = _clamp(score)
    return BuyingIntentVertical(score=round(score, 1), confidence=round(_clamp(confidence), 2))
