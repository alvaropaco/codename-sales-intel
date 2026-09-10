"""Minimal HTTP server exposing /healthz, /readyz, and /metrics.

No business REST API. ClusterIP only; no ingress. Uses stdlib asyncio to avoid
an extra framework dependency.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable

from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


class HealthServer:
    def __init__(self, host: str, port: int, ready_fn: Callable[[], bool]) -> None:
        self._host = host
        self._port = port
        self._ready_fn = ready_fn
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self._host, self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = await reader.readline()
            parts = request_line.decode("latin-1").strip().split(" ")
            method = parts[0] if parts else ""
            path = parts[1] if len(parts) > 1 else "/"
            # Drain request headers.
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
            if method != "GET":
                await self._respond(writer, 405, "Method Not Allowed", b"")
                return
            if path == "/healthz":
                await self._respond(writer, 200, "OK", b"ok")
            elif path == "/readyz":
                if self._ready_fn():
                    await self._respond(writer, 200, "OK", b"ready")
                else:
                    await self._respond(writer, 503, "Service Unavailable", b"not ready")
            elif path == "/metrics":
                body = generate_latest()
                await self._respond(
                    writer, 200, "OK", body, content_type=CONTENT_TYPE_LATEST
                )
            else:
                await self._respond(writer, 404, "Not Found", b"")
        except Exception:  # noqa: BLE001
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass

    @staticmethod
    async def _respond(
        writer: asyncio.StreamWriter,
        status: int,
        reason: str,
        body: bytes,
        content_type: str = "text/plain",
    ) -> None:
        header = (
            f"HTTP/1.1 {status} {reason}\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {len(body)}\r\n"
            f"Connection: close\r\n\r\n"
        )
        writer.write(header.encode("latin-1") + body)
        await writer.drain()
