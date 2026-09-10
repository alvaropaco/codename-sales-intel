"""Domain discovery: generate domain candidates and score them.

Providers (priority): existing company data → SearXNG → DNS/RDAP → direct web.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

from company_enrichment.metrics.metrics import ENRICHMENT_DOMAINS_FOUND
from company_enrichment.models.evidence.types import Evidence, EvidenceSource, EvidenceType
from company_enrichment.models.outputs.results import Firmographics
from company_enrichment.providers.rdap import RDAPProvider
from company_enrichment.providers.searxng import SearXNGProvider


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", "", text.lower())
    return text


def _extract_domains(urls: list[str]) -> set[str]:
    domains: set[str] = set()
    for u in urls:
        try:
            host = urlparse(u).hostname
        except Exception:  # noqa: BLE001
            continue
        if host:
            host = host.lower()
            if host.startswith("www."):
                host = host[4:]
            if "." in host and not _is_ip(host):
                domains.add(host)
    return domains


def _is_ip(host: str) -> bool:
    return re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host) is not None


# Domínios que NUNCA são o site da empresa prospectada: agregadores de CNPJ
# (criam uma página por CNPJ), redes sociais, governo e portais genéricos.
# O SearXNG costuma retorná-los para qualquer consulta, e sem filtro eles
# "ganham" da empresa real porque ordenávamos candidatos alfabeticamente.
DOMAIN_BLOCKLIST = {
    # CNPJ / data aggregators
    "casadosdados.com.br",
    "cnpj.biz",
    "cnpj.ws",
    "cnpjs.com",
    "cnpj.info",
    "cnpj.rocks",
    "cnpja.com",
    "cnpja.com.br",
    "cnpj.io",
    "brasilcnpj.net",
    "transparencia.cc",
    "econodata.com.br",
    "empresascnpj.com.br",
    "consultacnpj.com",
    "consultacnpj.com.br",
    "situacao-cadastral.com",
    "cnpjbiz.com.br",
    "datasebrae.com.br",
    "solutudo.com.br",
    "informecadastral.com.br",
    "consultasprime.com.br",
    "empresaqui.com.br",
    "cadastroempresa.com.br",
    # social / directories
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "google.com",
    "youtube.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "whatsapp.com",
    "telegram.org",
    "pinterest.com",
    "github.com",
    # government / generic / news portals
    "gov.br",
    "wikipedia.org",
    "wikimedia.org",
    "archive.org",
    "globo.com",
    "uol.com.br",
    "terra.com.br",
    "estadao.com.br",
    "folha.uol.com.br",
}


def _is_blocklisted(domain: str) -> bool:
    d = (domain or "").lower().strip().rstrip(".")
    if not d:
        return True
    for blocked in DOMAIN_BLOCKLIST:
        if d == blocked or d.endswith("." + blocked):
            return True
    return False


def _preferred_name_slugs(firmographics: Firmographics) -> list[str]:
    """First distinctive word of each name, used to rank search-result domains."""
    stop = {
        "ltda", "sa", "me", "eireli", "mei", "sociedade", "empresa", "empresarial",
        "consultoria", "de", "da", "do", "dos", "das", "e", "com", "industria",
        "comercio", "servicos", "administracao", "participacoes",
    }
    slugs: list[str] = []
    for name in (firmographics.legal_name, firmographics.trade_name):
        if not name:
            continue
        normalized = unicodedata.normalize("NFKD", name)
        words = re.findall(r"[a-zA-Z0-9]+", normalized)
        for word in words:
            slug = word.lower()
            if len(slug) >= 3 and slug not in stop:
                slugs.append(slug)
                break
    return slugs


# Provedores de e-mail gratuitos: o domínio deles NUNCA é o site da empresa.
FREE_EMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
    "yahoo.com", "yahoo.com.br", "ymail.com", "uol.com.br", "bol.com.br", "terra.com.br",
    "ig.com.br", "icloud.com", "me.com", "proton.me", "protonmail.com", "zoho.com",
    "aol.com", "yandex.com", "mail.com", "gmx.com", "gmx.net",
}


def _email_domain(firmographics: Firmographics) -> str | None:
    """Domain of the company e-mail, when it is not a free provider.

    A corporate e-mail domain is a very strong signal for the real website
    (e.g. `hi@byvini.com` -> `byvini.com`).
    """
    email = (firmographics.email or "").strip().lower()
    if "@" not in email:
        return None
    domain = email.rsplit("@", 1)[-1].strip().rstrip(".")
    if not domain or domain in FREE_EMAIL_DOMAINS:
        return None
    return domain


def generate_domain_candidates(firmographics: Firmographics) -> list[str]:
    """Generate plausible domains from legal/trade names (high-precision, low-volume)."""
    candidates: list[str] = []
    names = [
        firmographics.legal_name,
        firmographics.trade_name,
    ]
    seen: set[str] = set()
    for name in names:
        if not name:
            continue
        slug = _slugify(name)
        if not slug:
            continue
        for tld in ("com.br", "com", "net.br", "net"):
            domain = f"{slug}.{tld}"
            if domain not in seen:
                seen.add(domain)
                candidates.append(domain)
    return candidates


class DomainDiscoveryService:
    def __init__(self, searxng: SearXNGProvider, rdap: RDAPProvider) -> None:
        self._searxng = searxng
        self._rdap = rdap

    async def discover(
        self, firmographics: Firmographics, evidence: list[Evidence]
    ) -> tuple[list[str], list[Evidence]]:
        """Return candidate domains + appended evidence.

        Ordem de prioridade:
          0. domínio/website explícito já conhecido;
          1. candidatos derivados do nome (determinísticos);
          2. domínios do SearXNG que casam com o nome da empresa;
          3. demais domínios do SearXNG (não bloqueados).
        Agregadores de CNPJ / redes sociais / governo são descartados.
        """
        found: set[str] = set()
        ordered: list[tuple[int, str]] = []

        def add(domain: str, priority: int) -> None:
            d = (domain or "").lower().strip().rstrip(".")
            if not d or "." not in d or _is_ip(d) or _is_blocklisted(d):
                return
            if d not in found:
                found.add(d)
                ordered.append((priority, d))

        # 0. Corporate e-mail domain (strongest signal, e.g. hi@byvini.com -> byvini.com).
        email_domain = _email_domain(firmographics) if firmographics else None
        if email_domain:
            add(email_domain, 0)

        # 1. Explicit domain/website in firmographics (existing internal data).
        if firmographics and getattr(firmographics, "__dict__", {}).get("website_domain"):
            add(firmographics.website_domain, 0)  # type: ignore[attr-defined]
        if firmographics and getattr(firmographics, "__dict__", {}).get("website"):
            web = firmographics.website  # type: ignore[attr-defined]
            if "://" in web:
                web = urlparse(web).hostname
            if web:
                add(web[4:] if web.startswith("www.") else web, 0)

        # 2. Name-based candidates (deterministic).
        for d in generate_domain_candidates(firmographics):
            add(d, 1)

        # 3. SearXNG queries.
        name_slugs = _preferred_name_slugs(firmographics)
        if self._searxng.enabled:
            queries = []
            if firmographics.legal_name:
                queries.append(
                    f'"{firmographics.legal_name}" "{firmographics.city or ""}"'
                    if firmographics.city
                    else f'"{firmographics.legal_name}"'
                )
            if firmographics.trade_name:
                queries.append(f'"{firmographics.trade_name}" "{firmographics.state or ""}"')
            for q in queries:
                results = await self._searxng.search(q)
                for dom in _extract_domains([r.url for r in results]):
                    if _is_blocklisted(dom):
                        continue
                    # Domínio que casa com o nome da empresa sobe na prioridade.
                    priority = 2 if any(slug in dom for slug in name_slugs) else 3
                    add(dom, priority)
                    evidence.append(
                        Evidence(
                            key=f"domain_candidate:{dom}",
                            value=dom,
                            confidence=0.5,
                            source=EvidenceSource(type=EvidenceType.SEARCH, provider="searxng"),
                        )
                    )

        ordered.sort(key=lambda item: (item[0], item[1]))
        candidates = [domain for _, domain in ordered]
        ENRICHMENT_DOMAINS_FOUND.inc(len(candidates))
        return candidates, evidence
