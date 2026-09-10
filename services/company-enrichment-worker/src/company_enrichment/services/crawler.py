"""Web crawler: bounded crawl of a validated domain's important pages.

HTTP first, controlled FlareSolverr fallback, SSRF-protected. Extracts text
content and relevant metadata for downstream analysis.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from company_enrichment.providers.http import WebFetchProvider

# Priority paths crawled first.
PRIORITY_PATHS = [
    "/",
    "/sobre",
    "/about",
    "/empresa",
    "/company",
    "/contato",
    "/contact",
    "/produtos",
    "/products",
    "/servicos",
    "/services",
]

_BOILERPLATE = re.compile(
    r"cookie|aceitar cookies|politica de privacidade|privacy policy|"
    r"terms of service|termos de uso|menu|navega",
    re.IGNORECASE,
)

_NAV_SELECTORS = ["nav", "header", "footer", ".nav", ".menu", ".navbar", ".footer"]


class CrawlPage:
    def __init__(self) -> None:
        self.url: str = ""
        self.title: str = ""
        self.text: str = ""
        self.links: list[str] = []
        self.emails: list[str] = []
        self.phones: list[str] = []
        self.scripts: list[str] = []


_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"(?:\+?\d{1,3}[ -]?)?(?:\(\d{2,3}\)[ -]?)?\d{4,5}[ -]?\d{4}")


class CrawlerService:
    def __init__(
        self,
        web: WebFetchProvider,
        max_pages: int = 30,
        max_depth: int = 3,
        max_response_bytes: int = 5_000_000,
    ) -> None:
        self._web = web
        self._max_pages = max_pages
        self._max_depth = max_depth
        self._max_bytes = max_response_bytes

    async def crawl(self, base_domain: str) -> tuple[list[CrawlPage], str]:
        """Crawl a domain starting at / following priority paths up to depth/max pages.

        Returns (pages, concatenated text content).
        """
        base = urlparse(base_domain)
        root = f"https://{base.netloc}" if base.netloc else base_domain
        visited: set[str] = set()
        pages: list[CrawlPage] = []
        queue: list[tuple[str, int]] = []

        for p in PRIORITY_PATHS:
            queue.append((urljoin(f"{root}/", p.lstrip("/")), 1))

        while queue and len(pages) < self._max_pages:
            url, depth = queue.pop(0)
            if url in visited or depth > self._max_depth:
                continue
            visited.add(url)
            page = await self._fetch(url)
            if page is None:
                continue
            pages.append(page)
            if len(pages) >= self._max_pages:
                break
            for link in page.links:
                parsed = urlparse(link)
                if parsed.netloc != base.netloc:
                    continue
                if any(parsed.path.lower().startswith(ext) for ext in (
                    ".jpg", ".jpeg", ".png", ".gif", ".pdf", ".zip", ".mp4", ".css", ".svg", ".webp",
                )):
                    continue
                if link not in visited and len(pages) + len(queue) < self._max_pages:
                    queue.append((link, depth + 1))

        all_text = "\n\n".join(p.text for p in pages if p.text)
        return pages, all_text

    async def _fetch(self, url: str) -> CrawlPage | None:
        try:
            result = await self._web.fetch(url, allow_flaresolverr=True)
        except Exception:  # noqa: BLE001
            return None
        if result.response.status_code >= 400:
            return None
        raw = result.text
        if len(raw.encode("utf-8")) > self._max_bytes:
            raw = raw[: self._max_bytes]
        page = self._build_page(url, raw)
        return page

    def _build_page(self, url: str, html: str) -> CrawlPage:
        page = CrawlPage()
        page.url = url
        soup = BeautifulSoup(html, "html.parser")
        for sel in _NAV_SELECTORS:
            for node in soup.select(sel):
                node.decompose()
        title = soup.find("title")
        page.title = title.get_text(strip=True)[:300] if title else ""
        text = soup.get_text("\n", strip=True)
        # Drop boilerplate lines.
        lines = [ln for ln in text.splitlines() if ln and not _BOILERPLATE.search(ln)]
        page.text = "\n".join(lines)[: self._max_bytes]
        for a in soup.find_all("a", href=True):
            absolute = urljoin(url, a["href"])
            if absolute.startswith(("http://", "https://")):
                page.links.append(absolute)
        page.emails = list({e.lower() for e in _EMAIL_RE.findall(raw_text(html))})
        page.phones = list({p for p in _PHONE_RE.findall(html) if len(p) >= 10})
        for script in soup.find_all("script", src=True):
            page.scripts.append(script["src"])
        for script in soup.find_all("script"):
            if script.get_text():
                page.scripts.append(script.get_text())
        return page


def raw_text(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)
