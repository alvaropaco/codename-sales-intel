"""SearXNG search provider (reuses existing cluster SearXNG)."""
from __future__ import annotations

import httpx

from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.circuit_breaker import CircuitBreaker
from company_enrichment.providers.rate_limit import TokenBucket


class SearchResult:
    def __init__(self, url: str, title: str = "", snippet: str = "", engine: str = "") -> None:
        self.url = url
        self.title = title
        self.snippet = snippet
        self.engine = engine


class SearXNGProvider(Provider):
    name = "searxng"

    def __init__(
        self,
        url: str | None,
        circuit: CircuitBreaker | None = None,
        timeout: float = 15.0,
        rate_per_sec: float = 2.0,
    ) -> None:
        super().__init__(circuit)
        self._url = (url or "").rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)
        self._bucket = TokenBucket(rate_per_sec, int(max(1, rate_per_sec * 2)))

    @property
    def enabled(self) -> bool:
        return bool(self._url)

    async def search(self, query: str, lang: str = "pt-BR") -> list[SearchResult]:
        if not self.enabled:
            return []
        await self._bucket.acquire()
        return await self._execute(self._do_search, query, lang)

    async def _do_search(self, query: str, lang: str) -> list[SearchResult]:
        params = {"q": query, "format": "json", "language": lang, "safesearch": "0"}
        try:
            resp = await self._client.get(f"{self._url}/search", params=params)
            resp.raise_for_status()
            data = resp.json()
            results = []
            for r in data.get("results", [])[:10]:
                url = r.get("url")
                if not url:
                    continue
                results.append(
                    SearchResult(
                        url=url,
                        title=r.get("title", ""),
                        snippet=r.get("content", ""),
                        engine=",".join(r.get("engines", []) or []),
                    )
                )
            return results
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                "HTTP_ERROR", f"SearXNG {exc.response.status_code}", transient=True
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("NETWORK", f"SearXNG error: {exc}", transient=True) from exc

    async def close(self) -> None:
        await self._client.aclose()
