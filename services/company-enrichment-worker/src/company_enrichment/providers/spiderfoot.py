"""SpiderFoot provider: bounded headless-scan CLI wrapper.

Runs SpiderFoot's `sf.py -s <target> -m <modules> -o json -q` as a subprocess and
parses the JSON event stream that SpiderFoot prints to stdout. The scan is one
bounded process per directive with an allowlist, a per-scan timeout and an event
cap; a crash/timeout in a scan never affects the worker process.

SpiderFoot must be installed at ``SPIDERFOOT_BIN`` (default ``/opt/spiderfoot/sf.py``).
It is used for complementary passive events (cert hostnames, co-hosted sites,
WHOIS) that BBOT does not reliably cover.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Any

from company_enrichment.metrics.metrics import (
    ENRICHMENT_OSINT_EVENTS_INGESTED,
    ENRICHMENT_OSINT_SCANS,
    ENRICHMENT_OSINT_SCANS_FAILED,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.base import Provider, ProviderError

log = get_logger("spiderfoot")

#: SpiderFoot modules allowed (passive, public-data, no API key required).
#:   - sfp_crt:     crt.sh historical certificate hostnames (subdomains).
#:   - sfp_viewdns: ViewDNS co-hosted sites (related domains).
#:   - sfp_whois:   WHOIS records for domains/netblocks (provenance).
SPIDERFOOT_MODULES_ALLOWED = {
    "sfp_crt",
    "sfp_viewdns",
    "sfp_whois",
}

#: Map SpiderFoot's human-readable event type labels (the `type` field of its
#: `-o json` output) back to the internal event-type names the capability uses.
_LABEL_TO_TYPE = {
    "Internet Name": "INTERNET_NAME",
    "Internet Name - Unresolved": "INTERNET_NAME_UNRESOLVED",
    "Domain Name": "DOMAIN_NAME",
    "Domain Name (Parent)": "DOMAIN_NAME_PARENT",
    "Co-Hosted Site": "CO_HOSTED_SITE",
    "Co-Hosted Site - Domain Name": "CO_HOSTED_SITE_DOMAIN",
    "Domain Whois": "DOMAIN_WHOIS",
    "Netblock Whois": "NETBLOCK_WHOIS",
    "Email Address": "EMAILADDR",
    "Raw Data from RIRs/APIs": "RAW_RIR_DATA",
    "SSL Certificate - Raw Data": "SSL_CERTIFICATE_RAW",
    "SSL Certificate - Issued to": "SSL_CERTIFICATE_ISSUED",
    "SSL Certificate - Issued by": "SSL_CERTIFICATE_ISSUER",
}


@dataclass
class SpiderFootEvent:
    module: str
    event_type: str
    source: str
    target: str | None
    data: str
    source_type: str = "SPIDERFOOT"


class SpiderFootProvider(Provider):
    name = "spiderfoot"

    def __init__(
        self,
        *,
        enabled: bool = True,
        binary: str | None = None,
        circuit=None,
        timeout_seconds: int = 600,
        max_events: int = 1000,
        modules: set[str] | None = None,
    ) -> None:
        super().__init__(circuit)
        self.enabled_flag = enabled or os.environ.get("SPIDERFOOT_ENABLED", "").lower() in {
            "1",
            "true",
            "yes",
        }
        self._binary = binary or os.environ.get(
            "SPIDERFOOT_BIN", "/opt/spiderfoot/sf.py"
        )
        self._timeout_seconds = timeout_seconds
        self._max_events = max_events
        self._modules = (
            SPIDERFOOT_MODULES_ALLOWED
            if modules is None
            else set(modules) & SPIDERFOOT_MODULES_ALLOWED
        )

    @property
    def enabled(self) -> bool:
        return self.enabled_flag and (
            os.path.isfile(self._binary) or shutil.which(self._binary) is not None
        )

    def _build_command(self, target: str) -> list[str]:
        return [
            "python3",
            self._binary,
            "-s",
            target,
            "-m",
            ",".join(sorted(self._modules)),
            "-o",
            "json",
            "-q",
        ]

    async def scan(self, target: str, hints: dict[str, Any] | None = None) -> list[SpiderFootEvent]:
        if not self.enabled:
            return []
        if not self._modules:
            return []
        if not target or "*" in target:
            raise ProviderError("INVALID_TARGET", f"invalid spiderfoot target {target!r}", transient=False)
        ENRICHMENT_OSINT_SCANS.labels(tool="spiderfoot").inc()
        log.info("spiderfoot_scan_start", target=target, timeout=self._timeout_seconds)
        try:
            events = await self._execute(self._run, self._build_command(target))
        except Exception:  # noqa: BLE001
            ENRICHMENT_OSINT_SCANS_FAILED.labels(tool="spiderfoot").inc()
            raise
        ENRICHMENT_OSINT_EVENTS_INGESTED.labels(tool="spiderfoot").inc(len(events))
        return events

    async def _run(self, cmd: list[str]) -> list[SpiderFootEvent]:
        # Isolate each scan in its own HOME so SpiderFoot's SQLite DB, cache and
        # logs never collide across scans or survive the subprocess.
        home = tempfile.mkdtemp(prefix="spiderfoot-")
        env = {**os.environ, "HOME": home}
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError as exc:
            shutil.rmtree(home, ignore_errors=True)
            raise ProviderError(
                "SPIDERFOOT_NOT_FOUND",
                f"spiderfoot binary {self._binary!r} not installed",
                transient=False,
            ) from exc
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout_seconds)
        except TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise ProviderError("SPIDERFOOT_TIMEOUT", "spiderfoot scan timed out", transient=True) from exc
        finally:
            shutil.rmtree(home, ignore_errors=True)
        if proc.returncode not in (0, 1):
            detail = (stderr or b"").decode(errors="replace")[:500]
            raise ProviderError(
                "SPIDERFOOT_FAILED", f"spiderfoot exited {proc.returncode}: {detail}", transient=False
            )
        raw = (stdout or b"").decode(errors="replace").strip()
        if not raw:
            return []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            # Some SpiderFoot versions interleave a banner/log line with the JSON
            # array; recover by scanning from the first array bracket.
            start = raw.find("[")
            if start == -1:
                log.warning("spiderfoot_unparseable_output", preview=raw[:200])
                return []
            payload = json.loads(raw[start:])
        if not isinstance(payload, list):
            return []
        events: list[SpiderFootEvent] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            event = self._parse_item(item)
            if event is not None:
                events.append(event)
                if len(events) >= self._max_events:
                    break
        return events

    @staticmethod
    def _parse_item(item: dict[str, Any]) -> SpiderFootEvent | None:
        label = str(item.get("type") or "").strip()
        data = item.get("data")
        if label == "" or data is None:
            return None
        event_type = _LABEL_TO_TYPE.get(
            label, label.upper().replace(" ", "_").replace("-", "_")
        )
        return SpiderFootEvent(
            module=str(item.get("module") or ""),
            event_type=event_type,
            source=str(item.get("source") or ""),
            target=None,
            data=str(data),
        )

    async def close(self) -> None:  # pragma: no cover
        return None
