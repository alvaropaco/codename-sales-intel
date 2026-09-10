"""Unit tests for the Obscura headless-browser provider."""

from __future__ import annotations

import asyncio
import textwrap
from pathlib import Path

import httpx
import pytest
import respx

from company_enrichment.providers.flaresolverr import FlareSolverrProvider
from company_enrichment.providers.http import WebFetchProvider
from company_enrichment.providers.obscura import ObscuraProvider


def _write_fake_bin(path: Path, body: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(body))
    path.chmod(0o755)
    return str(path)


MARKDOWN = """\
# Acme SPA
Bem-vindo ao site da Acme. Contato: contato@acme.com.br
"""


@pytest.fixture
def fake_obscura(tmp_path):
    script = """\
    #!/usr/bin/env python3
    import sys
    def main():
        args = sys.argv[1:]
        if "fetch" not in args:
            sys.exit(2)
        if "timeout.example.com" in args:
            import time
            time.sleep(30)  # killed by provider timeout
        sys.stdout.write(MARKDOWN)
        sys.exit(0)
    main()
    """.replace("MARKDOWN", repr(MARKDOWN))
    return _write_fake_bin(tmp_path / "fake_obscura.py", script)


def make_provider(binary, **kw):
    obscura = ObscuraProvider(binary=binary, enabled=True, timeout_seconds=5, **kw)
    return obscura


async def test_obscura_renders_markdown(fake_obscura):
    provider = make_provider(fake_obscura)
    resp = await provider.fetch("https://example.com/spa")
    assert resp.status_code == 200
    assert "Acme SPA" in resp.text
    assert "contato@acme.com.br" in resp.text
    await provider.close()


async def test_obscura_disabled_when_binary_missing(tmp_path):
    provider = ObscuraProvider(
        binary=str(tmp_path / "missing_obscura"),
        enabled=True,
        timeout_seconds=2,
    )
    assert provider.enabled is False
    await provider.close()


async def test_obscura_missing_binary_raises_not_configured(tmp_path):
    provider = ObscuraProvider(
        binary=str(tmp_path / "missing_obscura"),
        enabled=True,
        timeout_seconds=2,
    )
    with pytest.raises(Exception) as exc:
        await provider.fetch("https://example.com/")
    assert getattr(exc.value, "code", "") == "NOT_CONFIGURED"
    await provider.close()


async def test_obscura_timeout_kills_process(fake_obscura):
    provider = ObscuraProvider(binary=fake_obscura, enabled=True, timeout_seconds=1)

    with pytest.raises(Exception) as exc:
        await asyncio.wait_for(provider.fetch("https://timeout.example.com/"), timeout=5)
    assert "TIMEOUT" in str(exc.value) or "timeout" in str(exc.value).lower()
    await provider.close()


async def test_obscura_ssrf_blocked(fake_obscura, monkeypatch):
    # SSRF validation must reject private targets before any subprocess runs.
    from company_enrichment.providers.ssrf import SSRFBlockedError

    provider = make_provider(fake_obscura)
    with pytest.raises(SSRFBlockedError):
        await provider.fetch("http://169.254.169.254/latest/meta-data")
    await provider.close()


# --- Fallback chain: HTTP blocked -> Obscura -> FlareSolverr ---


def make_web(fake_obscura, **kw):
    fs = FlareSolverrProvider("http://flaresolverr:8191", max_concurrency=2, timeout_seconds=10)
    obs = ObscuraProvider(binary=fake_obscura, enabled=True, timeout_seconds=5)
    web = WebFetchProvider(fs, obscura=obs, default_timeout_seconds=10)
    return fs, obs, web


@respx.mock
async def test_blocked_http_falls_back_to_obscura(fake_obscura):
    respx.get("https://example.com/spa").mock(
        return_value=httpx.Response(403, text="Access denied")
    )
    fs, obs, web = make_web(fake_obscura)
    try:
        result = await web.fetch("https://example.com/spa")
        assert result.used_obscura is True
        assert result.used_flaresolverr is False
        assert "Acme SPA" in result.text
    finally:
        await web.close()


@respx.mock
async def test_obscura_fails_then_flaresolverr(fake_obscura, monkeypatch):
    # First HTTP returns 403 (blocked).
    respx.get("https://example.com/fallback").mock(
        return_value=httpx.Response(403, text="Access denied")
    )
    # FlareSolverr returns the page.
    respx.post("http://flaresolverr:8191/v1").mock(
        return_value=httpx.Response(
            200,
            json={"solution": {"status": 200, "response": "<html>FlareSolverr fallback</html>"}},
        )
    )
    # Force Obscura to fail (binary missing -> NOT_CONFIGURED).
    fs = FlareSolverrProvider("http://flaresolverr:8191", max_concurrency=2, timeout_seconds=10)
    obs = ObscuraProvider(binary="/nonexistent/obscura", enabled=True, timeout_seconds=5)
    web = WebFetchProvider(fs, obscura=obs, default_timeout_seconds=10)
    try:
        result = await web.fetch("https://example.com/fallback")
        assert result.used_obscura is False
        assert result.used_flaresolverr is True
        assert "FlareSolverr fallback" in result.text
    finally:
        await web.close()
