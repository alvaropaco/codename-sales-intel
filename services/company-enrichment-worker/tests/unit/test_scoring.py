"""Deterministic scoring unit tests (per plan §24-27)."""
from company_enrichment.models.evidence.types import DigitalPresence, TechDetection
from company_enrichment.models.outputs.results import (
    ConfidenceLevel,
    DomainInfo,
    Firmographics,
)
from company_enrichment.scoring.scoring import (
    compute_buying_intent,
    compute_commercial_potential,
    compute_launch_velocity,
    compute_operational_readiness,
    level_for,
)


def test_level_for_thresholds():
    assert level_for(85) == ConfidenceLevel.VERY_HIGH
    assert level_for(70) == ConfidenceLevel.HIGH
    assert level_for(50) == ConfidenceLevel.MEDIUM
    assert level_for(30) == ConfidenceLevel.LOW
    assert level_for(10) == ConfidenceLevel.VERY_LOW


def test_launch_velocity_high_when_fully_active():
    fg = Firmographics(legal_name="Acme Ltda")
    domain = DomainInfo(domain="acme.com.br", valid=True, dns_a=True, https=True)
    digital = DigitalPresence(corporate_email="contato@acme.com.br", linkedin="https://linkedin.com/company/acme")
    tech = [TechDetection(category="analytics", name="Google Analytics", confidence=0.9)]
    out = compute_launch_velocity(fg, domain, digital, tech)
    assert out.score >= 70
    assert out.website_active is True
    assert "CORPORATE_EMAIL" in out.signals


def test_launch_velocity_low_when_inactive():
    fg = Firmographics(legal_name="Acme Ltda")
    domain = DomainInfo(domain="acme.com.br", valid=False, dns_a=False)
    digital = DigitalPresence()
    out = compute_launch_velocity(fg, domain, digital, [])
    assert out.score == 0
    assert out.level == ConfidenceLevel.VERY_LOW


def test_operational_readiness_reasons():
    domain = DomainInfo(domain="acme.com.br", valid=True, dns_a=True, https=True)
    digital = DigitalPresence(corporate_email="contato@acme.com.br")
    tech = [
        TechDetection(category="analytics", name="Google Analytics", confidence=0.9),
        TechDetection(category="mail_provider", name="Google Workspace", confidence=0.99),
    ]
    out = compute_operational_readiness(domain, digital, tech, [])
    assert out.score > 50
    assert "DOMAIN_ACTIVE" in out.reasons
    assert "CORPORATE_EMAIL" in out.reasons


def test_commercial_potential_capital_boost():
    fg = Firmographics(legal_name="Acme", capital_social=2_000_000, porte="EPP", main_cnae="6201")
    out = compute_commercial_potential(fg, digital_readiness=50, tech_footprint=3, launch_velocity_score=70)
    assert out.score > 40
    assert out.confidence > 0.4


def test_buying_intent_professional_email():
    fg = Firmographics(legal_name="Acme", porte="ME")
    digital = DigitalPresence(corporate_email="contato@acme.com.br")
    op = compute_operational_readiness(
        DomainInfo(valid=True, dns_a=True, https=True), digital, [], []
    )
    com = compute_commercial_potential(fg, 50, 1, 60)
    intent = compute_buying_intent(fg, digital, [], op, com)
    assert "PROFESSIONAL_EMAIL" in intent.verticals
    assert intent.verticals["PROFESSIONAL_EMAIL"].score >= 30
