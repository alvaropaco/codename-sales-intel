"""Domain validation: DNS, HTTP/S, redirect, TLS, title, company identity.

SSRF protection is applied on every fetch and re-applied after redirects.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from company_enrichment.metrics.metrics import ENRICHMENT_WEBSITES_FOUND
from company_enrichment.models.evidence.types import Evidence, EvidenceSource, EvidenceType
from company_enrichment.models.outputs.results import DomainInfo, Firmographics
from company_enrichment.providers.dns import DNSProvider
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.rdap import RDAPProvider
from company_enrichment.providers.ssrf import validate_url

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(html: str) -> str | None:
    m = _TITLE_RE.search(html[:500_000])
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()
        return title[:300] or None
    return None


class DomainValidationService:
    """Validates a single candidate domain."""

    def __init__(
        self, dns: DNSProvider, web: WebFetchProvider, rdap: RDAPProvider
    ) -> None:
        self._dns = dns
        self._web = web
        self._rdap = rdap

    async def validate(
        self,
        domain: str,
        evidence: list[Evidence],
        firmographics: Firmographics | None = None,
    ) -> tuple[DomainInfo | None, str, list[Evidence]]:
        """Validate a candidate domain.

        Returns (best DomainInfo or None, canonical final domain, appended evidence).
        """
        domain = domain.lower().strip().rstrip(".")
        resolved = await self._dns.lookup(domain)
        if not resolved.has_a:
            return None, "", evidence

        info = DomainInfo(domain=domain, www=f"www.{domain}", dns_a=True)

        # Probe HTTPS then HTTP; fetch keeps final URL after redirects.
        https_ok, title, final_url = await self._probe(f"https://{domain}")
        info.https = bool(https_ok)
        info.tls_valid = bool(https_ok)
        if not info.https:
            http_ok, title, final_url = await self._probe(f"http://{domain}")
            info.http = bool(http_ok)
        if not (info.https or info.http):
            return None, "", evidence

        final_domain = urlparse(final_url).hostname or domain
        if final_domain != domain:
            info.redirects_to = final_domain
            info.domain = final_domain
        info.title = title

        if resolved.has_mx:
            evidence.append(
                Evidence(
                    key=f"mx:{domain}",
                    value=",".join(resolved.mx_hosts),
                    confidence=0.95,
                    source=EvidenceSource(type=EvidenceType.DNS_MX, host=domain, provider="dns"),
                )
            )

        evidence.append(
            Evidence(
                key=f"domain_validated:{domain}",
                value=info.domain,
                confidence=0.9,
                source=EvidenceSource(type=EvidenceType.HTTP, host=info.domain, provider="web"),
            )
        )
        ENRICHMENT_WEBSITES_FOUND.inc(1)
        return info, info.domain, evidence

    async def _probe(self, url: str) -> tuple[bool, str | None, str]:
        try:
            validate_url(url)
            result = await self._web.fetch(url, allow_flaresolverr=True)
            final_url = str(result.response.url or url)
            title = _extract_title(result.text)
            return True, title, final_url
        except Exception:  # noqa: BLE001 - a single candidate failing is not fatal
            return False, None, url
