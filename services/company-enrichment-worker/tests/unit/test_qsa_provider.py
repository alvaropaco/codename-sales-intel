"""Unit tests for the QSA provider (disabled-by-default, graceful degradation)."""
from __future__ import annotations

from company_enrichment.providers.firmographics import QsaProvider


async def test_qsa_disabled_without_table():
    provider = QsaProvider("postgresql://x/y", table=None)
    assert provider.enabled is False
    assert await provider.lookup("12345678000199") == []


async def test_qsa_disabled_without_url():
    provider = QsaProvider(None, table="qsa")
    assert provider.enabled is False
    assert await provider.lookup("12345678000199") == []


async def test_qsa_returns_empty_on_invalid_cnpj():
    provider = QsaProvider("postgresql://x/y", table="qsa")
    assert await provider.lookup("not-a-cnpj") == []
