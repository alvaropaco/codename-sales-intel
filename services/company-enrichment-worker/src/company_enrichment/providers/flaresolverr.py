"""FlareSolverr provider: bounded fallback fetcher for publicly accessible pages.

Only used as a fallback when normal HTTP returns a compatible blocking response
(403 / anti-bot challenge). Never used to bypass login, auth, paywalls, or
restrictive CAPTCHAs.
"""
from __future__ import annotations

import httpx

from company_enrichment.metrics.metrics import (
    ENRICHMENT_FLARESOLVERR_REQUESTS,
)
from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.circuit_breaker import CircuitBreaker
from company_enrichment.providers.rate_limit import ConcurrencyLimiter, TokenBucket
from company_enrichment.providers.ssrf import validate_url


class FlareSolverrProvider(Provider):
    name = "flaresolverr"

    def __init__(
        self,
        url: str | None,
        max_concurrency: int = 3,
        timeout_seconds: int = 60,
        circuit: CircuitBreaker | None = None,
        rate_per_sec: float = 1.0,
    ) -> None:
        super().__init__(circuit)
        self._url = url
        self._timeout = timeout_seconds
        self._limiter = ConcurrencyLimiter(max_concurrency) if max_concurrency > 0 else None
        self._bucket = TokenBucket(rate_per_sec, int(max(1, rate_per_sec * 2)))
        self._client = httpx.AsyncClient(timeout=timeout_seconds)

    @property
    def enabled(self) -> bool:
        return bool(self._url)

    async def fetch(self, url: str) -> httpx.Response:
        if not self.enabled:
            raise ProviderError("NOT_CONFIGURED", "FLARESOLVERR_URL not set", transient=False)
        validate_url(url)
        ENRICHMENT_FLARESOLVERR_REQUESTS.inc()
        return await self._execute(self._do_fetch, url)

    async def _do_fetch(self, url: str) -> httpx.Response:
        await self._bucket.acquire()
        if self._limiter is not None:
            async with self._limiter:
                return await self._request_flaresolverr(url)
        return await self._request_flaresolverr(url)

    async def _request_flaresolverr(self, url: str) -> httpx.Response:
        payload = {
            "cmd": "request.get",
            "url": url,
            "maxTimeout": self._timeout * 1000,
        }
        resp = await self._client.post(f"{self._url}/v1", json=payload)
        resp.raise_for_status()
        data = resp.json()
        solution = data.get("solution", {})
        html = solution.get("response") or solution.get("html") or ""
        status = solution.get("status", 200)
        # Rebuild an httpx.Response-like object around the HTML.
        return httpx.Response(
            status_code=int(status),
            headers={"content-type": "text/html; charset=utf-8"},
            content=html.encode("utf-8"),
            request=httpx.Request("GET", url),
        )

    async def close(self) -> None:
        await self._client.aclose()
