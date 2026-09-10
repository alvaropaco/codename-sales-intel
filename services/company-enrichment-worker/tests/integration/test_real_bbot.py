"""Real-BBOT integration test (runs only when the `bbot` CLI is installed).

Exercises the actual BbotProvider subprocess path against a safe public target
(IANA-reserved example.com) with a single passive module. This is the OSINT
value-path verification; it is skipped in environments without the OSINT image.

Run with:
  BBOT_BIN=/path/to/bbot python -m pytest tests/integration/test_real_bbot.py -q
"""
from __future__ import annotations

import shutil

import pytest

from company_enrichment.providers.bbot import BbotProvider

pytestmark = pytest.mark.integration

bbot = shutil.which("bbot")


@pytest.mark.skipif(bbot is None, reason="bbot CLI not installed (OSINT image only)")
async def test_real_bbot_scan_produces_dns_events():
    provider = BbotProvider(
        binary=bbot,
        presets=set(),          # no heavy presets
        modules={"certspotter"},  # passive, self-contained
        timeout_seconds=120,
        max_events=100,
    )
    events = await provider.scan("example.com")
    # Real scan must produce at least the seeded DNS_NAME event(s).
    assert events, "expected at least one real event from bbot"
    assert any(e.event_type == "DNS_NAME" for e in events)
    # The target itself must be present as a normalized DNS event.
    assert any(e.data == "example.com" for e in events)
