"""Web fetch provider: normal HTTP first, controlled FlareSolverr fallback.

Flow per plan §36/§17:
  1. Normal HTTP (SSRF-protected, redirect-revalidated).
  2. If blocked (403 / anti-bot challenge) and FlareSolverr enabled and eligible,
     fall back to FlareSolverr (bounded concurrency).
  3. FlareSolverr is only used for publicly accessible resources.
"""

from __future__ import annotations

import re

import httpx

from company_enrichment.metrics.metrics import (
    ENRICHMENT_FLARESOLVERR_FALLBACK,
    ENRICHMENT_OBSCURA_FALLBACK,
)
from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.circuit_breaker import CircuitBreaker
from company_enrichment.providers.flaresolverr import FlareSolverrProvider
from company_enrichment.providers.obscura import ObscuraProvider
from company_enrichment.providers.rate_limit import TokenBucket
from company_enrichment.providers.ssrf import validate_url

# Heuristic markers of a "compatible blocking response" that make FlareSolverr fallback eligible.
_BLOCK_MARKERS = re.compile(
    r"cloudflare|cf-challenge|just a moment|attention required|ddos-guard|"
    r"captcha|recaptcha|access denied|unusual traffic|verify you are human",
    re.IGNORECASE,
)


class BlockedResponseError(ProviderError):
    def __init__(self, message: str = "HTTP response indicates bot-blocking") -> None:
        super().__init__("BLOCKED", message, transient=False)


class WebFetchResult:
    def __init__(
        self,
        response: httpx.Response,
        used_flaresolverr: bool = False,
        used_obscura: bool = False,
    ) -> None:
        self.response = response
        self.used_flaresolverr = used_flaresolverr
        self.used_obscura = used_obscura

    @property
    def text(self) -> str:
        return self.response.text


class WebFetchProvider(Provider):
    name = "web"

    def __init__(
        self,
        flaresolverr: FlareSolverrProvider,
        obscura: ObscuraProvider | None = None,
        default_timeout_seconds: int = 15,
        max_response_bytes: int = 5_000_000,
        max_redirects: int = 5,
        circuit: CircuitBreaker | None = None,
        rate_per_sec: float = 5.0,
    ) -> None:
        super().__init__(circuit)
        self._flaresolverr = flaresolverr
        self._obscura = obscura
        self._timeout = default_timeout_seconds
        self._max_bytes = max_response_bytes
        self._max_redirects = max_redirects
        self._bucket = TokenBucket(rate_per_sec, int(max(1, rate_per_sec * 2)))
        self._client = httpx.AsyncClient(
            timeout=default_timeout_seconds,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; company-enrichment-worker/0.1; "
                    "+https://github.com/alvaropaco/codename-sales-intel/tree/main/services/company-enrichment-worker)"
                )
            },
        )

    async def fetch(self, url: str, allow_flaresolverr: bool = True) -> WebFetchResult:
        validate_url(url)
        await self._bucket.acquire()
        response = await self._execute(self._follow_redirects, url)
        if self._is_blocked(response) and allow_flaresolverr:
            # Preferred fallback: headless JS render (catches SPAs + many anti-bot
            # blocks). Only for publicly accessible content (guardrail).
            if self._obscura is not None and self._obscura.enabled:
                ENRICHMENT_OBSCURA_FALLBACK.labels(url_kind="web").inc()
                try:
                    obs_response = await self._obscura.fetch(url)
                    return WebFetchResult(obs_response, used_obscura=True)
                except ProviderError:
                    # If Obscura can't render, fall through to FlareSolverr.
                    pass
            if self._flaresolverr.enabled:
                ENRICHMENT_FLARESOLVERR_FALLBACK.labels(url_kind="web").inc()
                fs_response = await self._flaresolverr.fetch(url)
                return WebFetchResult(fs_response, used_flaresolverr=True)
        return WebFetchResult(response, used_flaresolverr=False)

    async def _follow_redirects(self, url: str) -> httpx.Response:
        current = url
        for _ in range(self._max_redirects):
            response = await self._client.get(current)
            if response.is_redirect and response.headers.get("location"):
                location = response.headers["location"]
                next_url = str(httpx.URL(current).join(location))
                validate_url(next_url)  # re-validate SSRF after redirect
                current = next_url
                continue
            break
        return response

    @staticmethod
    def _is_blocked(response: httpx.Response) -> bool:
        if response.status_code in (403, 429):
            return True
        if response.status_code >= 400:
            return False
        body = response.text[:200_000]
        return bool(_BLOCK_MARKERS.search(body))

    async def close(self) -> None:
        await self._client.aclose()
        await self._flaresolverr.close()
        if self._obscura is not None:
            await self._obscura.close()
