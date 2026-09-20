"""Unit tests: resiliência de OSINT (feature 006-enrichment-resilience).

Premissa (US3/FR-010): timeout de bbot/spiderfoot NÃO é falha — a capability
conclui com sucesso marcada como parcial (`partial=True`), com os eventos
coletados. FR-011: spiderfoot só roda como fallback quando o bbot retorna
poucos/nenhum evento (`should_fallback_spiderfoot`).

Testes com stubs (sem rede/binários reais), padrão dos testes unit do serviço.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from prometheus_client import REGISTRY

from company_enrichment.workers.capabilities.osint import (
    BbotCapability,
    SpiderFootCapability,
    should_fallback_spiderfoot,
)
from company_enrichment.workers.capability import CapabilityContext
from company_enrichment.workers.registry import WorkerType
from company_enrichment.providers.base import ProviderError
from company_enrichment.providers.bbot import BbotEvent


def _ev(kind: str, data: str) -> BbotEvent:
    return BbotEvent(event_type=kind, data=data, module="test")


class _FlakyBbot:
    """Provedor fake: delay configurável e evento(s) programados."""

    enabled = True

    def __init__(self, *, delay_s: float = 0.0, events: list[BbotEvent] | None = None, error: Exception | None = None):
        self._delay_s = delay_s
        self._events = events if events is not None else [_ev("DNS_NAME", "acme.com.br")]
        self._error = error

    async def scan(self, target, hints=None):
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._error is not None:
            raise self._error
        return self._events


class _FlakySpiderfoot:
    enabled = True

    def __init__(self, *, delay_s: float = 0.0, events: list | None = None, error: Exception | None = None):
        self._delay_s = delay_s
        self._events = events or []
        self._error = error

    async def scan(self, target, hints=None):
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._error is not None:
            raise self._error
        return self._events


def _run_kwargs():
    return dict(
        directive_id=uuid.uuid4(),
        case_id=uuid.uuid4(),
        request_event_id=uuid.uuid4(),
        tenant_id=None,
        company_id=uuid.uuid4(),
        entity=type("Ref", (), {"entity_type": "DOMAIN", "entity_key": "acme.com.br"})(),
        target="acme.com.br",
        hints={"cnpj": "12345678000199"},
        depth=0,
        budget_max_facts=50,
        ctx=None,
    )


def _counter(name: str, labels: dict) -> float:
    value = REGISTRY.get_sample_value(name, labels)
    return value or 0.0


@pytest.mark.asyncio
async def test_bbot_timeout_conclui_parcial_com_sucesso_fr010(monkeypatch):
    """Deadline estourada (asyncio.TimeoutError) → COMPLETED partial, nunca FAILED."""
    monkeypatch.setenv("OSINT_BBOT_DEADLINE_S", "1")
    slow = _FlakyBbot(delay_s=5.0)
    cap = BbotCapability()
    kwargs = _run_kwargs()
    kwargs["ctx"] = CapabilityContext(bbot=slow)

    outcome = await cap.run(**kwargs)

    assert outcome.status == "COMPLETED"
    assert outcome.summary.get("partial") is True
    assert outcome.error_code is None


@pytest.mark.asyncio
async def test_bbot_provider_timeout_error_também_conclui_parcial_fr010(monkeypatch):
    """ProviderError BBOT_TIMEOUT (transiente) → COMPLETED partial."""
    monkeypatch.setenv("OSINT_BBOT_DEADLINE_S", "1")
    slow = _FlakyBbot(error=ProviderError("BBOT_TIMEOUT", "bbot scan timed out", transient=True))
    cap = BbotCapability()
    kwargs = _run_kwargs()
    kwargs["ctx"] = CapabilityContext(bbot=slow)

    outcome = await cap.run(**kwargs)

    assert outcome.status == "COMPLETED"
    assert outcome.summary.get("partial") is True


@pytest.mark.asyncio
async def test_bbot_scan_normal_não_é_parcial(monkeypatch):
    monkeypatch.setenv("OSINT_BBOT_DEADLINE_S", "30")
    fast = _FlakyBbot(events=[_ev("DNS_NAME", "acme.com.br")])
    cap = BbotCapability()
    kwargs = _run_kwargs()
    kwargs["ctx"] = CapabilityContext(bbot=fast)

    outcome = await cap.run(**kwargs)

    assert outcome.status == "COMPLETED"
    assert outcome.summary.get("partial") is False


@pytest.mark.asyncio
async def test_spiderfoot_timeout_também_conclui_parcial_fr010(monkeypatch):
    monkeypatch.setenv("OSINT_SPIDERFOOT_DEADLINE_S", "1")
    slow = _FlakySpiderfoot(delay_s=5.0)
    cap = SpiderFootCapability()
    kwargs = _run_kwargs()
    kwargs["ctx"] = CapabilityContext(spiderfoot=slow)

    outcome = await cap.run(**kwargs)

    assert outcome.status == "COMPLETED"
    assert outcome.summary.get("partial") is True


def test_should_fallback_spiderfoot_fr011():
    # bbot vazio/abaixo do mínimo → fallback
    assert should_fallback_spiderfoot(0, min_events=5) is True
    assert should_fallback_spiderfoot(4, min_events=5) is True
    # bbot suficiente → sem fallback
    assert should_fallback_spiderfoot(5, min_events=5) is False
    assert should_fallback_spiderfoot(12, min_events=5) is False
