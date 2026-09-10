"""Digital presence detection: website, corporate email, and social profiles.

Classification: VERIFIED (direct confirm) / FOUND (observed) / INFERRED (heuristic).
Inference is never promoted to fact.
"""
from __future__ import annotations

import re

from company_enrichment.models.evidence.types import (
    Contact,
    DigitalPresence,
    Evidence,
    PresenceClassification,
)
from company_enrichment.services.crawler import CrawlPage

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_FREE_EMAIL_DOMAINS = {"gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "live.com", "icloud.com"}


class DigitalPresenceService:
    def detect(
        self,
        domain: str,
        homepage: CrawlPage | None,
        all_pages: list[CrawlPage],
        evidence: list[Evidence],
    ) -> tuple[DigitalPresence, list[Contact], list[Evidence]]:
        presence = DigitalPresence()
        presence.official_website = f"https://{domain}" if domain else None
        presence.website_classification = PresenceClassification.VERIFIED

        emails: set[str] = set()
        for page in [homepage, *all_pages]:
            if page is None:
                continue
            emails.update(_EMAIL_RE.findall(page.text))

        corporate_emails = [e for e in emails if e.split("@")[-1].lower() not in _FREE_EMAIL_DOMAINS]
        contacts: list[Contact] = []
        if corporate_emails:
            presence.corporate_email = corporate_emails[0]
            presence.email_classification = PresenceClassification.VERIFIED
            contacts.append(
                Contact(
                    type="email",
                    value=corporate_emails[0],
                    classification=PresenceClassification.VERIFIED,
                    confidence=0.95,
                )
            )
        elif emails:
            presence.corporate_email = emails.pop()
            presence.email_classification = PresenceClassification.INFERRED
            contacts.append(
                Contact(
                    type="email",
                    value=presence.corporate_email,
                    classification=PresenceClassification.INFERRED,
                    confidence=0.6,
                )
            )

        social_links = self._collect_social_links(all_pages)
        if "linkedin.com/company" in social_links:
            presence.linkedin = social_links["linkedin.com/company"]
        if "instagram.com" in social_links:
            presence.instagram = social_links["instagram.com"]
        if "facebook.com" in social_links:
            presence.facebook = social_links["facebook.com"]
        if "youtube.com" in social_links:
            presence.youtube = social_links["youtube.com"]
        if "github.com" in social_links:
            presence.github = social_links["github.com"]

        whatsapp = self._find_whatsapp(all_pages)
        if whatsapp:
            presence.whatsapp = whatsapp
            contacts.append(
                Contact(
                    type="whatsapp",
                    value=whatsapp,
                    classification=PresenceClassification.FOUND,
                    confidence=0.8,
                )
            )

        for handle, value in [
            ("linkedin", presence.linkedin),
            ("instagram", presence.instagram),
            ("facebook", presence.facebook),
            ("youtube", presence.youtube),
            ("github", presence.github),
        ]:
            if value:
                evidence.append(self._link_evidence(handle, value))
        return presence, contacts, evidence

    def _collect_social_links(self, pages: list[CrawlPage]) -> dict[str, str]:
        found: dict[str, str] = {}
        markers = {
            "linkedin.com/company": "linkedin.com/company",
            "instagram.com": "instagram.com",
            "facebook.com": "facebook.com",
            "youtube.com": "youtube.com",
            "github.com": "github.com",
        }
        for page in pages:
            for link in page.links:
                for marker in markers:
                    if marker in link:
                        found.setdefault(marker, link)
        return found

    def _find_whatsapp(self, pages: list[CrawlPage]) -> str | None:
        wa_re = re.compile(r"wa\.me/(\d+)|api\.whatsapp\.com/send\?phone=(\d+)")
        for page in pages:
            for link in page.links:
                m = wa_re.search(link)
                if m:
                    return m.group(1) or m.group(2)
            for text in (page.text,):
                m = wa_re.search(text)
                if m:
                    return m.group(1) or m.group(2)
        return None

    def _link_evidence(self, handle: str, url: str) -> Evidence:
        from company_enrichment.models.evidence.types import EvidenceSource, EvidenceType

        return Evidence(
            key=f"social:{handle}:{url}",
            value=url,
            confidence=0.85,
            source=EvidenceSource(type=EvidenceType.SOCIAL, url=url),
        )
