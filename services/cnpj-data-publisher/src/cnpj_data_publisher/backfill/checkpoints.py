"""Backfill cursor and rate limiting (spec section 17)."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(slots=True)
class Cursor:
    """Position inside the deterministic ``ORDER BY cnpj`` scan."""

    last_cnpj: str | None = None
    processed_rows: int = 0
    published_rows: int = 0
    failed_rows: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Cursor:
        if not data:
            return cls()
        return cls(
            last_cnpj=data.get("last_cnpj"),
            processed_rows=int(data.get("processed_rows") or 0),
            published_rows=int(data.get("published_rows") or 0),
            failed_rows=int(data.get("failed_rows") or 0),
        )

    def advance(self, last_cnpj: str, processed: int, published: int, failed: int = 0) -> None:
        self.last_cnpj = last_cnpj
        self.processed_rows += processed
        self.published_rows += published
        self.failed_rows += failed


class RateLimiter:
    """Simple token-bucket limiter. ``rate <= 0`` disables limiting."""

    def __init__(self, rate_per_second: int) -> None:
        self.rate = max(0, rate_per_second)
        self._allowance = float(self.rate)
        self._last_check = time.monotonic()

    @property
    def enabled(self) -> bool:
        return self.rate > 0

    def acquire(self, tokens: int = 1) -> float:
        """Block until ``tokens`` are available. Returns the seconds slept."""
        if not self.enabled:
            return 0.0

        slept = 0.0
        while True:
            now = time.monotonic()
            elapsed = now - self._last_check
            self._last_check = now
            self._allowance = min(float(self.rate), self._allowance + elapsed * self.rate)

            if self._allowance >= tokens:
                self._allowance -= tokens
                return slept

            deficit = tokens - self._allowance
            wait = deficit / self.rate
            time.sleep(wait)
            slept += wait
