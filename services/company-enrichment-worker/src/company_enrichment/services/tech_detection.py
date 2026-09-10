"""Technology detection via non-invasive fingerprints.

Sources: DNS/MX records, HTTP headers, HTML markers, script URLs, page text.
No invasive scanning.
"""
from __future__ import annotations

import re

from company_enrichment.models.evidence.types import (
    Evidence,
    EvidenceSource,
    EvidenceType,
    TechDetection,
)
from company_enrichment.providers.dns import DNSResult
from company_enrichment.services.crawler import CrawlPage


class TechDetectionService:
    def detect(
        self,
        *,
        dns: DNSResult | None,
        headers: dict[str, str] | None,
        pages: list[CrawlPage],
        evidence: list[Evidence],
    ) -> list[TechDetection]:
        detections: list[TechDetection] = []
        html = "\n".join(p.text for p in pages)
        scripts = " ".join(s for p in pages for s in p.scripts)
        raw = html + "\n" + scripts

        # --- Mail provider from MX ---
        if dns and dns.mx_hosts:
            mx = dns.mx_hosts[0]
            if "google.com" in mx or "googlemail" in mx:
                detections.append(self._tech("mail_provider", "Google Workspace", 0.99, "DNS_MX"))
            elif "outlook.com" in mx or "office365" in mx or "protection.outlook" in mx:
                detections.append(self._tech("mail_provider", "Microsoft 365", 0.99, "DNS_MX"))
            elif "zoho" in mx:
                detections.append(self._tech("mail_provider", "Zoho", 0.9, "DNS_MX"))

        # --- Infrastructure/CDN ---
        cf = self._in_headers(headers, "server") and "cloudflare" in (headers or {}).get("server", "").lower()
        if cf or "cloudflare" in raw.lower():
            detections.append(self._tech("infra", "Cloudflare", 0.95, "HEADER"))
        if (
            "amazonaws" in raw
            or (headers or {}).get("server", "").lower().startswith("amazons3")
            or "cloudfront" in raw.lower()
        ):
            detections.append(self._tech("infra", "AWS", 0.85, "HEADER"))
        for token, name in [("azure", "Azure"), ("wpengine", "WP Engine"), ("vercel", "Vercel")]:
            if token in raw.lower() or token in str(headers).lower():
                detections.append(self._tech("infra", name, 0.8, "HEADER"))
        if re.search(r"(zhst\.b/|vercel\.app)", raw, re.IGNORECASE):
            detections.append(self._tech("infra", "Vercel", 0.8, "HTML"))

        # --- Analytics ---
        if "gtag" in scripts or "googletagmanager" in raw.lower():
            detections.append(self._tech("analytics", "Google Tag Manager", 0.98, "SCRIPT"))
        if "google-analytics" in raw.lower() or "analytics.google" in raw.lower():
            detections.append(self._tech("analytics", "Google Analytics", 0.95, "SCRIPT"))
        if "fbq(" in raw or "connect.facebook.net" in raw.lower():
            detections.append(self._tech("analytics", "Meta Pixel", 0.9, "SCRIPT"))
        if "hotjar" in raw.lower():
            detections.append(self._tech("analytics", "Hotjar", 0.9, "SCRIPT"))

        # --- Marketing ---
        if "hubspot" in raw.lower():
            detections.append(self._tech("marketing", "HubSpot", 0.9, "SCRIPT"))
        if "rdstation" in raw.lower() or "rdstation" in scripts.lower():
            detections.append(self._tech("marketing", "RD Station", 0.9, "SCRIPT"))

        # --- CMS ---
        if "wp-content" in raw.lower() or "wordpress" in raw.lower():
            detections.append(self._tech("cms", "WordPress", 0.95, "HTML"))
        if "shopify" in raw.lower() or "cdn.shopify" in raw.lower():
            detections.append(self._tech("cms", "Shopify", 0.95, "HTML"))
        if "nuvemshop" in raw.lower() or "tiendanube" in raw.lower():
            detections.append(self._tech("cms", "Nuvemshop", 0.9, "HTML"))
        if "woocommerce" in raw.lower():
            detections.append(self._tech("cms", "WooCommerce", 0.9, "HTML"))

        # --- Payments ---
        for token, name in [
            ("stripe.com/v3", "Stripe"),
            ("mercadopago", "Mercado Pago"),
            ("pagarme", "Pagar.me"),
            ("pagar.me", "Pagar.me"),
            ("checkout.com", "Checkout.com"),
        ]:
            if token in raw.lower():
                detections.append(self._tech("payments", name, 0.85, "SCRIPT"))

        # --- Communications / support ---
        for token, name in [("intercom", "Intercom"), ("zendesk", "Zendesk"), ("crisp.chat", "Crisp")]:
            if token in raw.lower():
                detections.append(self._tech("communications", name, 0.85, "SCRIPT"))

        for d in detections:
            evidence.append(
                Evidence(
                    key=f"tech:{d.category}:{d.name}",
                    value=d.name,
                    confidence=d.confidence,
                    source=EvidenceSource(type=EvidenceType.SCRIPT, provider="fingerprint"),
                )
            )
        return detections

    async def detect_clean(self, domain: str, dns=None) -> list[TechDetection]:
        """Deterministic, DNS-only detection for a bare domain (no pages yet).

        Used by the `tech` worker type when a website has not been crawled.
        Non-invasive: consults public DNS (MX/NS) only.
        """
        detections: list[TechDetection] = []
        if dns is None:
            from company_enrichment.providers.dns import DNSProvider

            dns = DNSProvider()
        try:
            result = await dns.lookup(domain)
        except Exception:  # noqa: BLE001 - DNS unavailable -> partial result
            result = None
        if result and result.mx_hosts:
            mx = result.mx_hosts[0].lower()
            if "google" in mx or "googlemail" in mx:
                detections.append(self._tech("mail_provider", "Google Workspace", 0.99, "DNS_MX"))
            elif "outlook" in mx or "office365" in mx or "protection.outlook" in mx:
                detections.append(self._tech("mail_provider", "Microsoft 365", 0.99, "DNS_MX"))
            elif "zoho" in mx:
                detections.append(self._tech("mail_provider", "Zoho", 0.9, "DNS_MX"))
        return detections

    def _tech(self, category: str, name: str, confidence: float, source: str) -> TechDetection:
        return TechDetection(
            category=category,
            name=name,
            confidence=confidence,
            source=source,
        )

    @staticmethod
    def _in_headers(headers: dict[str, str] | None, key: str) -> bool:
        return bool(headers and headers.get(key))
