"""Enrichment pipeline orchestrator.

Stages (per plan §15): firmographics → domain discovery → domain validation →
web crawl → digital presence → technology → scoring → AI analysis → aggregation.
"""
from __future__ import annotations

from company_enrichment.ai.llm import AIGatewayClient
from company_enrichment.models.evidence.types import Evidence, ProviderStats
from company_enrichment.models.outputs.results import (
    AIBusinessAnalysis,
    BusinessProfile,
    DomainInfo,
    EnrichmentResult,
    Firmographics,
)
from company_enrichment.providers.dns import DNSProvider, DNSResult
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.rdap import RDAPProvider
from company_enrichment.providers.searxng import SearXNGProvider
from company_enrichment.scoring.scoring import (
    compute_buying_intent,
    compute_commercial_potential,
    compute_launch_velocity,
    compute_operational_readiness,
)
from company_enrichment.services.ai_analysis import AIAnalysisService
from company_enrichment.services.crawler import CrawlerService
from company_enrichment.services.digital_presence import DigitalPresenceService
from company_enrichment.services.domain_discovery import DomainDiscoveryService
from company_enrichment.services.domain_validation import DomainValidationService
from company_enrichment.services.tech_detection import TechDetectionService


class PipelineContext:
    """Bundles the providers/services used by the enrichment pipeline."""

    def __init__(
        self,
        *,
        dns: DNSProvider,
        rdap: RDAPProvider,
        web: WebFetchProvider,
        searxng: SearXNGProvider,
        llm: AIGatewayClient,
        crawler_max_pages: int = 30,
        crawler_max_depth: int = 3,
        llm_max_input_chars: int = 30_000,
    ) -> None:
        self.dns = dns
        self.rdap = rdap
        self.web = web
        self.searxng = searxng
        self.llm = llm
        self.domain_discovery = DomainDiscoveryService(searxng, rdap)
        self.domain_validation = DomainValidationService(dns, web, rdap)
        self.crawler = CrawlerService(
            web, max_pages=crawler_max_pages, max_depth=crawler_max_depth
        )
        self.digital_presence = DigitalPresenceService()
        self.tech_detection = TechDetectionService()
        self.ai_analysis = AIAnalysisService(llm, max_input_chars=llm_max_input_chars)


class EnrichmentPipeline:
    def __init__(self, ctx: PipelineContext, mock_mode: bool = False) -> None:
        self._ctx = ctx
        self._mock_mode = mock_mode

    async def run(self, firmographics: Firmographics) -> EnrichmentResult:
        if self._mock_mode:
            return self._mock_result(firmographics)

        evidence: list[Evidence] = []
        stats: list[ProviderStats] = []

        # Stage: domain discovery
        candidates, evidence = await self._ctx.domain_discovery.discover(firmographics, evidence)

        # Stage: domain validation
        best_domain: DomainInfo | None = None
        canonical = ""
        for domain in candidates:
            info, final_domain, evidence = await self._ctx.domain_validation.validate(
                domain, evidence, firmographics
            )
            if info is not None:
                best_domain = info
                canonical = final_domain
                break

        dns_result: DNSResult | None = None
        pages, page_text = [], ""
        homepage = None
        if best_domain and canonical:
            dns_result = await self._ctx.dns.lookup(best_domain.domain)
            pages, page_text = await self._ctx.crawler.crawl(canonical)
            homepage = pages[0] if pages else None

        # Stage: digital presence
        digital, contacts, evidence = self._ctx.digital_presence.detect(
            canonical or (best_domain.domain if best_domain else ""),
            homepage,
            pages,
            evidence,
        )

        # Stage: technology detection
        technologies = self._ctx.tech_detection.detect(
            dns=dns_result,
            headers=None,
            pages=pages,
            evidence=evidence,
        )

        # Stage: deterministic scoring
        digital_readiness = (
            (digital.corporate_email is not None) * 40
            + (digital.linkedin or digital.instagram or digital.facebook is not None) * 30
        )
        launch = compute_launch_velocity(firmographics, best_domain or DomainInfo(), digital, technologies)
        operational = compute_operational_readiness(
            best_domain or DomainInfo(), digital, technologies, contacts
        )
        commercial = compute_commercial_potential(
            firmographics,
            digital_readiness=float(digital_readiness),
            tech_footprint=len(technologies),
            launch_velocity_score=launch.score,
        )
        buying_intent = compute_buying_intent(
            firmographics, digital, technologies, operational, commercial
        )

        # Stage: AI business analysis (LLM only where valuable)
        ai: AIBusinessAnalysis | None = None
        if page_text:
            ai = await self._ctx.ai_analysis.analyze(
                company_name=firmographics.legal_name or firmographics.trade_name or "",
                text=page_text,
            )
        business_profile = BusinessProfile(
            business_classification=ai.classification if ai else None,
            b2b_b2c=ai.b2b_b2c if ai else None,
            products_services=list(ai.products_services) if ai else [],
            summary=ai.summary if ai else None,
            confidence=ai.confidence if ai else 0.0,
        )

        return EnrichmentResult(
            enrichment_version=1,
            firmographics=firmographics,
            domain=best_domain,
            business_profile=business_profile,
            digital_presence=digital,
            technologies=technologies,
            contacts=contacts,
            launch_velocity=launch,
            operational_readiness=operational,
            commercial_potential=commercial,
            buying_intent=buying_intent,
            ai_analysis=ai,
            evidence=evidence,
            provider_statistics=stats,
        )

    @staticmethod
    def _mock_result(firmographics: Firmographics) -> EnrichmentResult:
        """Deterministic result used only for durability/E2E tests (ENRICHMENT_MOCK_MODE=1)."""
        from company_enrichment.models.evidence.types import DigitalPresence
        from company_enrichment.models.outputs.results import (
            BuyingIntentVertical,
            CommercialPotential,
            ConfidenceLevel,
            DomainInfo,
            LaunchVelocity,
            OperationalReadiness,
        )

        domain = DomainInfo(
            domain="mock.example.com",
            valid=True,
            dns_a=True,
            https=True,
            http=False,
            title="Mock Company",
        )
        digital = DigitalPresence(
            official_website="https://mock.example.com",
            website_classification="VERIFIED",
            corporate_email="contato@mock.example.com",
        )
        return EnrichmentResult(
            enrichment_version=1,
            firmographics=firmographics,
            domain=domain,
            business_profile={
                "business_classification": "Technology",
                "b2b_b2c": "B2B",
                "products_services": ["mock product"],
                "summary": "Mock summary",
                "confidence": 0.8,
            },
            digital_presence=digital,
            technologies=[],
            contacts=[],
            launch_velocity=LaunchVelocity(score=88.0, level=ConfidenceLevel.VERY_HIGH, signals=["DOMAIN_ACTIVE", "CORPORATE_EMAIL"]),
            operational_readiness=OperationalReadiness(score=90.0, level=ConfidenceLevel.VERY_HIGH, reasons=["DOMAIN_ACTIVE", "CORPORATE_EMAIL"]),
            commercial_potential=CommercialPotential(score=75.0, level=ConfidenceLevel.HIGH, confidence=0.7),
            buying_intent={"verticals": {"PROFESSIONAL_EMAIL": BuyingIntentVertical(score=96, confidence=0.94)}},
            ai_analysis={"classification": "Technology", "b2b_b2c": "B2B", "summary": "Mock summary"},
            evidence=[],
            provider_statistics=[],
        )
