"""Unit tests for the BBOT and SpiderFoot providers using fake binaries."""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from company_enrichment.providers.base import ProviderError
from company_enrichment.providers.bbot import BbotProvider, parse_bbot_json_line
from company_enrichment.providers.spiderfoot import SpiderFootProvider


def _write_fake_bin(path: Path, body: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(body))
    path.chmod(0o755)
    return str(path)


BBOT_JSON = """\
{"type":"DNS_NAME","data":"mail.acme.com.br","module":"passivetotal"}
{"type":"EMAIL_ADDRESS","data":"contato@acme.com.br","module":"emails"}
{"type":"TECHNOLOGY","data":"Cloudflare","module":"wappalyzer"}
{"type":"SOCIAL_SOCIAL","data":"https://www.linkedin.com/company/acmebrasil","module":"social"}
{"not","json","line"}
{"type":"PHONE_NUMBER","data":"+55 11 99999 0000"}
"""


@pytest.fixture
def fake_bbot(tmp_path):
    script = """\
    #!/usr/bin/env python3
    import sys
    def main():
        if "-t" not in sys.argv:
            sys.exit(2)
        target = sys.argv[sys.argv.index("-t") + 1]
        if target == "timeout.example.com":
            import time
            time.sleep(30)  # will be killed by the provider timeout
        print(DATA, end="")
        sys.exit(0)
    main()
    """.replace("DATA", repr(BBOT_JSON))
    return _write_fake_bin(tmp_path / "fake_bbot.py", script)


async def test_parse_bbot_json_line():
    event = parse_bbot_json_line(json.dumps({"type": "DNS_NAME", "data": "a.com"}))
    assert event is not None
    assert event.event_type == "DNS_NAME"
    assert event.data == "a.com"
    assert parse_bbot_json_line("not json") is None


async def test_bbot_scan_parses_relevant_events(fake_bbot):
    provider = BbotProvider(binary=fake_bbot, timeout_seconds=5)
    events = await provider.scan("acme.com.br")
    # DNS_NAME, EMAIL, TECHNOLOGY, SOCIAL (relevant) + PHONE_NUMBER (relevant)
    assert len(events) >= 4
    types = {e.event_type for e in events}
    assert "DNS_NAME" in types
    assert "EMAIL_ADDRESS" in types
    assert "TECHNOLOGY" in types


async def test_bbot_timeout_kills_scan(tmp_path):
    script = """\
    #!/usr/bin/env python3
    import time
    time.sleep(30)
    """
    binary = _write_fake_bin(tmp_path / "slow_bbot.py", script)
    provider = BbotProvider(binary=binary, timeout_seconds=1)
    with pytest.raises(ProviderError) as excinfo:
        await provider.scan("acme.com.br")
    assert excinfo.value.code == "BBOT_TIMEOUT"


async def test_bbot_blocklisted_target():
    provider = BbotProvider(binary="/nonexistent/bbot")
    with pytest.raises(ProviderError) as excinfo:
        await provider.scan("evil * domain")
    assert excinfo.value.code == "INVALID_TARGET"


async def test_bbot_missing_binary(tmp_path):
    provider = BbotProvider(binary=str(tmp_path / "missing_bbot"))
    with pytest.raises(ProviderError) as excinfo:
        await provider.scan("acme.com.br")
    assert excinfo.value.code == "BBOT_NOT_FOUND"


SPIDERFOOT_OUT = json.dumps([
    {
        "generated": 1786904968,
        "type": "Internet Name",
        "data": "cert.acme.com.br",
        "module": "sfp_crt",
        "source": "acme.com.br",
    },
    {
        "generated": 1786904969,
        "type": "Co-Hosted Site",
        "data": "partner.other.com",
        "module": "sfp_viewdns",
        "source": "acme.com.br",
    },
    {
        "generated": 1786904970,
        "type": "Domain Whois",
        "data": "Registrant: Acme Ltda",
        "module": "sfp_whois",
        "source": "acme.com.br",
    },
])


@pytest.fixture
def fake_spiderfoot(tmp_path):
    script = """\
    #!/usr/bin/env python3
    import sys
    print(DATA, end="")
    sys.exit(0)
    """.replace("DATA", repr(SPIDERFOOT_OUT))
    return _write_fake_bin(tmp_path / "fake_sf.py", script)


async def test_spiderfoot_disabled_flag_returns_empty(fake_spiderfoot):
    provider = SpiderFootProvider(binary=fake_spiderfoot, enabled=False)
    events = await provider.scan("acme.com.br")
    assert events == []


async def test_spiderfoot_scan_parses_json_events(fake_spiderfoot):
    provider = SpiderFootProvider(binary=fake_spiderfoot, enabled=True)
    events = await provider.scan("acme.com.br")
    assert len(events) == 3
    assert events[0].event_type == "INTERNET_NAME"
    assert events[0].module == "sfp_crt"
    assert events[0].data == "cert.acme.com.br"
    assert events[1].event_type == "CO_HOSTED_SITE"
    assert events[2].event_type == "DOMAIN_WHOIS"


async def test_spiderfoot_command_requests_json_output(fake_spiderfoot):
    provider = SpiderFootProvider(binary=fake_spiderfoot, enabled=True)
    cmd = provider._build_command("acme.com.br")
    assert "-o" in cmd and "json" in cmd
    assert "-s" in cmd and "acme.com.br" in cmd
    assert "-m" in cmd


async def test_spiderfoot_enabled_false_when_binary_missing(tmp_path):
    provider = SpiderFootProvider(
        binary=str(tmp_path / "missing_sf.py"), enabled=True
    )
    assert provider.enabled is False


async def test_spiderfoot_missing_binary_returns_empty(tmp_path):
    provider = SpiderFootProvider(
        binary=str(tmp_path / "missing_sf.py"), enabled=True
    )
    # Missing binary degrades to disabled rather than failing the directive.
    assert provider.enabled is False
    events = await provider.scan("acme.com.br")
    assert events == []


async def test_spiderfoot_timeout_kills_scan(tmp_path):
    script = """\
    #!/usr/bin/env python3
    import time
    time.sleep(30)
    """
    binary = _write_fake_bin(tmp_path / "slow_sf.py", script)
    provider = SpiderFootProvider(binary=binary, timeout_seconds=1)
    with pytest.raises(ProviderError) as excinfo:
        await provider.scan("acme.com.br")
    assert excinfo.value.code == "SPIDERFOOT_TIMEOUT"
