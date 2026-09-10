"""Obscura provider: bounded headless-browser render of a single public page.

Runs the `obscura` CLI (`obscura fetch <url> --dump markdown|text|html`) as a
bounded subprocess to render JavaScript and return the DOM-derived content that
a plain HTTP fetch cannot see (SPAs, client-side-rendered pages). It is a
*fallback* for normal HTTP: it renders content from publicly accessible pages
only and is never used to bypass login, auth, or paywalls (the same guardrail as
FlareSolverr).

Design mirrors the BBOT / SpiderFoot providers:
  - one bounded subprocess per page, killed on timeout,
  - SSRF revalidation before any navigation,
  - bounded concurrency and a rate limit,
  - all calls flow through the shared circuit-breaker / metrics wiring.

The binary must be present at ``OBSCURA_BIN`` (installed in the image when the
OSINT worker types are built). When ``OBSCURA_URL`` is set, the binary must be
run with ``obscura serve`` reachable over CDP; for now the provider drives the
CLI directly.
"""

from __future__ import annotations

import asyncio
import shutil

import httpx

from company_enrichment.metrics.metrics import ENRICHMENT_OBSCURA_REQUESTS
from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.rate_limit import ConcurrencyLimiter, TokenBucket
from company_enrichment.providers.ssrf import validate_url

#: Obscura render/stealth builds differ in binary size and capability. Any of
#: these dump modes yields DOM content for downstream parsing.
_ALLOWED_DUMPS = ("markdown", "text", "html")


class ObscuraProvider(Provider):
    """Headless JS renderer fallback used when normal HTTP is blocked/JS-heavy."""

    name = "obscura"

    def __init__(
        self,
        binary: str | None = None,
        enabled: bool = True,
        timeout_seconds: int = 30,
        max_concurrency: int = 3,
        rate_per_sec: float = 1.0,
        dump: str = "markdown",
        stealth: bool = False,
        circuit=None,
    ) -> None:
        super().__init__(circuit)
        self._binary = shutil.which(binary) if binary else None
        self.enabled = enabled and bool(self._binary)
        self._timeout = timeout_seconds
        self._limiter = ConcurrencyLimiter(max_concurrency) if max_concurrency > 0 else None
        self._bucket = TokenBucket(rate_per_sec, int(max(1, rate_per_sec * 2)))
        self._dump = dump if dump in _ALLOWED_DUMPS else "markdown"
        self._stealth = stealth

    async def fetch(self, url: str) -> httpx.Response:
        if not self.enabled:
            raise ProviderError(
                "NOT_CONFIGURED", "OBSCURA_BIN not found or OBSCURA_ENABLED=false", transient=False
            )
        validate_url(url)
        ENRICHMENT_OBSCURA_REQUESTS.inc()
        return await self._execute(self._do_fetch, url)

    async def _do_fetch(self, url: str) -> httpx.Response:
        await self._bucket.acquire()
        if self._limiter is not None:
            async with self._limiter:
                return await self._render(url)
        return await self._render(url)

    async def _render(self, url: str) -> httpx.Response:
        cmd = [
            str(self._binary),
            "fetch",
            url,
            "--dump",
            self._dump,
            "--timeout",
            str(self._timeout),
            "--quiet",
        ]
        if self._stealth:
            cmd.append("--stealth")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:  # binary missing / not executable
            raise ProviderError("BINARY", f"obscura exec failed: {exc}", transient=True) from exc

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout + 5)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise ProviderError("TIMEOUT", "obscura render timed out", transient=True) from None
        if proc.returncode != 0:
            err = (stderr or b"").decode("utf-8", "replace").strip()[:300]
            raise ProviderError(
                "FAILED", f"obscura exited {proc.returncode}: {err}", transient=True
            )

        body = (stdout or b"").decode("utf-8", "replace")
        return httpx.Response(
            status_code=200,
            headers={"content-type": "text/markdown; charset=utf-8"},
            content=body.encode("utf-8"),
            request=httpx.Request("GET", url),
        )

    async def close(self) -> None:
        return None
