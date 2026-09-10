"""Web fetch provider tests: normal HTTP first, FlareSolverr fallback only when blocked."""
import httpx
import pytest
import respx

from company_enrichment.providers.flaresolverr import FlareSolverrProvider
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.ssrf import SSRFBlockedError

# Use public, resolvable hosts so the SSRF DNS pre-check passes before respx intercepts HTTP.


def make_provider(flare_url="http://flaresolverr:8191"):
    fs = FlareSolverrProvider(flare_url, max_concurrency=2, timeout_seconds=10)
    web = WebFetchProvider(fs, default_timeout_seconds=10)
    return fs, web


@respx.mock
async def test_normal_http_success_does_not_use_flaresolverr():
    respx.get("https://example.com/").mock(
        return_value=httpx.Response(200, text="<html><title>Acme</title><body>Products</body></html>")
    )
    fs, web = make_provider()
    try:
        result = await web.fetch("https://example.com/")
        assert result.response.status_code == 200
        assert result.used_flaresolverr is False
        assert "Acme" in result.text
    finally:
        await web.close()


@respx.mock
async def test_blocked_http_falls_back_to_flaresolverr():
    # Normal HTTP returns 403 (bot-blocked).
    respx.get("https://example.com/blocked").mock(return_value=httpx.Response(403, text="Access denied"))
    # FlareSolverr returns the public page.
    respx.post("http://flaresolverr:8191/v1").mock(
        return_value=httpx.Response(
            200,
            json={
                "solution": {
                    "status": 200,
                    "response": "<html><title>Acme Public</title><body>Welcome</body></html>",
                }
            },
        )
    )
    fs, web = make_provider()
    try:
        result = await web.fetch("https://example.com/blocked")
        assert result.used_flaresolverr is True
        assert "Acme Public" in result.text
    finally:
        await web.close()


@respx.mock
async def test_404_does_not_fall_back():
    # 404 is permanent for the URL; pipeline continues without FlareSolverr.
    respx.get("https://example.com/missing").mock(return_value=httpx.Response(404, text="Not found"))
    fs, web = make_provider()
    try:
        result = await web.fetch("https://example.com/missing")
        assert result.used_flaresolverr is False
        assert result.response.status_code == 404
    finally:
        await web.close()


@respx.mock
async def test_redirect_to_private_target_is_blocked():
    respx.get("https://example.com/").mock(
        return_value=httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
    )
    fs, web = make_provider()
    try:
        with pytest.raises(SSRFBlockedError):
            await web.fetch("https://example.com/")
    finally:
        await web.close()


@respx.mock
async def test_redirect_to_public_target_follows():
    respx.get("https://example.com/start").mock(
        return_value=httpx.Response(302, headers={"location": "https://example.com/final"})
    )
    respx.get("https://example.com/final").mock(
        return_value=httpx.Response(200, text="<html><title>Final Page</title></html>")
    )
    fs, web = make_provider()
    try:
        result = await web.fetch("https://example.com/start")
        assert result.used_flaresolverr is False
        assert "Final Page" in result.text
    finally:
        await web.close()
