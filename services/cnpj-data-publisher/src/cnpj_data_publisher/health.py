"""Health and readiness endpoints for the outbox publisher (spec section 31)."""

from __future__ import annotations

import asyncio
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from cnpj_data_publisher.database.session import ping, session_scope
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)


class HealthState:
    """Shared, thread-safe view of the process health."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._alive = True
        self._nats_ready = False

    @property
    def alive(self) -> bool:
        with self._lock:
            return self._alive

    def set_alive(self, value: bool) -> None:
        with self._lock:
            self._alive = value

    @property
    def nats_ready(self) -> bool:
        with self._lock:
            return self._nats_ready

    def set_nats_ready(self, value: bool) -> None:
        with self._lock:
            self._nats_ready = value

    def readiness(self) -> tuple[bool, dict[str, Any]]:
        checks = {"nats": self.nats_ready, "postgres": False}
        try:
            with session_scope() as session:
                checks["postgres"] = ping(session)
        except Exception:  # noqa: BLE001 - readiness must never raise
            checks["postgres"] = False
        return all(checks.values()), checks


def _handler_factory(state: HealthState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _respond(self, code: int, body: dict[str, Any]) -> None:
            import json

            payload = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            if self.path.startswith("/healthz"):
                alive = state.alive
                self._respond(200 if alive else 503, {"status": "ok" if alive else "down"})
            elif self.path.startswith("/readyz"):
                ready, checks = state.readiness()
                self._respond(
                    200 if ready else 503,
                    {"status": "ready" if ready else "not-ready", "checks": checks},
                )
            else:
                self._respond(404, {"error": "not found"})

        def log_message(self, *_args: Any) -> None:
            """Silence the default stderr access log."""

    return Handler


def start_health_server(port: int, state: HealthState) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port), _handler_factory(state))  # noqa: S104
    thread = threading.Thread(target=server.serve_forever, name="health", daemon=True)
    thread.start()
    logger.info("health_server_started", port=port)
    return server


async def watch_nats_health(publisher: Any, state: HealthState, interval: float = 10.0) -> None:
    """Background task keeping the readiness view current."""
    while True:
        try:
            state.set_nats_ready(await publisher.is_healthy())
        except Exception:  # noqa: BLE001
            state.set_nats_ready(False)
        await asyncio.sleep(interval)
