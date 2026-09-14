"""BBOT provider: bounded subprocess wrapper around the `bbot` CLI.

Runs `bbot` as a subprocess with:
  - a strict module/preset allowlist (public-data recon only)
  - per-scan timeout, kill on expiry
  - JSON event output parsed into normalized OSINT events
  - a hard cap on events ingested (budget)

The binary must be pre-installed in the worker image (or injected for tests via
BBOT_BIN). This is a provider, so it flows through the existing circuit breaker
and metrics wiring.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
from dataclasses import dataclass, field
from typing import Any

from company_enrichment.metrics.metrics import (
    ENRICHMENT_OSINT_EVENTS_INGESTED,
    ENRICHMENT_OSINT_SCANS,
    ENRICHMENT_OSINT_SCANS_FAILED,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.base import Provider, ProviderError

log = get_logger("bbot")

#: BBOT preset allowlist (verified against BBOT 3.0.1 `bbot -lp`). Only
#: public-data recon presets. Names are intersected at runtime so stale names
#: are ignored rather than passed to the CLI.
BBOT_PRESETS_ALLOWED = {
    "subdomain-enum",
    "email-enum",
    "tech-detect",
    "wayback",
    "spider",
}
#: Passive/public-data modules (verified against BBOT 3.0.1 `bbot -l`).
BBOT_MODULES_ALLOWED = {
    "certspotter",
    "crt",
    "hackertarget",
    "urlscan",
    "wayback",
    "securitytrails",
    "sslcert",
    "securitytxt",
    "dnscommonsrv",
    "dnscaa",
}
#: Event types we persist (everything else is ignored for enrichment).
BBOT_EVENT_TYPES_ALLOWED = {
    "DNS_NAME",
    "EMAIL_ADDRESS",
    "SOCIAL_SOCIAL",
    "URL",
    "HOST",
    "TECHNOLOGY",
    "WEB_TECHNOLOGY",
    "CERTIFICATE",
    "IP_ADDRESS",
    "PHONE_NUMBER",
}


@dataclass
class BbotEvent:
    """One normalized event parsed from BBOT JSON output."""

    event_type: str
    data: str
    module: str | None = None
    host: str | None = None
    tags: list[str] = field(default_factory=list)
    timestamp: float | None = None
    source_type: str = "BBOT"

    @property
    def is_relevant(self) -> bool:
        return self.event_type in BBOT_EVENT_TYPES_ALLOWED


def parse_bbot_json_line(line: str) -> BbotEvent | None:
    """Parse one BBOT `--json` output line (NDJSON). Non-JSON lines are ignored."""
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    etype = obj.get("type") or obj.get("event_type")
    data = obj.get("data") or obj.get("event_data") or ""
    if not etype or not data:
        return None
    return BbotEvent(
        event_type=str(etype).upper(),
        data=str(data),
        module=obj.get("module"),
        host=obj.get("host"),
        tags=[str(t) for t in (obj.get("tags") or [])],
        timestamp=obj.get("timestamp"),
    )


class BbotProvider(Provider):
    name = "bbot"

    def __init__(
        self,
        *,
        binary: str | None = None,
        circuit=None,
        timeout_seconds: int = 300,
        max_events: int = 2000,
        presets: set[str] | None = None,
        modules: set[str] | None = None,
    ) -> None:
        super().__init__(circuit)
        self._binary = binary or os.environ.get("BBOT_BIN", "bbot")
        self._timeout_seconds = timeout_seconds
        self._max_events = max_events
        self._presets = (
            BBOT_PRESETS_ALLOWED if presets is None else set(presets) & BBOT_PRESETS_ALLOWED
        )
        self._modules = (
            BBOT_MODULES_ALLOWED if modules is None else set(modules) & BBOT_MODULES_ALLOWED
        )

    @property
    def enabled(self) -> bool:
        return self._binary != "bbot" or shutil.which(self._binary) is not None

    async def scan(self, target: str, hints: dict[str, Any] | None = None) -> list[BbotEvent]:
        """Run a bounded BBOT scan against a target and return normalized events."""
        if not target or "*" in target or " " in target:
            raise ProviderError("INVALID_TARGET", f"invalid bbot target {target!r}", transient=False)
        cmd = self._build_command(target)
        ENRICHMENT_OSINT_SCANS.labels(tool="bbot").inc()
        log.info("bbot_scan_start", target=target, timeout=self._timeout_seconds)
        try:
            events = await self._execute(self._run, cmd)
        except Exception:  # noqa: BLE001
            ENRICHMENT_OSINT_SCANS_FAILED.labels(tool="bbot").inc()
            raise
        ENRICHMENT_OSINT_EVENTS_INGESTED.labels(tool="bbot").inc(len(events))
        log.info("bbot_scan_done", target=target, events=len(events))
        return events

    async def _run(self, cmd: list[str]) -> list[BbotEvent]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                # Own process group so the timeout kills bbot and its children.
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise ProviderError(
                "BBOT_NOT_FOUND",
                f"bbot binary {self._binary!r} not installed",
                transient=False,
            ) from exc
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout_seconds)
        except TimeoutError as exc:
            self._kill_tree(proc)
            raise ProviderError("BBOT_TIMEOUT", "bbot scan timed out", transient=True) from exc
        if proc.returncode not in (0, 1):
            detail = (stderr or b"").decode(errors="replace")[:500]
            raise ProviderError("BBOT_FAILED", f"bbot exited {proc.returncode}: {detail}", transient=False)
        events: list[BbotEvent] = []
        for raw in (stdout or b"").decode(errors="replace").splitlines():
            event = parse_bbot_json_line(raw)
            if event is not None and event.is_relevant:
                events.append(event)
                if len(events) >= self._max_events:
                    break
        return events

    @staticmethod
    def _kill_tree(proc: asyncio.subprocess.Process) -> None:
        """Kill the scan and its whole process group (bbot spawns children)."""
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            proc.kill()
        except ProcessLookupError:
            pass

    def _build_command(self, target: str) -> list[str]:
        cmd = [self._binary, "-t", target, "--json", "-om", "stdout"]
        if self._presets:
            cmd += ["-p", ",".join(sorted(self._presets))]
        if self._modules:
            cmd += ["-m", ",".join(sorted(self._modules))]
        # NOTE: `--ignore-failed-deps` is mutually exclusive with `--no-deps`
        # in BBOT's argparse; use `--no-deps` alone to skip runtime dep installs
        # (which would otherwise need sudo/root in the read-only container).
        cmd += ["--no-color", "--force", "--no-deps", "-y"]
        return cmd

    async def close(self) -> None:  # pragma: no cover - nothing to release
        return None
